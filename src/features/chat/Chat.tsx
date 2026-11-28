import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Send, Trash2, Undo2 } from 'lucide-react'
import { BackLink, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useMe } from '../../app/auth'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { NETWORK_ERROR, rpc } from '../../lib/api'
import { formatDate, formatDateTime, formatTime } from '../../lib/format'
import type { ChatThread as Thread, ChatView } from '../../lib/types'

export function ChatList({ title }: { title?: string }) {
  const me = useMe()
  const t = useText()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['chat', 'list'],
    queryFn: () => rpc<Thread[]>('chat_list'),
    refetchInterval: 15_000,
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  const nameOf = (thread: Thread) => {
    if (me.role === 'admin') return `${thread.student_name} · ${thread.support_name}`
    return me.id === thread.student_id ? thread.support_name : thread.student_name
  }

  return (
    <>
      <PageHeader title={title ?? t('chat.title')} />
      {data.length === 0 && <EmptyState title={t('chat.empty')} />}
      <ul className="flex flex-col gap-2">
        {data.map((thread) => (
          <li key={thread.id}>
            <Link
              to={`/chat/${thread.id}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:bg-sunken"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{nameOf(thread)}</p>
                <p className="text-sm text-muted">{formatDate(thread.starts_at)}, {formatTime(thread.starts_at)}</p>
                {thread.last_message && <p className="truncate text-sm">{thread.last_message}</p>}
              </div>
              {thread.unread > 0 && (
                <span className="rounded-full bg-brand px-2 text-sm font-semibold text-brand-fg">{thread.unread}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

export function ChatThread() {
  const { id } = useParams()
  const me = useMe()
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['chat', 'thread', id],
    queryFn: () => rpc<ChatView>('chat_messages', { p_booking: id }),
    retry: (count, failure) => failure.message === NETWORK_ERROR && count < 3,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 5_000),
  })

  const send = useMutation({
    mutationFn: (body: string) =>
      rpc(me.role === 'admin' ? 'admin_send_message' : 'send_message', { p_booking: id, p_body: body }),
    onSuccess: () => {
      setText('')
      queryClient.invalidateQueries({ queryKey: ['chat'] })
    },
    onError: (error) => toast(errorText(error), true),
  })

  const moderate = useMutation({
    mutationFn: ({ message, deleted }: { message: string; deleted: boolean }) =>
      rpc('admin_delete_message', { p_message: message, p_deleted: deleted }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat'] }),
    onError: (error) => toast(errorText(error), true),
  })

  const count = data?.messages.length
  useEffect(() => {
    bottom.current?.scrollIntoView()
  }, [count])

  if (isPending) return <Spinner />
  if (isError && error.message === NETWORK_ERROR) return <ErrorState onRetry={refetch} />
  if (isError) {
    return (
      <>
        <BackLink to={me.role === 'admin' ? '/admin/chats' : '/chat'} />
        <EmptyState title={t('chat.unavailable')} hint={t('chat.unavailable_hint')} />
      </>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (text.trim()) send.mutate(text)
  }

  const { booking } = data
  const heading = me.role === 'admin'
    ? `${booking.student_name} · ${booking.support_name}`
    : me.id === booking.student_id ? booking.support_name : booking.student_name

  return (
    <>
      <BackLink to={me.role === 'admin' ? '/admin/chats' : '/chat'} />
      <PageHeader title={heading} subtitle={formatDateTime(booking.starts_at)} />

      {booking.topic && <p className="mb-3 rounded-lg bg-sunken px-3 py-2 text-sm">{booking.topic}</p>}
      {me.role !== 'admin' && <p className="mb-3 text-center text-xs text-muted">{t('chat.notice')}</p>}

      <div className="flex flex-col gap-2 pb-2">
        {data.messages.length === 0 && <p className="py-8 text-center text-muted">{t('chat.start')}</p>}
        {data.messages.map((message) => {
          const mine = message.sender_id === me.id
          return (
            <div
              key={message.id}
              className={clsx(
                'max-w-[80%] rounded-2xl px-3 py-2',
                mine ? 'self-end bg-brand text-brand-fg' : 'self-start border border-line bg-surface',
                message.deleted_at && 'opacity-60',
              )}
            >
              {(me.role === 'admin' || message.from_admin) && !mine && (
                <p className="text-xs font-medium text-muted">{message.sender}</p>
              )}
              <p className={clsx('whitespace-pre-wrap break-words', message.deleted_at && 'line-through')}>
                {message.body}
              </p>
              {me.role === 'admin' && (
                <button
                  type="button"
                  aria-label={message.deleted_at ? 'Restore message' : 'Delete message'}
                  className="mt-1 inline-flex items-center gap-1 text-xs opacity-75 hover:opacity-100"
                  onClick={() => moderate.mutate({ message: message.id, deleted: !message.deleted_at })}
                >
                  {message.deleted_at
                    ? <><Undo2 className="size-3" aria-hidden /> Restore</>
                    : <><Trash2 className="size-3" aria-hidden /> Delete</>}
                </button>
              )}
              <p className={clsx('text-right text-[11px]', mine ? 'opacity-75' : 'text-muted')}>
                {formatTime(message.created_at)}
              </p>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      {data.can_send ? (
        <form onSubmit={submit} className="sticky bottom-20 flex gap-2 bg-page py-2 lg:bottom-0">
          <input
            aria-label={t('chat.placeholder')}
            className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3"
            placeholder={t('chat.placeholder')}
            maxLength={2000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" aria-label="Send" loading={send.isPending} disabled={!text.trim()}>
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      ) : (
        me.role !== 'admin' && <p className="py-3 text-center text-sm text-muted">{t('chat.closed')}</p>
      )}
    </>
  )
}
