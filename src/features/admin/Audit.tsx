import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { rpc } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Cell, Table } from './shared'

interface Entry {
  id: number
  action: string
  entity: string
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
  actor: string
}

const ACTIONS: Record<string, string> = {
  'user.create': 'Created account',
  'user.update': 'Edited account',
  'user.delete': 'Deleted account',
  'user.reset_password': 'Reset password',
  'user.view_password': 'Viewed a password',
  'user.impersonate': 'Signed in as this person',
  'user.change_login': 'Changed a login',
  'user.archive': 'Moved to the archive',
  'user.restore': 'Restored from the archive',
  'booking.edit': 'Edited a lesson',
  'booking.move': 'Moved a lesson',
  'booking.delete': 'Deleted a lesson',
  'waitlist.remove': 'Removed from a waiting list',
  'chat.send': 'Wrote in a chat',
  'chat.delete': 'Deleted a chat message',
  'chat.restore': 'Restored a chat message',
  'notice.send': 'Sent a message',
  'penalty.add': 'Added a warning',
  'ban.update': 'Changed a ban',
  'review.edit': 'Edited a review',
  'booking.create': 'Booked for a student',
  'booking.cancel': 'Cancelled a lesson',
  'booking.mark': 'Marked attendance',
  'booking.check_in': 'Scanned the QR code',
  'booking.auto_no_show': 'Lesson not confirmed in time',
  'complaint.answer': 'Answered a complaint',
  'complaint.delete': 'Deleted a complaint',
  'user.rebook_open': 'Opened booking early',
  'user.ranking': 'Changed ranking visibility',
  'day.close': 'Closed a day',
  'day.reopen': 'Reopened a day',
  'schedule.update': 'Changed working hours',
  'ban.add': 'Added a ban',
  'ban.lift': 'Lifted a ban',
  'penalty.revoke': 'Removed a strike',
  'review.hide': 'Hid or showed a review',
  'review.delete': 'Deleted a review',
  'setting.update': 'Changed a setting',
  'template.update': 'Edited a notification',
  'text.update': 'Edited a text',
  'announcement.save': 'Saved an announcement',
  'announcement.delete': 'Deleted an announcement',
  'error.fixed': 'Marked an error fixed',
  'error.reopen': 'Moved an error back to open',
}

function describe(entry: Entry) {
  const parts = Object.entries(entry.details)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  if (entry.entity === 'setting' || entry.entity === 'text' || entry.entity === 'template') {
    parts.unshift(entry.entity_id ?? '')
  }
  return parts.join(', ')
}

export function Audit() {
  const [limit, setLimit] = useState(300)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-audit', limit],
    queryFn: () => rpc<Entry[]>('admin_audit', { p_limit: limit }),
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  return (
    <>
      <PageHeader title="Activity log" subtitle="Everything the admin changed, and every attendance mark." />
      {data.length === 0 ? <EmptyState title="Nothing yet" /> : (
        <Table head={['When', 'Who', 'What', 'Details']}>
          {data.map((entry) => (
            <tr key={entry.id}>
              <Cell className="whitespace-nowrap text-sm">{formatDateTime(entry.created_at)}</Cell>
              <Cell>{entry.actor}</Cell>
              <Cell>{ACTIONS[entry.action] ?? entry.action}</Cell>
              <Cell className="text-sm text-muted">{describe(entry)}</Cell>
            </tr>
          ))}
        </Table>
      )}
      {data.length >= limit && (
        <Button variant="secondary" block className="mt-3" onClick={() => setLimit(limit + 300)}>Show more</Button>
      )}
    </>
  )
}
