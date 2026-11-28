import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Zap } from 'lucide-react'
import { Button, buttonClass, Card, Field, Modal, Notice, RatingLine } from '../../components/ui'
import { useMe } from '../../app/auth'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { formatTime } from '../../lib/format'
import type { Rating } from '../../lib/types'
import { celebrate } from '../../lib/celebrate'

interface FreeSupport {
  id: string
  name: string
  rating: Rating
  starts_at: string
}

interface MyRequest {
  id: string
  support_name: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  starts_at: string | null
  seconds_left: number
}

const timeOf = (iso: string | null) => (iso ? formatTime(iso) : '')

function Countdown({ seconds, from }: { seconds: number; from: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const left = Math.max(0, Math.ceil((from + seconds * 1000 - now) / 1000))
  return (
    <span role="timer" className="font-semibold tabular-nums">
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  )
}

export function LessonNow({ blocked }: { blocked: boolean }) {
  const me = useMe()
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<FreeSupport | null>(null)
  const [topic, setTopic] = useState('')
  const enabled = me.instant_enabled && !blocked

  const mine = useQuery({
    queryKey: ['instant-inbox'],
    queryFn: () => rpc<MyRequest | null>('instant_inbox'),
    refetchInterval: 5_000,
    enabled,
  })
  const free = useQuery({
    queryKey: ['instant-supports'],
    queryFn: () => rpc<{ supports: FreeSupport[]; reason: string | null }>('instant_supports'),
    refetchInterval: 15_000,
    enabled,
  })
  const refresh = () => queryClient.invalidateQueries()

  const send = useMutation({
    mutationFn: (support: string) => rpc('instant_request', { p_support: support, p_topic: topic }),
    onSuccess: () => {
      toast(t('now.sent'))
      setAsking(null)
      setTopic('')
      refresh()
    },
    onError: (error) => {
      toast(errorText(error), true)
      refresh()
    },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => rpc('instant_cancel', { p_request: id }),
    onSettled: refresh,
  })

  if (!enabled) return null
  const request = mine.data
  const waiting = request?.status === 'pending'

  return (
    <Card className="mb-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Zap className="size-4 text-warn" aria-hidden />
        {t('now.title')}
      </h2>
      <p className="mb-3 text-muted">{t('now.subtitle')}</p>

      {waiting && (
        <Notice tone="brand">
          <p>{t('now.waiting', { name: request.support_name, time: timeOf(request.starts_at) })}</p>
          <p className="mb-2 text-sm">
            {t('now.time_left')} <Countdown seconds={request.seconds_left} from={mine.dataUpdatedAt} />
          </p>
          <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(request.id)}>
            {t('now.cancel')}
          </Button>
        </Notice>
      )}
      {request?.status === 'accepted' && (
        <Notice tone="brand">
          <p className="mb-2">{t('now.accepted', { name: request.support_name, time: timeOf(request.starts_at) })}</p>
          <Link to="/" className={buttonClass('primary', 'sm')}>{t('nav.home')}</Link>
        </Notice>
      )}
      {(request?.status === 'declined' || request?.status === 'expired') && (
        <div className="mb-3">
          <Notice tone="warn">{t(`now.${request.status}`, { name: request.support_name })}</Notice>
        </div>
      )}

      {!waiting && request?.status !== 'accepted' && free.data?.reason && (
        <p className="text-sm text-muted">{errorText(new Error(free.data.reason))}</p>
      )}
      {!waiting && request?.status !== 'accepted' && !free.data?.reason && (
        free.data && free.data.supports.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line">
            {free.data.supports.map((support) => (
              <li key={support.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{support.name}</span>
                  <span className="block text-sm font-semibold text-brand">{t('now.at', { time: timeOf(support.starts_at) })}</span>
                  <RatingLine {...support.rating} />
                </span>
                <Button size="sm" onClick={() => setAsking(support)}>{t('now.ask')}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t('now.none')}</p>
        )
      )}

      {asking && (
        <Modal title={t('now.ask_title', { name: asking.name })} onClose={() => setAsking(null)}>
          <Notice tone="warn">{t('now.rule', { time: timeOf(asking.starts_at) })}</Notice>
          <div className="mt-3">
            <Field label={t('now.topic')}>
              {(id, className) => (
                <input id={id} className={`${className} h-11`} maxLength={300} value={topic}
                  onChange={(event) => setTopic(event.target.value)} />
              )}
            </Field>
          </div>
          <Button block className="mt-3" loading={send.isPending} onClick={() => send.mutate(asking.id)}>
            {t('now.send')}
          </Button>
        </Modal>
      )}
    </Card>
  )
}

interface Incoming {
  id: string
  student_name: string
  topic: string
  starts_at: string | null
  seconds_left: number
}

export function AtCenter() {
  const me = useMe()
  const t = useText()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['presence'],
    queryFn: () => rpc<boolean>('support_presence'),
    enabled: me.instant_enabled,
  })
  const change = useMutation({
    mutationFn: (present: boolean) => rpc('set_at_center', { p_present: present }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['presence'] }),
  })
  if (!me.instant_enabled || data === undefined) return null
  return (
    <Card>
      <h2 className="flex items-center gap-2 font-semibold">
        <Zap className="size-4 text-warn" aria-hidden />
        {t('now.here_title')}
      </h2>
      <p className="mb-3 text-muted">{t(data ? 'now.here_on' : 'now.here_off')}</p>
      <Button
        size="sm"
        variant={data ? 'secondary' : 'primary'}
        aria-pressed={data}
        loading={change.isPending}
        onClick={() => change.mutate(!data)}
      >
        {t(data ? 'now.leave_button' : 'now.here_button')}
      </Button>
    </Card>
  )
}

export function InstantInbox() {
  const me = useMe()
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['instant-inbox'],
    queryFn: () => rpc<Incoming[]>('instant_inbox'),
    refetchInterval: 5_000,
    enabled: me.instant_enabled,
  })
  const answer = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      rpc('instant_answer', { p_request: id, p_accept: accept }),
    onSuccess: (_, { accept }) => {
      toast(t(accept ? 'now.accepted_support' : 'now.declined_support'))
      if (accept) celebrate()
    },
    onError: (error) => toast(errorText(error), true),
    onSettled: () => queryClient.invalidateQueries(),
  })

  if (!me.instant_enabled || !data || data.length === 0) return null
  return (
    <Notice tone="brand" title={t('now.inbox_title')}>
      <p className="mb-3">{t('now.inbox_hint')}</p>
      <ul className="flex flex-col gap-2">
        {data.map((request) => (
          <li key={request.id} className="rounded-lg bg-surface p-3">
            <p className="font-medium">{request.student_name}</p>
            <p className="text-sm font-semibold">{t('now.at', { time: timeOf(request.starts_at) })}</p>
            {request.topic && <p className="text-sm text-muted">{request.topic}</p>}
            <p className="text-sm text-muted">
              {t('now.time_left')} <Countdown seconds={request.seconds_left} from={dataUpdatedAt} />
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                loading={answer.isPending && answer.variables?.id === request.id && answer.variables.accept}
                onClick={() => answer.mutate({ id: request.id, accept: true })}
              >
                {t('now.accept')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => answer.mutate({ id: request.id, accept: false })}
              >
                {t('now.decline')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Notice>
  )
}
