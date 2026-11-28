import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import {
  Badge, Button, buttonClass, Card, Notice, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, RatingLine, SectionTitle,
  Spinner, StatusBadge,
} from '../../components/ui'
import { useMe } from '../../app/auth'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { AffectedLessons, type AffectedLesson } from '../../components/AffectedLessons'
import { addDays, formatDay, formatTime, scheduleLines } from '../../lib/format'
import { SupportQr } from '../checkin/SupportQr'
import { RankCard } from '../leaderboard/Leaderboard'
import { PushCard } from '../notifications/PushCard'
import { GUIDE_SEEN } from '../rules/Guide'
import { AtCenter, InstantInbox } from '../instant/LessonNow'
import { AttendanceCard } from '../attendance/SupportAttendance'
import { celebrate } from '../../lib/celebrate'
import { InstallCard } from '../profile/InstallCard'
import type { Booking, SupportHome } from '../../lib/types'

function ExcuseDialog({ name, loading, onSave, onClose }: {
  name: string
  loading: boolean
  onSave: (reason: string) => void
  onClose: () => void
}) {
  const t = useText()
  const [reason, setReason] = useState('')
  return (
    <Modal title={t('today.excuse_title', { name })} onClose={onClose}>
      <p className="mb-3 text-muted">{t('today.excuse_hint')}</p>
      <Field label={t('today.excuse_reason')}>
        {(id, className) => (
          <textarea
            id={id}
            rows={2}
            maxLength={300}
            className={`${className} py-2`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>
      <Button block className="mt-3" disabled={reason.trim() === ''} loading={loading} onClick={() => onSave(reason)}>
        {t('today.excuse_save')}
      </Button>
    </Modal>
  )
}

function useServerClock(serverNow: string) {
  const offset = useMemo(() => new Date(serverNow).getTime() - Date.now(), [serverNow])
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((count) => count + 1), 5_000)
    return () => window.clearInterval(timer)
  }, [])
  return new Date(Date.now() + offset)
}

