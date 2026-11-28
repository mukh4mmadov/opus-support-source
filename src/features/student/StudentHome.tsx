import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarPlus, MessageCircle } from 'lucide-react'
import {
  Badge, Button, buttonClass, Card, ConfirmDialog, EmptyState, ErrorState, Field, Modal, Notice, PageHeader,
  Spinner, Stars,
} from '../../components/ui'
import { downloadIcs, googleCalendarUrl, type CalendarLesson } from '../../lib/calendar'
import { useMe } from '../../app/auth'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import {
  addDays, formatDate, formatDateTime, formatDay, formatDeadline, formatTime, lessonLength,
} from '../../lib/format'
import { CheckIn } from '../checkin/StudentCheckIn'
import { RankCard } from '../leaderboard/Leaderboard'
import { InstallCard } from '../profile/InstallCard'
import { Countdown } from '../../components/motion'
import { celebrate } from '../../lib/celebrate'
import { PushCard } from '../notifications/PushCard'
import type { Booking, StudentHome as Home } from '../../lib/types'

function useRefresh() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries()
}

function AddToCalendar({ booking }: { booking: Booking }) {
  const t = useText()
  const [open, setOpen] = useState(false)
  const lesson: CalendarLesson = {
    id: booking.id,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    title: t('calendar.title', { name: booking.support_name }),
    details: booking.topic,
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <CalendarPlus className="size-4" aria-hidden />
        {t('calendar.add')}
      </Button>
      {open && (
        <Modal title={t('calendar.add')} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2">
            <Button
              block
              onClick={() => {
                downloadIcs(lesson)
                setOpen(false)
              }}
            >
              {t('calendar.phone')}
            </Button>
            <a
              href={googleCalendarUrl(lesson)}
              target="_blank"
              rel="noreferrer"
              className={buttonClass('secondary', 'md', true)}
            >
              {t('calendar.google')}
            </a>
          </div>
        </Modal>
      )}
    </>
  )
}

