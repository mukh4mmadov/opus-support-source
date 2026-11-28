import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { BellRing, ChevronRight } from 'lucide-react'
import { Button, EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { currentSubscription, enablePush, isIos, pushSupported } from '../../lib/push'
import type { Notification } from '../../lib/types'

function PushSetting() {
  const t = useText()
  const toast = useToast()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    currentSubscription().then((subscription) => setEnabled(Boolean(subscription))).catch(() => undefined)
  }, [])

  if (!pushSupported()) {
    return isIos() ? <p className="mb-3 text-sm text-muted">{t('alerts.push_hint_ios')}</p> : null
  }
  if (enabled) return <p className="mb-3 text-sm text-ok">{t('alerts.push_on')}</p>

  async function turnOn() {
    setBusy(true)
    const ok = await enablePush().catch(() => false)
    setBusy(false)
    setEnabled(ok)
    if (!ok) toast(t('alerts.push_denied'), true)
  }

  return (
    <Button variant="secondary" block className="mb-3" loading={busy} onClick={turnOn}>
      <BellRing className="size-4" aria-hidden />
      {t('alerts.enable_push')}
    </Button>
  )
}

export function Alerts() {
  const t = useText()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => rpc<Notification[]>('notifications_list'),
    refetchInterval: 20_000,
  })

  const markRead = useMutation({
    mutationFn: (id?: string) => rpc('notifications_mark_read', id ? { p_id: id } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  const hasUnread = data.some((item) => !item.read_at)

  return (
    <>
      <PageHeader
        title={t('alerts.title')}
        action={hasUnread && (
          <Button size="sm" variant="ghost" onClick={() => markRead.mutate(undefined)}>
            {t('alerts.read_all')}
          </Button>
        )}
      />
      <PushSetting />
      {data.length === 0 && <EmptyState title={t('alerts.empty')} />}
      <ul className="flex flex-col gap-2">
        {data.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                if (!item.read_at) markRead.mutate(item.id)
                if (item.link) navigate(item.link)
              }}
              className={clsx(
                'w-full rounded-xl border p-3 text-left',
                item.read_at ? 'border-line bg-surface' : 'border-brand bg-brand-soft',
              )}
            >
              <p className="flex items-start justify-between gap-2 font-semibold">
                {item.title}
                {item.link && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
              </p>
              <p>{item.body}</p>
              <p className="text-sm text-muted">{formatDateTime(item.created_at)}</p>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