function LessonCard({ booking, now, today, chatEnabled }: {
  booking: Booking
  now: string
  today: string
  chatEnabled: boolean
}) {
  const me = useMe()
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [excusing, setExcusing] = useState(false)
  const [changing, setChanging] = useState(false)
  const [showingCode, setShowingCode] = useState(false)
  const wasShowing = useRef(false)
  useEffect(() => {
    if (wasShowing.current && booking.status === 'attended') celebrate()
    wasShowing.current = showingCode && booking.status !== 'attended'
  }, [showingCode, booking.status])

  const mark = useMutation({
    mutationFn: ({ status, reason = '' }: { status: 'attended' | 'no_show' | 'excused'; reason?: string }) =>
      rpc('mark_attendance', { p_booking: booking.id, p_status: status, p_reason: reason }),
    onSuccess: () => {
      toast(t('today.marked'))
      setExcusing(false)
      setChanging(false)
      queryClient.invalidateQueries()
    },
    onError: (error) => toast(errorText(error), true),
  })

  const current = useServerClock(now)
  const open = current <= new Date(booking.mark_until)
  const started = current >= new Date(booking.starts_at)
  const noShowOpen = current >= new Date(booking.no_show_from)
  const marked = ['attended', 'no_show', 'excused'].includes(booking.status)
    && !booking.auto_marked && !booking.checked_in_at
  const booked = booking.status === 'booked'
  const marking = open && (booked || (marked && changing))
  const pending = mark.isPending ? mark.variables.status : null

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold">
            {formatTime(booking.starts_at)}
            <span className="ml-2 font-normal text-muted">{booking.student_name}</span>
          </p>
          <p className={booking.topic ? '' : 'text-muted'}>{booking.topic || t('today.no_topic')}</p>
          {booking.excuse_reason && (
            <p className="text-sm text-muted">{t('history.reason', { reason: booking.excuse_reason })}</p>
          )}
          {booking.instant && <Badge tone="warn">{t('now.badge')}</Badge>}
        </div>
        <StatusBadge status={booking.status} />
      </div>
      {booked && open && started && (
        <p className="mt-2 text-sm text-muted">{t('today.mark_until', { time: formatTime(booking.mark_until) })}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
        {marking && started && booking.status !== 'attended' && (
          <Button
            size="sm"
            loading={pending === 'attended'}
            onClick={() => (me.rules.qr_required ? setShowingCode(true) : mark.mutate({ status: 'attended' }))}
          >
            {t('today.attended')}
          </Button>
        )}
        {marking && started && booking.status !== 'no_show' && (
          <Button
            size="sm"
            variant="danger"
            disabled={!noShowOpen}
            loading={pending === 'no_show'}
            onClick={() => mark.mutate({ status: 'no_show' })}
          >
            {noShowOpen
              ? t('today.no_show')
              : `${t('today.no_show')} · ${t('today.no_show_at', { time: formatTime(booking.no_show_from) })}`}
          </Button>
        )}
        {marking && !started && <Badge>{t('today.not_started', { time: formatTime(booking.starts_at) })}</Badge>}
        {marking && booking.lesson_date === today && booking.status !== 'excused' && (
          <Button size="sm" variant="secondary" onClick={() => setExcusing(true)}>{t('today.excused')}</Button>
        )}
        {open && marked && !changing && (
          <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>{t('today.change')}</Button>
        )}
        {chatEnabled && booked && (
          <Link
            to={`/chat/${booking.id}`}
            aria-label={t('nav.chat')}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line hover:bg-sunken"
          >
            <MessageCircle className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      {showingCode && booking.status !== 'attended' && (
        <SupportQr booking={booking} onClose={() => setShowingCode(false)} />
      )}
      {excusing && (
        <ExcuseDialog
          name={booking.student_name}
          loading={pending === 'excused'}
          onSave={(reason) => mark.mutate({ status: 'excused', reason })}
          onClose={() => setExcusing(false)}
        />
      )}
    </Card>
  )
}

function GuideCard() {
  const t = useText()
  let seen = true
  try {
    seen = localStorage.getItem(GUIDE_SEEN) === '1'
  } catch {
  }
  if (seen) return null
  return (
    <Notice tone="brand" title={t('guide.new_title')}>
      <p className="mb-3">{t('guide.new_body')}</p>
      <Link to="/guide" className={buttonClass()}>{t('guide.open')}</Link>
    </Notice>
  )
}

function DaysOff({ data }: { data: SupportHome }) {
  const me = useMe()
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [date, setDate] = useState('')
  const [wholeDay, setWholeDay] = useState(true)
  const [from, setFrom] = useState('14:00')
  const [to, setTo] = useState('15:00')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)

  const close = useMutation({
    mutationFn: () => rpc<number>('close_day', {
      p_support: me.id,
      p_date: date,
      p_reason: reason,
      ...(wholeDay ? {} : { p_from: from, p_to: to }),
    }),
    onSuccess: (count) => {
      toast(count > 0 ? t('close.done_moved', { count }) : t('close.done'))
      setDate('')
      setReason('')
      queryClient.invalidateQueries()
    },
    onError: (error) => toast(errorText(error), true),
    onSettled: () => setConfirming(false),
  })

  const reopen = useMutation({
    mutationFn: (id: string) => rpc('reopen_day', { p_closure: id }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error) => toast(errorText(error), true),
  })

  const preview = useQuery({
    queryKey: ['closure-preview', me.id, date, wholeDay, from, to],
    queryFn: () => rpc<AffectedLesson[]>('closure_preview', {
      p_support: me.id,
      p_date: date,
      ...(wholeDay ? {} : { p_from: from, p_to: to }),
    }),
    enabled: confirming,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setConfirming(true)
  }

  return (
    <>
      <SectionTitle>{t('close.title')}</SectionTitle>
      <Card>
        <p className="mb-3 text-muted">{t('close.subtitle')}</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={t('close.date')}>
            {(id, className) => (
              <input
                id={id}
                type="date"
                min={data.close_from}
                required
                className={`${className} h-11`}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </Field>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              checked={wholeDay}
              onChange={(event) => setWholeDay(event.target.checked)}
            />
            {t('close.whole_day')}
          </label>
          {!wholeDay && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('close.from')}>
                {(id, className) => (
                  <input id={id} type="time" required className={`${className} h-11`} value={from}
                    onChange={(event) => setFrom(event.target.value)} />
                )}
              </Field>
              <Field label={t('close.to')}>
                {(id, className) => (
                  <input id={id} type="time" required className={`${className} h-11`} value={to}
                    onChange={(event) => setTo(event.target.value)} />
                )}
              </Field>
            </div>
          )}
          <Field label={t('close.reason')}>
            {(id, className) => (
              <input
                id={id}
                className={`${className} h-11`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="secondary">{t('close.submit')}</Button>
        </form>
        {data.closures.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {data.closures.map((closure) => (
              <li key={closure.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {formatDay(closure.closed_on)}
                  {closure.start_time && ` ${closure.start_time}-${closure.end_time}`}
                  {closure.reason && <span className="text-muted"> · {closure.reason}</span>}
                </span>
                {closure.can_reopen === false ? (
                  <span className="text-sm text-muted">{t('close.by_center')}</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={reopen.isPending && reopen.variables === closure.id}
                    onClick={() => reopen.mutate(closure.id)}
                  >
                    {t('close.reopen')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {confirming && (
        <ConfirmDialog
          title={t('close.submit')}
          body={t('close.confirm', {
            when: wholeDay ? formatDay(date) : `${formatDay(date)} ${from}-${to}`,
          })}
          loading={close.isPending}
          onConfirm={() => close.mutate()}
          onClose={() => setConfirming(false)}
        >
          <AffectedLessons lessons={preview.data} />
        </ConfirmDialog>
      )}
    </>
  )
}

function upcomingByDay(lessons: Booking[]) {
  const days = new Map<string, Booking[]>()
  for (const lesson of lessons) days.set(lesson.lesson_date, [...(days.get(lesson.lesson_date) ?? []), lesson])
  return [...days.entries()].sort(([left], [right]) => left.localeCompare(right))
}

export function SupportToday() {
  const me = useMe()
  const t = useText()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['support-home'],
    queryFn: () => rpc<SupportHome>('support_home'),
    refetchInterval: 30_000,
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  const serverNow = new Date(data.now).getTime()
  const finished = (booking: Booking) => !['booked', 'needs_transfer'].includes(booking.status)
    && serverNow > new Date(booking.mark_until).getTime()
  const current = data.lessons_today.filter((booking) => !finished(booking))
  const done = data.lessons_today.length - current.length

  const card = (booking: Booking) => (
    <li key={booking.id}>
      <LessonCard booking={booking} now={data.now} today={data.today} chatEnabled={me.chat_enabled} />
    </li>
  )

  return (
    <>
      <PageHeader
        title={t('today.title')}
        subtitle={`${t('role.support')} · ${formatDay(data.today)}`}
        action={<RatingLine {...data.rating} />}
      />
      <p className="text-sm text-muted">{scheduleLines(data.schedule).join(' · ')}</p>
      <p className="mb-3 text-sm text-muted">{t('today.month_lessons', { count: data.lessons_this_month })}</p>
      <div className="mb-3 flex flex-col gap-3">
        <InstallCard />
        <PushCard />
        <GuideCard />
        <InstantInbox />
        {me.staff_attendance ? <AttendanceCard /> : <AtCenter />}
        <RankCard />
      </div>

      {data.announcements.map((item) => (
        <Card key={item.id} className="mb-3">
          <h2 className="font-semibold">{item.title}</h2>
          <p className="whitespace-pre-line text-muted">{item.body}</p>
        </Card>
      ))}

      {data.lessons_today.length === 0 && <EmptyState title={t('today.no_lessons')} />}
      {current.length > 0 && <ul className="flex flex-col gap-2">{current.map(card)}</ul>}
      {done > 0 && (
        <p className="mt-2 text-sm text-muted">
          {t('today.done', { count: done })}
          {' · '}
          <Link to="/history" className="font-medium text-ink underline">{t('today.done_link')}</Link>
        </p>
      )}

      <SectionTitle>{t('today.upcoming')}</SectionTitle>
      {data.upcoming.length === 0 ? (
        <p className="text-muted">{t('today.no_upcoming')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {upcomingByDay(data.upcoming).map(([day, lessons]) => (
            <section key={day} aria-label={formatDay(day)}>
              <h3 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
                <span>
                  {day === addDays(data.today, 1) ? `${t('today.tomorrow')} · ${formatDay(day)}` : formatDay(day)}
                </span>
                <span className="font-normal text-muted">
                  {lessons.length === 1 ? t('today.one_lesson') : t('today.lesson_count', { count: lessons.length })}
                </span>
              </h3>
              <ul className="flex flex-col gap-2">
                {lessons.map((booking) => (
                  <li key={booking.id}>
                    <Card>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold tabular-nums">{formatTime(booking.starts_at)}</p>
                          <p className="text-muted">{booking.student_name}</p>
                          <p>{booking.topic || t('today.no_topic')}</p>
                        </div>
                        <StatusBadge status={booking.status} />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <DaysOff data={data} />

      <Link to="/rules" className="mt-6 block text-center text-sm text-muted underline hover:text-ink">
        {t('home.rules_link')}
      </Link>
    </>
  )
}
