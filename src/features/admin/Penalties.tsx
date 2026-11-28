import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Badge, Button, EmptyState, ErrorState, Field, Modal, PageHeader, SectionTitle, Spinner,
} from '../../components/ui'
import { rpc } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Cell, Table, useAction } from './shared'

interface Data {
  bans: {
    id: string
    student_id: string
    student_name: string
    starts_at: string
    ends_at: string
    reason: string
    lifted_at: string | null
    is_active: boolean
  }[]
  penalties: {
    id: string
    student_id: string
    student_name: string
    kind: string
    note: string
    revoked_at: string | null
    created_at: string
  }[]
}

const toTashkent = (value: string) => `${value}:00+05:00`

function ChangeBan({ ban, onClose }: { ban: Data['bans'][number]; onClose: () => void }) {
  const [until, setUntil] = useState('')
  const save = useAction(async () => {
    await rpc('admin_update_ban', { p_ban: ban.id, p_ends_at: toTashkent(until) })
    onClose()
  }, 'Ban changed.')

  return (
    <Modal title={`Change ban: ${ban.student_name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-muted">Now until {formatDateTime(ban.ends_at)}</p>
        <Field label="New end">
          {(id, className) => (
            <input id={id} type="datetime-local" className={`${className} h-11`} value={until}
              onChange={(event) => setUntil(event.target.value)} />
          )}
        </Field>
        <Button disabled={!until} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Modal>
  )
}

export function Penalties() {
  const [limit, setLimit] = useState(300)
  const [changing, setChanging] = useState<Data['bans'][number] | null>(null)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-penalties', limit],
    queryFn: () => rpc<Data>('admin_penalties', { p_limit: limit }),
  })
  const lift = useAction((id: string) => rpc('admin_lift_ban', { p_ban: id }), 'Ban lifted.')
  const revoke = useAction((id: string) => rpc('admin_revoke_penalty', { p_penalty: id }), 'Removed.')

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  const student = (id: string, name: string) => (
    <Link to={`/admin/users/${id}`} className="font-medium hover:underline">{name}</Link>
  )

  return (
    <>
      <PageHeader title="Bans & warnings" subtitle="To ban someone by hand, open their student page." />

      <SectionTitle>Bans</SectionTitle>
      {data.bans.length === 0 ? <EmptyState title="No bans yet" /> : (
        <Table head={['Student', 'From', 'Until', 'Reason', '']}>
          {data.bans.map((ban) => (
            <tr key={ban.id}>
              <Cell>{student(ban.student_id, ban.student_name)}</Cell>
              <Cell className="whitespace-nowrap">{formatDateTime(ban.starts_at)}</Cell>
              <Cell className="whitespace-nowrap">{formatDateTime(ban.ends_at)}</Cell>
              <Cell>{ban.reason === 'no_show' ? 'Missed lesson' : ban.reason}</Cell>
              <Cell>
                {ban.is_active ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => lift.mutate(ban.id)}>Lift</Button>
                    <Button size="sm" variant="secondary" onClick={() => setChanging(ban)}>Change</Button>
                  </span>
                ) : <Badge>{ban.lifted_at ? 'Lifted' : 'Ended'}</Badge>}
              </Cell>
            </tr>
          ))}
        </Table>
      )}

      <SectionTitle>Strikes</SectionTitle>
      {data.penalties.length === 0 ? <EmptyState title="No strikes yet" /> : (
        <Table head={['Student', 'Date', 'Result', 'Note', '']}>
          {data.penalties.map((penalty) => (
            <tr key={penalty.id}>
              <Cell>{student(penalty.student_id, penalty.student_name)}</Cell>
              <Cell className="whitespace-nowrap">{formatDateTime(penalty.created_at)}</Cell>
              <Cell>{penalty.kind === 'ban' ? 'Ban' : 'Warning'}</Cell>
              <Cell className="text-sm text-muted">{penalty.note}</Cell>
              <Cell>
                {penalty.revoked_at
                  ? <Badge>Removed</Badge>
                  : <Button size="sm" variant="secondary" onClick={() => revoke.mutate(penalty.id)}>Remove</Button>}
              </Cell>
            </tr>
          ))}
        </Table>
      )}
      {(data.bans.length >= limit || data.penalties.length >= limit) && (
        <Button variant="secondary" block className="mt-3" onClick={() => setLimit(limit + 300)}>Show more</Button>
      )}
      {changing && <ChangeBan ban={changing} onClose={() => setChanging(null)} />}
    </>
  )
}
