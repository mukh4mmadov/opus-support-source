import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Bell, Heart } from 'lucide-react'
import {
  Button, Card, EmptyState, ErrorState, Field, Modal, Notice, PageHeader, RatingLine, Spinner,
} from '../../components/ui'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { NETWORK_ERROR, rpc } from '../../lib/api'
import { formatDate, formatDateTime, formatDay, formatTime, lessonLength } from '../../lib/format'
import type { Booking, BookingOptions, DayOption, DaySlot, DaySupport, StudentHome } from '../../lib/types'
import { LessonNow } from '../instant/LessonNow'
import { celebrate } from '../../lib/celebrate'
import { Avatar } from './SupportsList'

interface Choice {
  support: DaySupport
  slot: DaySlot
}

async function savedDespiteError(startsAt: string, supportId: string) {
  const home = await rpc<StudentHome>('student_home').catch(() => null)
  const active = home?.active
  return Boolean(active) && active!.support_id === supportId
    && new Date(active!.starts_at).getTime() === new Date(startsAt).getTime()
}

function nearbyTimes(supports: DaySupport[], taken: Choice): Choice[] {
  const target = new Date(taken.slot.starts_at).getTime()
  const distance = (option: Choice) => Math.abs(new Date(option.slot.starts_at).getTime() - target)
    + (option.support.id === taken.support.id ? 0 : 1)
  return supports
    .flatMap((support) => support.slots
      .filter((slot) => slot.is_free && !(support.id === taken.support.id && slot.starts_at === taken.slot.starts_at))
      .map((slot) => ({ support, slot })))
    .sort((left, right) => distance(left) - distance(right))
    .slice(0, 6)
}

function ConfirmBooking({ choice, rules, supports, moving, onChoose, onClose }: {
  choice: Choice
  moving?: Booking | null
  rules: StudentHome['rules']
  supports: DaySupport[]
  onChoose: (next: Choice) => void
  onClose: () => void
}) {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [topic, setTopic] = useState(moving?.topic ?? '')
  const [taken, setTaken] = useState<Choice | null>(null)
  const { support, slot } = choice

  const book = useMutation({
    mutationFn: async () => {
      try {
        await (moving
          ? rpc('move_booking', {
            p_booking: moving.id, p_support: support.id, p_starts_at: slot.starts_at, p_topic: topic,
          })
          : rpc('book_lesson', { p_support: support.id, p_starts_at: slot.starts_at, p_topic: topic }))
      } catch (error) {
        const lost = error instanceof Error && error.message === NETWORK_ERROR
        if (!lost || !(await savedDespiteError(slot.starts_at, support.id))) throw error
      }
    },
    onSuccess: () => {
      toast(t(moving ? 'move.done' : 'book.done'))
      celebrate()
      queryClient.invalidateQueries()
      navigate('/')
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'SLOT_UNAVAILABLE') {
        setTaken(choice)
        queryClient.invalidateQueries({ queryKey: ['day'] })
        return
      }
      toast(errorText(error), true)
      if (error instanceof Error && error.message === NETWORK_ERROR) return
      queryClient.invalidateQueries({ queryKey: ['day'] })
      onClose()
    },
  })

  const others = taken ? nearbyTimes(supports, taken) : []

  return (
    <Modal title={`${formatDate(slot.starts_at)}, ${formatTime(slot.starts_at)}`} onClose={onClose}>
      <p className="text-muted">{support.name}</p>
      <p className="mb-3 text-sm text-muted">{t('book.length', lessonLength(slot.starts_at, slot.ends_at))}</p>
      {taken ? (
        <Notice tone="bad" title={t('book.taken_title')}>
          <p className="mb-3">{t(others.length > 0 ? 'book.taken_pick' : 'book.taken_none')}</p>
          <div className="flex flex-col gap-2">
            {others.map((other) => (
              <Button
                key={`${other.support.id}-${other.slot.starts_at}`}
                variant="secondary"
                block
                onClick={() => {
                  setTaken(null)
                  onChoose(other)
                }}
              >
                {formatTime(other.slot.starts_at)} · {other.support.name}
              </Button>
            ))}
          </div>
        </Notice>
      ) : (
        <>
          <Field label={t('book.topic_label')} hint={t('book.topic_hint')}>
            {(id, className) => (
              <textarea
                id={id}
                className={`${className} py-2`}
                rows={3}
                autoFocus
                maxLength={rules.topic_max_length}
                placeholder={t('book.topic_placeholder')}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
            )}
          </Field>
          <Button
            block
            className="mt-3"
            disabled={(rules.topic_required && topic.trim() === '') || topic.length > rules.topic_max_length}
            loading={book.isPending}
            onClick={() => book.mutate()}
          >
            {t(moving ? 'move.confirm' : 'book.confirm')}
          </Button>
        </>
      )}
    </Modal>
  )
}

