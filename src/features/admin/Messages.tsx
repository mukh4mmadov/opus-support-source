import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, SectionTitle, Spinner,
} from '../../components/ui'
import { rpc } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { AdminUser } from '../../lib/types'
import { Cell, Table, useAction } from './shared'

interface SentNotification {
  id: string
  type: string
  title: string
  body: string
  to: string
  read_at: string | null
  created_at: string
}

export function Messages() {
  const [audience, setAudience] = useState('all')
  const [person, setPerson] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [limit, setLimit] = useState(200)

  const people = useQuery({
    queryKey: ['admin-users', 'all'],
    queryFn: () => rpc<AdminUser[]>('admin_list_users'),
  })
  const log = useQuery({
    queryKey: ['admin-notifications', limit],
    queryFn: () => rpc<SentNotification[]>('admin_notifications', { p_limit: limit }),
  })

  const send = useAction(async () => {
    await rpc('admin_send_notice', {
      p_audience: audience,
      p_user: audience === 'one' ? person : null,
      p_title: title,
      p_body: body,
    })
    setTitle('')
    setBody('')
  }, 'Message sent.')

  const ready = title.trim() && body.trim() && (audience !== 'one' || person)

  return (
    <>
      <PageHeader
        title="Send a message"
        subtitle="It arrives as a notification, on the phone too if notifications are on."
      />
      <Card>
        <div className="flex flex-col gap-3">
          <Field label="Send to">
            {(id, className) => (
              <select id={id} className={`${className} h-11`} value={audience}
                onChange={(event) => setAudience(event.target.value)}>
                <option value="all">Everyone</option>
                <option value="student">All students</option>
                <option value="support">All support teachers</option>
                <option value="one">One person</option>
              </select>
            )}
          </Field>
          {audience === 'one' && (
            <Field label="Person">
              {(id, className) => (
                <select id={id} className={`${className} h-11`} value={person}
                  onChange={(event) => setPerson(event.target.value)}>
                  <option value="">Choose</option>
                  {people.data?.filter((user) => user.is_active && user.role !== 'admin').map((user) => (
                    <option key={user.id} value={user.id}>{user.first_name} {user.last_name}</option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Title">
            {(id, className) => (
              <input id={id} className={`${className} h-11`} value={title}
                onChange={(event) => setTitle(event.target.value)} />
            )}
          </Field>
          <Field label="Message">
            {(id, className) => (
              <textarea id={id} rows={3} className={`${className} py-2`} value={body}
                onChange={(event) => setBody(event.target.value)} />
            )}
          </Field>
          <Button disabled={!ready} loading={send.isPending} onClick={() => send.mutate()}>Send</Button>
        </div>
      </Card>

      <SectionTitle>All notifications sent by the site</SectionTitle>
      {log.isPending && <Spinner />}
      {log.isError && <ErrorState onRetry={log.refetch} />}
      {log.data?.length === 0 && <EmptyState title="Nothing sent yet" />}
      {log.data && log.data.length > 0 && (
        <Table head={['When', 'To', 'Message', 'Read']}>
          {log.data.map((item) => (
            <tr key={item.id}>
              <Cell className="whitespace-nowrap text-sm">{formatDateTime(item.created_at)}</Cell>
              <Cell>{item.to}</Cell>
              <Cell>
                <span className="font-medium">{item.title}</span>
                <span className="block text-sm text-muted">{item.body}</span>
              </Cell>
              <Cell>{item.read_at ? <Badge tone="ok">Read</Badge> : <Badge>Not yet</Badge>}</Cell>
            </tr>
          ))}
        </Table>
      )}
      {log.data && log.data.length >= limit && (
        <Button variant="secondary" block className="mt-3" onClick={() => setLimit(limit + 200)}>Show more</Button>
      )}
    </>
  )
}
