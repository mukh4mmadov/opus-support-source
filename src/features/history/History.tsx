import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ChartColumn, CheckCircle2, Circle } from 'lucide-react'
import {
  Button, buttonClass, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner, Stars, StatusBadge,
} from '../../components/ui'
import { useMe } from '../../app/auth'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { formatDate, formatDeadline, formatTime } from '../../lib/format'
import type { Booking } from '../../lib/types'
import { ReviewForm } from '../student/StudentHome'

function ComplaintDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')

  const send = useMutation({
    mutationFn: () => rpc('send_complaint', { p_booking: booking.id, p_body: body }),
    onSuccess: () => {
      toast(t('complaint.sent'))
      queryClient.invalidateQueries({ queryKey: ['history'] })
      onClose()
    },
    onError: (error) => toast(errorText(error), true),
  })

  return (
    <Modal title={t('complaint.title')} onClose={onClose}>
      <p className="mb-3 text-muted">{t('complaint.hint')}</p>
      {booking.complaint_until && (
        <p className="mb-3 text-sm text-muted">
          {t('complaint.until', { when: formatDeadline(booking.complaint_until) })}
        </p>
      )}
      <Field label={t('complaint.label')}>
        {(id, className) => (
          <textarea
            id={id}
            rows={4}
            maxLength={1000}
            className={`${className} py-2`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        )}
      </Field>
      <Button block className="mt-3" disabled={body.trim() === ''} loading={send.isPending} onClick={() => send.mutate()}>
        {t('complaint.send')}
      </Button>
    </Modal>
  )
}

export function History() {
  const me = useMe()
  const t = useText()
  const [rating, setRating] = useState<Booking | null>(null)
  const [complaining, setComplaining] = useState<Booking | null>(null)
  const isSupport = me.role === 'support'
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['history'],
    queryFn: () => rpc<Booking[]>('my_history'),
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  return (
    <>
      <PageHeader
        title={t('history.title')}
        action={(
          <Link to="/history/stats" className={buttonClass('secondary')}>
            <ChartColumn className="size-4" aria-hidden />
            {t('history.stats')}
          </Link>
        )}
      />
      {data.length === 0 && <EmptyState title={t('history.empty')} />}
      <ul className="flex flex-col gap-2">
        {data.map((booking) => (
          <li key={booking.id}>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {formatDate(booking.starts_at)}, {formatTime(booking.starts_at)}
                  </p>
                  <p className="text-muted">{isSupport ? booking.student_name : booking.support_name}</p>
                  {booking.topic && <p className="mt-1 text-sm">{booking.topic}</p>}
                  {booking.excuse_reason && (
                    <p className="mt-1 text-sm text-muted">
                      {t('history.reason', { reason: booking.excuse_reason })}
                    </p>
                  )}
                  {booking.auto_marked && <p className="mt-1 text-sm text-muted">{t('history.auto')}</p>}
                </div>
                <StatusBadge status={booking.status} />
              </div>
              {booking.review && (
                <div className="mt-2">
                  <Stars value={booking.review.rating} />
                  {booking.review.comment && <p className="mt-1 text-sm text-muted">{booking.review.comment}</p>}
                </div>
              )}
              {booking.complaint && (
                <div className="mt-2 rounded-lg bg-sunken px-3 py-2 text-sm">
                  <ol className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t('complaint.status')}>
                    {([
                      ['complaint.step_sent', booking.complaint.created_at],
                      ['complaint.step_seen', booking.complaint.seen_at],
                      ['complaint.step_answered', booking.complaint.answered_at],
                    ] as const).map(([step, at]) => (
                      <li key={step} className={clsx('flex items-center gap-1', at ? 'font-semibold text-ok' : 'text-muted')}>
                        {at ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
                        <span>{t(step)}</span>
                        {at
                          ? <span className="font-normal text-muted">· {formatDate(at)}</span>
                          : <span className="sr-only">({t('complaint.not_yet')})</span>}
                      </li>
                    ))}
                  </ol>
                  <p><span className="text-muted">{t('complaint.yours')}: </span>{booking.complaint.body}</p>
                  <p className="mt-1">
                    <span className="text-muted">{t('complaint.answer')}: </span>
                    {booking.complaint.reply || t('complaint.waiting')}
                  </p>
                </div>
              )}
              {!isSupport && booking.can_review && booking.review_until && (
                <p className="mt-2 text-sm text-muted">
                  {t('home.rate_until', { when: formatDeadline(booking.review_until) })}
                </p>
              )}
              {!isSupport && (
                <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
                  {booking.can_review && (
                    <Button variant="secondary" size="sm" onClick={() => setRating(booking)}>
                      {t('history.rate')}
                    </Button>
                  )}
                  {!booking.complaint && booking.can_complain && (
                    <Button variant="ghost" size="sm" onClick={() => setComplaining(booking)}>
                      {t('complaint.open')}
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {rating && (
        <Modal title={t('home.rate_title', { name: rating.support_name })} onClose={() => setRating(null)}>
          <ReviewForm booking={rating} onDone={() => setRating(null)} />
        </Modal>
      )}
      {complaining && <ComplaintDialog booking={complaining} onClose={() => setComplaining(null)} />}
    </>
  )
}