function WaitDialog({ choice, onClose }: { choice: Choice; onClose: () => void }) {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { support, slot } = choice

  const change = useMutation({
    mutationFn: () => rpc(slot.waiting ? 'leave_waitlist' : 'join_waitlist', {
      p_support: support.id, p_starts_at: slot.starts_at,
    }),
    onSuccess: () => {
      toast(t(slot.waiting ? 'wait.left' : 'wait.joined'))
      queryClient.invalidateQueries({ queryKey: ['day'] })
      onClose()
    },
    onError: (error) => toast(errorText(error), true),
  })

  return (
    <Modal title={`${formatDate(slot.starts_at)}, ${formatTime(slot.starts_at)}`} onClose={onClose}>
      <p className="mb-1 text-muted">{support.name}</p>
      <p className="mb-3">{t(slot.waiting ? 'wait.on_list' : 'wait.explain')}</p>
      <Button
        block
        variant={slot.waiting ? 'secondary' : 'primary'}
        loading={change.isPending}
        onClick={() => change.mutate()}
      >
        {t(slot.waiting ? 'wait.leave' : 'wait.join')}
      </Button>
    </Modal>
  )
}

function DayPicker({ days, day, onPick }: {
  days: DayOption[]
  day: string | undefined
  onPick: (next: string) => void
}) {
  const t = useText()
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {days.map((item) => (
        <button
          key={item.date}
          type="button"
          disabled={item.free === 0}
          aria-pressed={item.date === day}
          onClick={() => onPick(item.date)}
          className={clsx(
            'shrink-0 rounded-lg border px-3 py-2 text-left disabled:opacity-45',
            item.date === day ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface',
          )}
        >
          <span className="block text-sm font-medium whitespace-nowrap">{formatDay(item.date)}</span>
          <span className="block text-xs whitespace-nowrap">{t('book.free', { count: item.free })}</span>
        </button>
      ))}
    </div>
  )
}

function SlotButton({ slot, canWait, onPick, onWait }: {
  slot: DaySlot
  canWait: boolean
  onPick: () => void
  onWait: () => void
}) {
  const t = useText()
  const label = formatTime(slot.starts_at)
  if (slot.is_free) {
    return (
      <button
        type="button"
        onClick={onPick}
        className="h-11 rounded-lg border border-line bg-surface font-medium tabular-nums hover:border-brand hover:bg-brand-soft"
      >
        {label}
      </button>
    )
  }
  if (canWait && slot.can_wait) {
    return (
      <button
        type="button"
        aria-label={`${label} ${t('wait.taken')}`}
        onClick={onWait}
        className={clsx(
          'inline-flex h-11 items-center justify-center gap-1 rounded-lg border font-medium tabular-nums',
          slot.waiting
            ? 'border-brand bg-brand-soft text-brand-ink'
            : 'border-transparent bg-sunken text-muted',
        )}
      >
        <span className={slot.waiting ? '' : 'line-through'}>{label}</span>
        <Bell className={clsx('size-3', slot.waiting && 'fill-current')} aria-hidden />
      </button>
    )
  }
  return (
    <button
      type="button"
      disabled
      className="h-11 rounded-lg border border-transparent bg-sunken font-medium text-muted tabular-nums line-through opacity-60"
    >
      {label}
    </button>
  )
}

function SupportSlots({ support, favorite, canWait, onFavorite, onPick, onWait }: {
  support: DaySupport
  favorite: boolean
  canWait: boolean
  onFavorite: () => void
  onPick: (choice: Choice) => void
  onWait: (choice: Choice) => void
}) {
  const t = useText()
  return (
    <Card>
      <div className="mb-3 flex items-center gap-3">
        <Avatar name={support.name} />
        <div className="min-w-0 flex-1">
          <Link to={`/supports/${support.id}`} className="font-semibold hover:underline">
            {support.name}
          </Link>
          <div><RatingLine {...support.rating} /></div>
        </div>
        <button
          type="button"
          aria-label={t('book.favorite')}
          aria-pressed={favorite}
          onClick={onFavorite}
          className="rounded-full p-2 hover:bg-sunken"
        >
          <Heart className={clsx('size-5', favorite ? 'fill-red-500 text-red-500' : 'text-muted')} aria-hidden />
        </button>
      </div>
      <div className="stagger grid grid-cols-4 gap-2 sm:grid-cols-6">
        {support.slots.map((slot) => (
          <SlotButton
            key={slot.starts_at}
            slot={slot}
            canWait={canWait}
            onPick={() => onPick({ support, slot })}
            onWait={() => onWait({ support, slot })}
          />
        ))}
      </div>
    </Card>
  )
}

