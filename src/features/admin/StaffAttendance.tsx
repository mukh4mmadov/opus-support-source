import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, QrCode } from 'lucide-react'
import {
  Badge, Button, buttonClass, EmptyState, ErrorState, Field, Modal, PageHeader, SectionTitle, Spinner,
} from '../../components/ui'
import { useMe } from '../../app/auth'
import { rpc } from '../../lib/api'
import { addDays, formatDay, formatTime, todayInTashkent } from '../../lib/format'
import type { AdminUser, StaffDay, StaffDayStatus } from '../../lib/types'
import { DayFacts, DayStatusBadge, workTime } from '../attendance/shared'
import { downloadWorkbook } from './excel'
import { Cell, StatTile, Table, useAction } from './shared'

type Tab = 'today' | 'day' | 'month'

const ORDER: StaffDayStatus[] = ['missing', 'waiting', 'here', 'done', 'absent', 'excused', 'off']

const useDays = (from: string | null, to: string | null, live = false) => useQuery({
  queryKey: ['staff-attendance', from, to],
  queryFn: () => rpc<StaffDay[]>('staff_attendance_list', { p_from: from, p_to: to }),
  refetchInterval: live ? 15_000 : false,
})

const hm = (iso: string | null) => (iso ? formatTime(iso) : '')

interface MarkTarget {
  support: string
  date: string
}

