import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, SectionTitle, Spinner,
} from '../../components/ui'
import { rpc } from '../../lib/api'
import { AffectedLessons, type AffectedLesson } from '../../components/AffectedLessons'
import { formatDay, todayInTashkent } from '../../lib/format'
import type { AdminUser } from '../../lib/types'
import { Cell, Table, useAction } from './shared'

interface ClosureRow {
  id: string
  closed_on: string
  start_time: string | null
  end_time: string | null
  reason: string
  support_id: string | null
  support_name: string | null
  same_day: boolean
}

export function Days() {
  const [date, setDate] = useState('')
  const [support, setSupport] = useState('')
  const [reason, setReason] = useState('')
  const [wholeDay, setWholeDay] = useState(true)
  const [from, setFrom] = useState('14:00')
  const [to, setTo] = useState('15:00')
  const [confirming, setConfirming] = useState(false)

  const [showPast, setShowPast] = useState(false)
  const closures = useQuery({
    queryKey: ['admin-closures', showPast],
    queryFn: () => rpc<ClosureRow[]>('admin_closures', { p_past: showPast }),
  })
  const supports = useQuery({
    queryKey: ['admin-users', 'support', ''],
    queryFn: () => rpc<AdminUser[]>('admin_list_users', { p_role: 'support', p_search: '' }),
  })

  const close = useAction(async () => {
    await rpc('close_day', {
      p_support: support || null,
      p_date: date,
      p_reason: reason,
      ...(wholeDay ? {} : { p_from: from, p_to: to }),
    })
    setDate('')
    setReason('')
    setConfirming(false)
  }, 'Day closed.')
  const reopen = useAction((id: string) => rpc('reopen_day', { p_closure: id }), 'Day reopened.')

  const preview = useQuery({
    queryKey: ['closure-preview', support || null, date, wholeDay, from, to],
    queryFn: () => rpc<AffectedLesson[]>('closure_preview', {
      p_support: support || null,
      p_date: date,
      ...(wholeDay ? {} : { p_from: from, p_to: to }),
    }),
    enabled: confirming,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setConfirming(true)
  }

  const who = supports.data?.find((user) => user.id === support)

  return (
    <>
      <PageHeader
        title="Closed days"
        subtitle="Close a day or hours for one support teacher or the whole center. The admin can do this on the day itself."
      />
      <Card>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">
            {(id, className) => (
              <input id={id} type="date" required min={todayInTashkent()} className={`${className} h-11`}
                value={date} onChange={(event) => setDate(event.target.value)} />
            )}
          </Field>
          <Field label="Who">
            {(id, className) => (
              <select id={id} className={`${className} h-11`} value={support}
                onChange={(event) => setSupport(event.target.value)}>
                <option value="">Whole center</option>
                {supports.data?.map((user) => (
                  <option key={user.id} value={user.id}>{user.first_name} {user.last_name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Reason">
            {(id, className) => (
              <input id={id} className={`${className} h-11`} value={reason}
                onChange={(event) => setReason(event.target.value)} />
            )}
          </Field>
          <label className="flex items-center gap-2 sm:col-span-3">
            <input type="checkbox" className="size-4" checked={wholeDay}
              onChange={(event) => setWholeDay(event.target.checked)} />
            Whole day
          </label>
          {!wholeDay && (
            <>
              <Field label="From">
                {(id, className) => (
                  <input id={id} type="time" required className={`${className} h-11`} value={from}
                    onChange={(event) => setFrom(event.target.value)} />
                )}
              </Field>
              <Field label="To">
                {(id, className) => (
                  <input id={id} type="time" required className={`${className} h-11`} value={to}
                    onChange={(event) => setTo(event.target.value)} />
                )}
              </Field>
            </>
          )}
          <div className="sm:col-span-3"><Button type="submit">Close</Button></div>
        </form>
      </Card>

      <SectionTitle>{showPast ? 'All closed days' : 'Upcoming closed days'}</SectionTitle>
      <label className="mb-3 flex items-center gap-2">
        <input type="checkbox" className="size-4" checked={showPast}
          onChange={(event) => setShowPast(event.target.checked)} />
        Show past days too
      </label>
      {closures.isPending && <Spinner />}
      {closures.isError && <ErrorState onRetry={closures.refetch} />}
      {closures.data?.length === 0 && <EmptyState title="No closed days" />}
      {closures.data && closures.data.length > 0 && (
        <Table head={['Date', 'Who', 'Reason', '']}>
          {closures.data.map((closure) => (
            <tr key={closure.id}>
              <Cell className="font-medium">
                {formatDay(closure.closed_on)}
                {closure.start_time && <span className="block text-sm text-muted">{closure.start_time}-{closure.end_time}</span>}
              </Cell>
              <Cell>
                {closure.support_name ?? 'Whole center'}
                {closure.same_day && <span className="block"><Badge tone="warn">On the day</Badge></span>}
              </Cell>
              <Cell className="text-muted">{closure.reason}</Cell>
              <Cell>
                <Button size="sm" variant="secondary" onClick={() => reopen.mutate(closure.id)}>Reopen</Button>
              </Cell>
            </tr>
          ))}
        </Table>
      )}

      {confirming && (
        <ConfirmDialog
          title="Close day"
          body={`Close ${formatDay(date)} for ${who ? `${who.first_name} ${who.last_name}` : 'the whole center'}? Booked students will be notified.`}
          loading={close.isPending}
          onConfirm={() => close.mutate()}
          onClose={() => setConfirming(false)}
        >
          <AffectedLessons lessons={preview.data} showSupport={!support} />
        </ConfirmDialog>
      )}
    </>
  )
}
