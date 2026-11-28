import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, SectionTitle, Spinner } from '../../components/ui'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { useAction } from './shared'

interface ErrorCase {
  id: number
  at: string
  received_at: string
  last_at: string
  repeats: number
  user_id: string | null
  name: string
  login: string | null
  role: string
  path: string
  message: string
  details: Record<string, unknown>
}

interface ErrorGroup {
  fingerprint: string
  kind: 'server' | 'crash' | 'network'
  message: string
  fn: string
  path: string
  times: number
  people: number
  first_at: string
  last_at: string
  fixed_at: string | null
  cases: ErrorCase[]
}

const KINDS = {
  server: { label: 'Server error', tone: 'bad' },
  crash: { label: 'Page crash', tone: 'bad' },
  network: { label: 'Connection', tone: 'warn' },
} as const

const ROLES: Record<string, string> = {
  admin: 'developer', manager: 'second-level admin', support: 'support teacher', student: 'student',
}

const where = (group: ErrorGroup) =>
  group.kind === 'crash' ? `page ${group.path}` : `request ${group.fn || '(unknown)'}`

function report(group: ErrorGroup) {
  const lines = [
    `${KINDS[group.kind].label}: ${group.message}`,
    `Where: ${where(group)}`,
    `Seen ${group.times} times by ${group.people} people, first ${group.first_at}, last ${group.last_at}`,
  ]
  group.cases.forEach((item, index) => {
    lines.push(
      '',
      `Case ${index + 1}: ${item.at} (device time), received ${item.received_at}, ${item.repeats} times`,
      `Person: ${item.name}, ${ROLES[item.role] ?? item.role}${item.login ? `, login ${item.login}` : ''}`,
      `Page: ${item.path}`,
      `Message: ${item.message}`,
      JSON.stringify(item.details, null, 2),
    )
  })
  return lines.join('\n')
}

function useCopy() {
  const toast = useToast()
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied.')
    } catch {
      toast('Could not copy. Open the details and select the text.', true)
    }
  }
}

function ErrorCard({ group }: { group: ErrorGroup }) {
  const copy = useCopy()
  const fixed = Boolean(group.fixed_at)
  const mark = useAction(
    () => rpc('admin_error_fixed', { p_fingerprint: group.fingerprint, p_fixed: !fixed }),
    fixed ? 'Moved back to open.' : 'Marked as fixed.',
  )
  const kind = KINDS[group.kind]

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={kind.tone}>{kind.label}</Badge>
        <span className="text-sm text-muted">{where(group)}</span>
      </div>
      <p className="mt-2 break-words font-mono text-sm">{group.message}</p>
      <p className="mt-2 text-sm text-muted">
        {group.times} {group.times === 1 ? 'time' : 'times'}, {group.people}{' '}
        {group.people === 1 ? 'person' : 'people'}. Last {formatDateTime(group.last_at)}, first{' '}
        {formatDateTime(group.first_at)}.
        {fixed && ` Fixed ${formatDateTime(group.fixed_at!)}.`}
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Show {group.cases.length} {group.cases.length === 1 ? 'case' : 'cases'}
        </summary>
        <ul className="mt-2 flex flex-col gap-3">
          {group.cases.map((item) => (
            <li key={item.id} className="rounded-lg bg-sunken p-3 text-sm">
              <p>
                <span className="font-medium">{formatDateTime(item.at)}</span>
                {item.repeats > 1 && <span className="text-muted">, {item.repeats} times</span>}
              </p>
              <p>
                {item.user_id ? (
                  <Link to={`/admin/users/${item.user_id}`} className="font-medium hover:underline">{item.name}</Link>
                ) : item.name}
                <span className="text-muted">, {ROLES[item.role] ?? item.role}{item.login && `, ${item.login}`}</span>
              </p>
              <p className="text-muted">Page {item.path}</p>
              {item.message !== group.message && <p className="break-words font-mono">{item.message}</p>}
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-2 text-xs">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => copy(report(group))}>
          <Copy className="size-4" aria-hidden />
          Copy report
        </Button>
        <Button size="sm" variant={fixed ? 'secondary' : 'primary'} loading={mark.isPending} onClick={() => mark.mutate()}>
          {fixed ? 'Not fixed yet' : 'Mark fixed'}
        </Button>
      </div>
    </Card>
  )
}

export function Errors() {
  const [showFixed, setShowFixed] = useState(false)
  const copy = useCopy()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-errors', showFixed],
    queryFn: () => rpc<ErrorGroup[]>('admin_errors', { p_fixed: showFixed }),
    refetchInterval: 60_000,
  })

  const faults = data?.filter((group) => group.kind !== 'network') ?? []
  const connection = data?.filter((group) => group.kind === 'network') ?? []

  return (
    <>
      <PageHeader
        title="Errors"
        subtitle="What went wrong for people in the app. Copy a report to share it."
        action={!showFixed && faults.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => copy(faults.map(report).join('\n\n-----\n\n'))}>
            <Copy className="size-4" aria-hidden />
            Copy all
          </Button>
        )}
      />

      <div className="mb-3 flex gap-2">
        {[false, true].map((value) => (
          <Button
            key={String(value)}
            size="sm"
            variant={showFixed === value ? 'primary' : 'secondary'}
            aria-pressed={showFixed === value}
            onClick={() => setShowFixed(value)}
          >
            {value ? 'Fixed' : 'Open'}
          </Button>
        ))}
      </div>

      {isPending ? <Spinner /> : isError ? <ErrorState onRetry={refetch} /> : (
        <>
          {faults.length === 0 ? (
            <EmptyState
              title={showFixed ? 'Nothing marked fixed yet' : 'No errors'}
              hint={showFixed ? undefined : 'When something breaks for someone, it shows up here.'}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {faults.map((group) => <ErrorCard key={group.fingerprint} group={group} />)}
            </div>
          )}
          {connection.length > 0 && (
            <>
              <SectionTitle>Connection problems</SectionTitle>
              <p className="mb-3 text-sm text-muted">
                Requests that did not reach the server, mostly a weak or lost internet on the phone.
                Many of them for one request can mean the server is slow.
              </p>
              <div className="flex flex-col gap-3">
                {connection.map((group) => <ErrorCard key={group.fingerprint} group={group} />)}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