function MarkDialog({ target, onClose }: { target: Partial<MarkTarget>; onClose: () => void }) {
  const supports = useQuery({
    queryKey: ['admin-users', 'support', ''],
    queryFn: () => rpc<AdminUser[]>('admin_list_users', { p_role: 'support', p_search: '' }),
  })
  const [support, setSupport] = useState(target.support ?? '')
  const [date, setDate] = useState(target.date ?? todayInTashkent())
  const [arrived, setArrived] = useState('')
  const [left, setLeft] = useState('')
  const [note, setNote] = useState('')
  const save = useAction(async () => {
    await rpc('staff_mark', {
      p_support: support, p_date: date, p_arrived: arrived || null, p_left: left || null, p_note: note,
    })
    onClose()
  }, 'Saved.')

  return (
    <Modal title="Mark by hand" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        For when the QR screen or the face check could not be used. The report shows who marked it.
        Reception fills in an empty time only; the developer can also correct one.
      </p>
      <div className="flex flex-col gap-3">
        <Field label="Support teacher">
          {(id, className) => (
            <select id={id} className={`${className} h-11`} value={support}
              onChange={(event) => setSupport(event.target.value)}>
              <option value="">Choose</option>
              {supports.data?.map((user) => (
                <option key={user.id} value={user.id}>{user.first_name} {user.last_name}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Date">
          {(id, className) => (
            <input id={id} type="date" max={todayInTashkent()} className={`${className} h-11`} value={date}
              onChange={(event) => setDate(event.target.value)} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrived">
            {(id, className) => (
              <input id={id} type="time" className={`${className} h-11`} value={arrived}
                onChange={(event) => setArrived(event.target.value)} />
            )}
          </Field>
          <Field label="Left">
            {(id, className) => (
              <input id={id} type="time" className={`${className} h-11`} value={left}
                onChange={(event) => setLeft(event.target.value)} />
            )}
          </Field>
        </div>
        <Field label="Note" hint="Why it is marked by hand.">
          {(id, className) => (
            <input id={id} className={`${className} h-11`} value={note}
              onChange={(event) => setNote(event.target.value)} />
          )}
        </Field>
        <Button
          disabled={!support || !date || (!arrived && !left) || !note.trim()}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </Modal>
  )
}

function ExcuseDialog({ day, onClose }: { day: StaffDay; onClose: () => void }) {
  const [note, setNote] = useState(day.excuse_note)
  const save = useAction(async (excused: boolean) => {
    await rpc('staff_excuse', {
      p_support: day.support_id, p_date: day.work_date, p_excused: excused, p_note: note,
    })
    onClose()
  }, 'Saved.')
  return (
    <Modal title={`${day.support_name}, ${formatDay(day.work_date)}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">An excused day is not counted as late, early or absent.</p>
      <Field label="Reason">
        {(id, className) => (
          <input id={id} className={`${className} h-11`} value={note}
            onChange={(event) => setNote(event.target.value)} />
        )}
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!note.trim()} loading={save.isPending} onClick={() => save.mutate(true)}>Excuse</Button>
        {day.excused && (
          <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate(false)}>Remove excuse</Button>
        )}
      </div>
    </Modal>
  )
}

interface FaceCheckRow {
  id: string
  at: string
  kind: 'arrive' | 'leave'
  similarity: number
  passed: boolean
  real: number | null
  live: number | null
  distance_m: number
  photo: string | null
}

function PhotosDialog({ day, onClose }: { day: StaffDay; onClose: () => void }) {
  const checks = useQuery({
    queryKey: ['staff-face-checks', day.support_id, day.work_date],
    queryFn: () => rpc<FaceCheckRow[]>('admin_staff_face_checks', { p_support: day.support_id, p_date: day.work_date }),
  })
  const reference = useQuery({
    queryKey: ['staff-face', day.support_id],
    queryFn: () => rpc<{ photo: string } | null>('admin_staff_face', { p_user: day.support_id }),
  })
  return (
    <Modal title={`Face checks: ${day.support_name}, ${formatDay(day.work_date)}`} onClose={onClose}>
      {reference.data && (
        <figure className="mb-3">
          <img src={reference.data.photo} alt="Uploaded photo" className="h-32 rounded-lg" />
          <figcaption className="text-sm text-muted">Uploaded photo</figcaption>
        </figure>
      )}
      {checks.isPending && <Spinner />}
      {checks.data?.length === 0 && <p className="text-muted">No face checks this day.</p>}
      <ul className="grid grid-cols-2 gap-3">
        {checks.data?.map((check) => (
          <li key={check.id}>
            {check.photo
              ? <img src={check.photo} alt={`Face check at ${formatTime(check.at)}`} className="w-full rounded-lg" />
              : <p className="text-sm text-muted">Photo deleted (older than the keep period).</p>}
            <p className="text-sm">
              {formatTime(check.at)} · {check.kind === 'arrive' ? 'arriving' : 'leaving'}{' '}
              <Badge tone={check.passed ? 'ok' : 'bad'}>{check.passed ? 'Match' : 'No match'}</Badge>
            </p>
            <p className="text-sm text-muted">
              Match {Math.round(check.similarity * 100)}% · {check.distance_m} m from the center
            </p>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function DayTable({ days, showDate }: { days: StaffDay[]; showDate?: boolean }) {
  const me = useMe()
  const [mark, setMark] = useState<Partial<MarkTarget> | null>(null)
  const [excuse, setExcuse] = useState<StaffDay | null>(null)
  const [photos, setPhotos] = useState<StaffDay | null>(null)
  const sorted = [...days].sort((a, b) => showDate
    ? b.work_date.localeCompare(a.work_date) || a.support_name.localeCompare(b.support_name)
    : ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.support_name.localeCompare(b.support_name))

  return (
    <>
      <Table head={[...(showDate ? ['Date'] : []), 'Support teacher', 'Work time', 'Status', 'Details', '']}>
        {sorted.map((day) => (
          <tr key={`${day.support_id}-${day.work_date}`}>
            {showDate && <Cell className="whitespace-nowrap">{formatDay(day.work_date)}</Cell>}
            <Cell className="font-medium">
              <Link to={`/admin/users/${day.support_id}`} className="hover:underline">{day.support_name}</Link>
            </Cell>
            <Cell className="whitespace-nowrap text-muted">{workTime(day) ?? 'No work time'}</Cell>
            <Cell>
              <DayStatusBadge status={day.status} />
              {day.face_failed > 0 && (
                <span className="mt-1 block"><Badge tone="bad">Face failed {day.face_failed}×</Badge></span>
              )}
            </Cell>
            <Cell>
              <DayFacts day={day} />
              {day.manual_note && <p className="text-sm text-muted">Note: {day.manual_note}</p>}
            </Cell>
            <Cell className="whitespace-nowrap">
              <div className="flex flex-col items-start gap-1">
                <Button size="sm" variant="ghost" onClick={() => setMark({ support: day.support_id, date: day.work_date })}>
                  Mark by hand
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExcuse(day)}>
                  {day.excused ? 'Excused…' : 'Excuse'}
                </Button>
                {me.role === 'admin' && day.face_checks > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setPhotos(day)}>Photos</Button>
                )}
              </div>
            </Cell>
          </tr>
        ))}
      </Table>
      {mark && <MarkDialog target={mark} onClose={() => setMark(null)} />}
      {excuse && <ExcuseDialog day={excuse} onClose={() => setExcuse(null)} />}
      {photos && <PhotosDialog day={photos} onClose={() => setPhotos(null)} />}
    </>
  )
}

function TodayView() {
  const today = todayInTashkent()
  const { data, isPending, isError, refetch } = useDays(null, null, true)
  const [mark, setMark] = useState(false)
  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />
  const count = (status: StaffDayStatus) => data.filter((day) => day.status === status).length
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="At the center" value={count('here')} />
        <StatTile label="Not here yet" value={count('waiting') + count('missing')} />
        <StatTile label="Came late" value={data.filter((day) => day.is_late).length} />
        <StatTile label="Left" value={count('done')} />
      </div>
      <div className="mb-3">
        <Button size="sm" variant="secondary" onClick={() => setMark(true)}>Mark by hand</Button>
      </div>
      {data.length === 0
        ? <EmptyState title="Nobody is expected today" hint="Days appear here before work time starts, while attendance is on." />
        : <DayTable days={data} />}
      {mark && <MarkDialog target={{ date: data[0]?.work_date ?? today }} onClose={() => setMark(false)} />}
    </>
  )
}

function DayView() {
  const [date, setDate] = useState(addDays(todayInTashkent(), -1))
  const { data, isPending, isError, refetch } = useDays(date, date)
  return (
    <>
      <Field label="Day">
        {(id, className) => (
          <input id={id} type="date" max={todayInTashkent()} className={`${className} mb-3 h-11 max-w-56`} value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)} />
        )}
      </Field>
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data?.length === 0 && <EmptyState title="No attendance this day" />}
      {data && data.length > 0 && <DayTable days={data} />}
    </>
  )
}

interface Summary {
  name: string
  workDays: number
  came: number
  onTime: number
  late: number
  lateMinutes: number
  early: number
  absent: number
  excused: number
  noLeave: number
  manual: number
  faceFailed: number
  hours: number
}

export function summarize(days: StaffDay[]) {
  const bySupport = new Map<string, Summary>()
  for (const day of days) {
    const row = bySupport.get(day.support_id) ?? {
      name: day.support_name, workDays: 0, came: 0, onTime: 0, late: 0, lateMinutes: 0, early: 0,
      absent: 0, excused: 0, noLeave: 0, manual: 0, faceFailed: 0, hours: 0,
    }
    if (day.expected_start) row.workDays += 1
    if (day.arrived_at) row.came += 1
    if (day.arrived_at && day.expected_start && !day.is_late) row.onTime += 1
    if (day.is_late) {
      row.late += 1
      row.lateMinutes += day.late_minutes
    }
    if (day.is_early) row.early += 1
    if (day.status === 'absent') row.absent += 1
    if (day.status === 'excused') row.excused += 1
    if (day.no_leave) row.noLeave += 1
    if (day.arrive_manual_by || day.leave_manual_by) row.manual += 1
    row.faceFailed += day.face_failed
    row.hours += (day.worked_minutes ?? 0) / 60
    bySupport.set(day.support_id, row)
  }
  return [...bySupport.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function MonthView() {
  const [month, setMonth] = useState(todayInTashkent().slice(0, 7))
  const from = `${month}-01`
  const next = new Date(`${from}T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const to = addDays(next.toISOString().slice(0, 10), -1)
  const { data, isPending, isError, refetch } = useDays(from, to)
  const rows = data ? summarize(data) : []

  async function download() {
    if (!data) return
    await downloadWorkbook(`attendance-${month}.xlsx`, {
      Summary: rows.map((row) => ({
        'Support teacher': row.name,
        'Work days': row.workDays,
        Came: row.came,
        'On time': row.onTime,
        Late: row.late,
        'Late minutes': row.lateMinutes,
        'Left early': row.early,
        Absent: row.absent,
        Excused: row.excused,
        'No leaving scan': row.noLeave,
        'Marked by hand': row.manual,
        'Face check failed': row.faceFailed,
        Hours: Math.round(row.hours * 10) / 10,
      })),
      Days: [...data].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.support_name.localeCompare(b.support_name))
        .map((day) => ({
          Date: day.work_date,
          'Support teacher': day.support_name,
          'Work time': workTime(day) ?? '',
          Status: day.status,
          Arrived: hm(day.arrived_at),
          Left: hm(day.left_at),
          'Counted until (no leaving scan)': day.no_leave ? hm(day.left_estimated) : '',
          'Late minutes': day.is_late ? day.late_minutes : 0,
          'Left early minutes': day.is_early ? day.early_minutes : 0,
          'Worked minutes': day.worked_minutes ?? 0,
          'Arrival marked by': day.arrive_manual_by ?? '',
          'Leaving marked by': day.leave_manual_by ?? '',
          'Hand note': day.manual_note,
          'Excuse note': day.excuse_note,
          'Face check failed': day.face_failed,
        })),
    })
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Month">
          {(id, className) => (
            <input id={id} type="month" className={`${className} h-11`} value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)} />
          )}
        </Field>
        <Button variant="secondary" disabled={!data?.length} onClick={download}>
          <Download className="size-4" aria-hidden />
          Download Excel
        </Button>
      </div>
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data?.length === 0 && <EmptyState title="No attendance this month" />}
      {rows.length > 0 && (
        <Table head={['Support teacher', 'Work days', 'On time', 'Late', 'Left early', 'Absent', 'Excused', 'No leaving scan', 'By hand', 'Hours']}>
          {rows.map((row) => (
            <tr key={row.name}>
              <Cell className="font-medium">{row.name}</Cell>
              <Cell>{row.workDays}</Cell>
              <Cell>{row.onTime}</Cell>
              <Cell>{row.late}{row.late > 0 && <span className="block text-sm text-muted">{row.lateMinutes} min</span>}</Cell>
              <Cell>{row.early}</Cell>
              <Cell>{row.absent}</Cell>
              <Cell>{row.excused}</Cell>
              <Cell>{row.noLeave}</Cell>
              <Cell>{row.manual}</Cell>
              <Cell>{Math.round(row.hours * 10) / 10}</Cell>
            </tr>
          ))}
        </Table>
      )}
      {data && data.length > 0 && (
        <>
          <SectionTitle>Every day</SectionTitle>
          <DayTable days={data} showDate />
        </>
      )}
    </>
  )
}

export function StaffAttendance() {
  const [tab, setTab] = useState<Tab>('today')
  return (
    <>
      <PageHeader
        title="Staff attendance"
        subtitle="When support teachers arrive and leave, checked by the reception QR, the phone's location and a face check."
        action={(
          <Link to="/admin/attendance/qr" className={buttonClass('primary', 'sm')}>
            <QrCode className="size-4" aria-hidden />
            Open the QR screen
          </Link>
        )}
      />
      <div className="mb-4 flex gap-2" role="tablist">
        {(['today', 'day', 'month'] as Tab[]).map((name) => (
          <Button key={name} size="sm" role="tab" aria-selected={tab === name}
            variant={tab === name ? 'primary' : 'secondary'} onClick={() => setTab(name)}>
            {{ today: 'Today', day: 'A past day', month: 'Month' }[name]}
          </Button>
        ))}
      </div>
      {tab === 'today' && <TodayView />}
      {tab === 'day' && <DayView />}
      {tab === 'month' && <MonthView />}
    </>
  )
}