export function Book() {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<string>()
  const [choice, setChoice] = useState<Choice | null>(null)
  const [waiting, setWaiting] = useState<Choice | null>(null)
  const [params] = useSearchParams()

  const home = useQuery({
    queryKey: ['student-home'],
    queryFn: () => rpc<StudentHome>('student_home'),
  })
  const days = useQuery({
    queryKey: ['booking-days'],
    queryFn: () => rpc<DayOption[]>('booking_days'),
  })
  const options = useQuery({
    queryKey: ['booking-options'],
    queryFn: () => rpc<BookingOptions>('booking_options'),
  })

  const day = picked ?? days.data?.find((item) => item.free > 0)?.date
  const supports = useQuery({
    queryKey: ['day', day],
    queryFn: () => rpc<DaySupport[]>('day_availability', { p_date: day }),
    enabled: Boolean(day),
    refetchInterval: 20_000,
  })

  const favorite = useMutation({
    mutationFn: (support: string) => rpc('toggle_favorite', { p_support: support }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking-options'] }),
    onError: (error) => toast(errorText(error), true),
  })

  if (home.isPending || days.isPending || options.isPending) return <Spinner />
  if (home.isError || days.isError || options.isError) {
    return (
      <ErrorState
        onRetry={() => {
          home.refetch()
          days.refetch()
          options.refetch()
        }}
      />
    )
  }

  const { active, ban, rebook_from: rebookFrom, rules } = home.data
  const moving = active && active.status === 'booked' && active.can_cancel && home.data.moves_left > 0
    && params.get('move') === active.id ? active : null
  const header = (
    <>
      <PageHeader title={t('book.title')} subtitle={t('book.subtitle')} />
      {!moving && <LessonNow blocked={Boolean(ban || rebookFrom)} />}
    </>
  )

  if (ban) {
    return (
      <>
        {header}
        <Notice tone="bad">{t('book.blocked_ban', { until: formatDateTime(ban.ends_at) })}</Notice>
      </>
    )
  }
  if (active && !moving) {
    return (
      <>
        {header}
        <Notice tone="brand">{t('book.blocked_active')}</Notice>
      </>
    )
  }
  if (rebookFrom && !moving) {
    return (
      <>
        {header}
        <Notice tone="warn">{t('book.blocked_rebook', { date: formatDay(rebookFrom) })}</Notice>
      </>
    )
  }

  const favorites = new Set(options.data.favorites)
  const sorted = [...(supports.data ?? [])].sort(
    (a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)),
  )

  return (
    <>
      {header}
      {moving && (
        <div className="mb-4">
          <Notice tone="brand" title={t('move.banner_title')}>
            <p className="mb-2">
              {t('move.banner', { support: moving.support_name, when: formatDateTime(moving.starts_at) })}
            </p>
            <Link to="/" className="text-sm font-medium underline">{t('move.back')}</Link>
          </Notice>
        </div>
      )}
      <DayPicker days={days.data} day={day} onPick={setPicked} />
      <div className="mt-4 flex flex-col gap-3">
        {!day && <EmptyState title={t('book.no_days')} />}
        {day && supports.isPending && <Spinner />}
        {supports.isError && <ErrorState onRetry={supports.refetch} />}
        {supports.data?.length === 0 && <EmptyState title={t('book.no_slots')} />}
        {sorted.map((support) => (
          <SupportSlots
            key={support.id}
            support={support}
            favorite={favorites.has(support.id)}
            canWait={options.data.waitlist_enabled && day !== home.data.today && !moving}
            onFavorite={() => favorite.mutate(support.id)}
            onPick={setChoice}
            onWait={setWaiting}
          />
        ))}
      </div>
      <Link to="/supports" className="mt-4 block text-center text-sm text-muted hover:text-ink">
        {t('book.all_supports')}
      </Link>
      {choice && (
        <ConfirmBooking
          choice={choice}
          rules={rules}
          supports={sorted}
          moving={moving}
          onChoose={setChoice}
          onClose={() => setChoice(null)}
        />
      )}
      {waiting && <WaitDialog choice={waiting} onClose={() => setWaiting(null)} />}
    </>
  )
}