function ActiveLesson({ booking, chatEnabled, phone, today, movesLeft, movesPerMonth }: {
  booking: Booking
  chatEnabled: boolean
  phone: string | null
  today: string
  movesLeft: number
  movesPerMonth: number
}) {
  const me = useMe()
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const refresh = useRefresh()
  const [confirming, setConfirming] = useState(false)
  const lessonWhen = `${formatDate(booking.starts_at)}, ${formatTime(booking.starts_at)}`
  const reopens = formatDay(addDays(today, me.rules.wait_days))
  const cancelEffect = me.rules.wait_days > 0
    ? t('home.cancel_effect', { date: reopens })
    : t('home.cancel_effect_now')

  const cancel = useMutation({
    mutationFn: () => rpc('cancel_booking', { p_booking: booking.id }),
    onSuccess: refresh,
    onError: (error) => toast(errorText(error), true),
    onSettled: () => setConfirming(false),
  })

  return (
    <section className="hero animate-pop-in relative overflow-hidden rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold opacity-85">{t('home.next_lesson')}</h2>
        <Countdown start={booking.starts_at} end={booking.ends_at} />
      </div>
      <p className="text-3xl font-bold tracking-tight">
        {formatTime(booking.starts_at)}
      </p>
      <p className="text-lg font-medium opacity-90">{formatDate(booking.starts_at)}</p>
      <p className="text-sm opacity-85">{t('book.length', lessonLength(booking.starts_at, booking.ends_at))}</p>
      <p className="mt-2 font-medium">{booking.support_name}</p>
      {phone && (
        <a href={`tel:${phone.replace(/\s/g, '')}`} className="text-sm underline opacity-85">
          {t('home.support_phone', { phone })}
        </a>
      )}
      {booking.topic && (
        <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 backdrop-blur-sm">
          <span className="opacity-80">{t('home.topic')}: </span>{booking.topic}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {chatEnabled && (
          <Link to={`/chat/${booking.id}`} className={buttonClass('secondary')}>
            <MessageCircle className="size-4" aria-hidden />
            {t('home.open_chat')}
          </Link>
        )}
        <AddToCalendar booking={booking} />
        {booking.can_cancel && booking.status === 'booked' && movesLeft > 0 && (
          <Link to={`/book?move=${booking.id}`} className={buttonClass('secondary')}>
            <CalendarClock className="size-4" aria-hidden />
            {t('home.move')}
          </Link>
        )}
        {booking.can_cancel && (
          <Button variant="danger" onClick={() => setConfirming(true)}>{t('home.cancel')}</Button>
        )}
      </div>
      {booking.can_cancel && <p className="mt-3 text-sm opacity-85">{cancelEffect}</p>}
      {booking.can_cancel && booking.status === 'booked' && movesPerMonth > 0 && (
        <p className="mt-1 text-sm opacity-85">
          {movesLeft > 0 ? t('home.move_left', { count: movesLeft }) : t('home.move_none')}
        </p>
      )}
      {!booking.can_cancel && <p className="mt-3 text-sm opacity-85">{t('home.cancel_closed')}</p>}
      {confirming && (
        <ConfirmDialog
          title={t('home.cancel')}
          body={me.rules.wait_days > 0
            ? t('home.cancel_confirm', { support: booking.support_name, lesson: lessonWhen, date: reopens })
            : t('home.cancel_confirm_now', { support: booking.support_name, lesson: lessonWhen })}
          danger
          loading={cancel.isPending}
          onConfirm={() => cancel.mutate()}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  )
}

function TransferOffer({ booking, options }: { booking: Booking; options: Home['transfer_options'] }) {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const refresh = useRefresh()

  const accept = useMutation({
    mutationFn: (support: string) =>
      rpc('accept_transfer', { p_booking: booking.id, p_support: support }),
    onSuccess: () => {
      toast(t('home.moved'))
      refresh()
    },
    onError: (error) => {
      toast(errorText(error), true)
      refresh()
    },
  })
  const decline = useMutation({
    mutationFn: () => rpc('decline_transfer', { p_booking: booking.id }),
    onSuccess: refresh,
    onError: (error) => toast(errorText(error), true),
  })

  return (
    <Notice tone="warn" title={t('home.transfer_title')}>
      <p className="mb-3">
        {t('home.transfer_body', {
          name: booking.support_name,
          date: formatDate(booking.starts_at),
          time: formatTime(booking.starts_at),
        })}
      </p>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <Button
            key={option.support_id}
            block
            loading={accept.isPending && accept.variables === option.support_id}
            disabled={accept.isPending}
            onClick={() => accept.mutate(option.support_id)}
          >
            {option.name}
          </Button>
        ))}
        <Button variant="secondary" block loading={decline.isPending} onClick={() => decline.mutate()}>
          {t('home.transfer_decline')}
        </Button>
      </div>
    </Notice>
  )
}

export function ReviewForm({ booking, onDone }: { booking: Booking; onDone?: () => void }) {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const refresh = useRefresh()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')

  const send = useMutation({
    mutationFn: () => rpc('submit_review', {
      p_booking: booking.id, p_rating: rating, p_comment: comment,
    }),
    onSuccess: () => {
      toast(t('home.rate_thanks'))
      celebrate()
      refresh()
      onDone?.()
    },
    onError: (error) => toast(errorText(error), true),
  })

  return (
    <div className="flex flex-col gap-3">
      <Stars value={rating} onChange={setRating} size="lg" />
      <Field label={t('home.rate_comment')}>
        {(id, className) => (
          <textarea
            id={id}
            className={`${className} py-2`}
            rows={2}
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        )}
      </Field>
      <p className="text-sm text-muted">{t('home.rate_private')}</p>
      <Button disabled={rating === 0} loading={send.isPending} onClick={() => send.mutate()}>
        {t('home.rate_send')}
      </Button>
    </div>
  )
}

export function StudentHome() {
  const me = useMe()
  const t = useText()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['student-home'],
    queryFn: () => rpc<Home>('student_home'),
    refetchInterval: 30_000,
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  const { active, ban, pending_review: review } = data
  const warned = !ban && data.strikes > 0

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t('home.greeting', { name: me.first_name })} subtitle={t('role.student')} />
      {data.checkin_lesson && <CheckIn booking={data.checkin_lesson} />}

      {ban && (
        <Notice tone="bad" title={t('home.banned_title')}>
          {t('home.banned', { until: formatDateTime(ban.ends_at) })}
        </Notice>
      )}
      {warned && <Notice tone="warn" title={t('home.warned_title')}>{t('home.warned')}</Notice>}
      {!ban && data.rebook_from && (
        <Notice tone="warn" title={t('home.rebook_title', { date: formatDay(data.rebook_from) })}>
          {t('home.rebook', { date: formatDay(data.rebook_from) })}
        </Notice>
      )}

      {data.same_day_pass && !active && !ban && (
        <Notice tone="brand" title={t('home.same_day_title')}>
          <p className="mb-3">{t('home.same_day')}</p>
          <Link to="/book" className={buttonClass()}>{t('home.book')}</Link>
        </Notice>
      )}

      {active?.status === 'needs_transfer' && (
        <TransferOffer booking={active} options={data.transfer_options} />
      )}
      {active?.status === 'booked' && (
        <ActiveLesson
          booking={active}
          chatEnabled={me.chat_enabled}
          phone={data.support_phone}
          today={data.today}
          movesLeft={data.moves_left}
          movesPerMonth={data.rules.moves_per_month}
        />
      )}
      {!active && (
        <EmptyState
          title={t('home.no_lesson')}
          hint={ban || data.rebook_from ? undefined : t('home.no_lesson_hint')}
          action={!ban && !data.rebook_from && (
            <Link to="/book" className={buttonClass()}>
              <CalendarClock className="size-4" aria-hidden />
              {t('home.book')}
            </Link>
          )}
        />
      )}

      <InstallCard />
      <PushCard />
      <RankCard />

      {review && (
        <Card>
          <h2 className="mb-1 font-semibold">{t('home.rate_title', { name: review.support_name })}</h2>
          {review.review_until && (
            <p className="mb-3 text-sm text-muted">
              {t('home.rate_until', { when: formatDeadline(review.review_until) })}
            </p>
          )}
          <ReviewForm booking={review} />
        </Card>
      )}

      {data.announcements.map((item) => (
        <Card key={item.id}>
          <Badge tone="brand">{formatDate(item.created_at)}</Badge>
          <h2 className="mt-2 font-semibold">{item.title}</h2>
          <p className="whitespace-pre-line text-muted">{item.body}</p>
        </Card>
      ))}

      <Link to="/rules" className="block text-center text-sm text-muted underline hover:text-ink">
        {t('home.rules_link')}
      </Link>
    </div>
  )
}
