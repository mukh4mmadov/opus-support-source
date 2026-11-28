import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, PageHeader, SectionTitle, Spinner } from '../../components/ui'
import { rpc } from '../../lib/api'
import { addDays, formatDay, todayInTashkent, WEEKDAYS } from '../../lib/format'
import { downloadExcel } from './excel'
import { Cell, StatTile, Table } from './shared'

interface Stats {
  totals: {
    bookings: number
    attended: number
    no_show: number
    excused: number
    cancelled: number
    support_absent: number
    unmarked: number
    attendance_rate: number
  }
  by_support: {
    name: string
    lessons: number
    instant: number
    no_shows: number
    excused: number
    forgot: number
    absent: number
    unmarked: number
    rating: number
  }[]
  by_day: { day: string; bookings: number }[]
  by_hour: { hour: number; bookings: number }[]
  top_students: { name: string; lessons: number; no_shows: number }[]
}

const SUPPORT_HEAD = [
  'Support teacher', 'Lessons', 'Of which lesson now', 'Students missed', 'Excused', 'Forgot to mark', 'Support absent', 'Not marked', 'Rating',
]

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

function ChartTip({ active, label, payload, format }: {
  active?: boolean
  label?: string | number
  payload?: readonly { value?: number | string }[]
  format: (label: string | number) => string
}) {
  if (!active || !payload?.length || label === undefined) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md">
      <p className="text-muted">{format(label)}</p>
      <p className="font-semibold tabular-nums">{payload[0].value} bookings</p>
    </div>
  )
}

function BookingBars({ data, x, format, tick }: {
  data: Record<string, string | number>[]
  x: string
  format: (label: string | number) => string
  tick: (label: string | number) => string
}) {
  const axis = { fontSize: 12, fill: 'var(--muted)' }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis
          dataKey={x}
          tick={axis}
          tickFormatter={tick}
          tickLine={false}
          axisLine={{ stroke: 'var(--line)' }}
          minTickGap={24}
        />
        <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
        <Tooltip
          cursor={{ fill: 'var(--sunken)' }}
          content={({ active, label, payload }) => (
            <ChartTip
              active={active}
              label={label as string | number | undefined}
              payload={payload as readonly { value?: number }[] | undefined}
              format={format}
            />
          )}
        />
        <Bar dataKey="bookings" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

interface MonthRow {
  name: string
  lessons: number
  instant: number
  hours: number
  no_shows: number
  excused: number
  forgot: number
  absent: number
  unmarked: number
  closed_days: number
  closed_same_day: number
}

function MonthReport() {
  const [month, setMonth] = useState(todayInTashkent().slice(0, 7))
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-month', month],
    queryFn: () => rpc<MonthRow[]>('admin_month_report', { p_month: `${month}-01` }),
    enabled: Boolean(month),
  })
  const head = [
    'Support teacher', 'Lessons', 'Of which lesson now', 'Hours', 'Students missed', 'Excused', 'Forgot to mark', 'Support absent',
    'Not marked', 'Closed days', 'Closed on the day',
  ]

  return (
    <>
      <SectionTitle>Monthly report</SectionTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          aria-label="Month"
          type="month"
          className="h-10 rounded-lg border border-line bg-surface px-2"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
        {data && (
          <Button
            variant="secondary"
            onClick={() => downloadExcel(
              `opus-report-${month}.xlsx`,
              head,
              data.map((row) => [row.name, row.lessons, row.instant, row.hours, row.no_shows, row.excused, row.forgot, row.absent, row.unmarked, row.closed_days, row.closed_same_day]),
            )}
          >
            <Download className="size-4" aria-hidden /> Excel
          </Button>
        )}
      </div>
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <Table head={head}>
          {data.map((row) => (
            <tr key={row.name}>
              <Cell className="font-medium">{row.name}</Cell>
              <Cell className="tabular-nums">{row.lessons}</Cell>
              <Cell className="tabular-nums">{row.instant}</Cell>
              <Cell className="tabular-nums">{row.hours}</Cell>
              <Cell className="tabular-nums">{row.no_shows}</Cell>
              <Cell className="tabular-nums">{row.excused}</Cell>
              <Cell className="tabular-nums">{row.forgot}</Cell>
              <Cell className="tabular-nums">{row.absent}</Cell>
              <Cell className="tabular-nums">{row.unmarked}</Cell>
              <Cell className="tabular-nums">{row.closed_days}</Cell>
              <Cell className="tabular-nums">{row.closed_same_day}</Cell>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

interface PairRow {
  support: string
  student: string
  lessons: number
  instant: number
  missed: number
  excused: number
  forgot: number
  upcoming: number
  last_lesson: string
}

function WhoTaughtWhom() {
  const today = todayInTashkent()
  const [from, setFrom] = useState('2020-01-01')
  const [to, setTo] = useState(addDays(today, 30))
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-pairs', from, to],
    queryFn: () => rpc<PairRow[]>('admin_pairs', { p_from: from, p_to: to }),
  })
  const head = ['Support teacher', 'Student', 'Lessons', 'Of which lesson now', 'Missed', 'Excused', 'Forgot to mark', 'Upcoming', 'Last lesson']
  const control = 'h-10 rounded-lg border border-line bg-surface px-2'

  return (
    <>
      <SectionTitle>Who taught whom</SectionTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        <input aria-label="Report from" type="date" className={control} value={from}
          onChange={(event) => setFrom(event.target.value)} />
        <input aria-label="Report to" type="date" className={control} value={to}
          onChange={(event) => setTo(event.target.value)} />
        {data && (
          <Button
            variant="secondary"
            onClick={() => downloadExcel(
              'opus-who-taught-whom.xlsx',
              head,
              data.map((row) => [row.support, row.student, row.lessons, row.instant, row.missed, row.excused, row.forgot, row.upcoming, row.last_lesson]),
            )}
          >
            <Download className="size-4" aria-hidden /> Excel
          </Button>
        )}
      </div>
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data?.length === 0 && <EmptyState title="No lessons in this period" />}
      {data && data.length > 0 && (
        <Table head={head}>
          {data.map((row) => (
            <tr key={`${row.support}-${row.student}`}>
              <Cell className="font-medium">{row.support}</Cell>
              <Cell>{row.student}</Cell>
              <Cell className="tabular-nums">{row.lessons}</Cell>
              <Cell className="tabular-nums">{row.instant}</Cell>
              <Cell className="tabular-nums">{row.missed}</Cell>
              <Cell className="tabular-nums">{row.excused}</Cell>
              <Cell className="tabular-nums">{row.forgot}</Cell>
              <Cell className="tabular-nums">{row.upcoming}</Cell>
              <Cell className="whitespace-nowrap">{formatDay(row.last_lesson)}</Cell>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

interface Workload {
  week_start: string
  supports: { id: string; name: string; days: { date: string; booked: number; sessions: number }[] }[]
}

function fill(booked: number, sessions: number) {
  if (sessions === 0) return undefined
  const share = Math.min(1, booked / sessions)
  return `color-mix(in oklab, var(--brand-tint) ${Math.round(6 + share * 40)}%, var(--surface))`
}

function WorkloadTable() {
  const [week, setWeek] = useState(() => todayInTashkent())
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-workload', week],
    queryFn: () => rpc<Workload>('admin_workload', { p_week_start: week }),
  })
  const start = data?.week_start ?? week
  return (
    <section aria-label={'Support teachers this week'}>
      <SectionTitle>Support teachers this week</SectionTitle>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(start, -7))}>← Previous week</Button>
        <Button size="sm" variant="secondary" onClick={() => setWeek(todayInTashkent())}>This week</Button>
        <Button size="sm" variant="secondary" onClick={() => setWeek(addDays(start, 7))}>Next week →</Button>
        <span className="text-sm text-muted">{formatDay(start)} – {formatDay(addDays(start, 6))}</span>
      </div>
      {isPending && <div className="skeleton h-32 rounded-xl" aria-hidden />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <>
          <Table head={['Support teacher', ...WEEKDAYS.map((day, index) => `${day} ${addDays(start, index).slice(8)}`)]}>
            {data.supports.map((support) => (
              <tr key={support.id}>
                <Cell className="font-medium">{support.name}</Cell>
                {support.days.map((day) => (
                  <Cell key={day.date} className="tabular-nums">
                    {day.sessions === 0 ? (
                      <span className="text-muted">–</span>
                    ) : (
                      <span
                        className="inline-block min-w-12 rounded-md px-2 py-1 text-center"
                        style={{ background: fill(day.booked, day.sessions) }}
                        title={`${day.booked} of ${day.sessions} sessions booked`}
                      >
                        {day.booked}/{day.sessions}
                      </span>
                    )}
                  </Cell>
                ))}
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-sm text-muted">
            Booked lessons of all sessions that day. Darker means fuller; – means not working.
          </p>
        </>
      )}
    </section>
  )
}

export function Stats() {
  const [days, setDays] = useState(30)
  const today = todayInTashkent()
  const from = addDays(today, -(days - 1))

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-stats', days, today],
    queryFn: () => rpc<Stats>('admin_stats', { p_from: from, p_to: today }),
  })

  const hourLabel = (hour: string | number) => `${String(hour).padStart(2, '0')}:00`

  return (
    <>
      <PageHeader
        title="Statistics"
        action={data && (
          <Button
            variant="secondary"
            onClick={() => downloadExcel(
              'opus-supports.xlsx',
              SUPPORT_HEAD,
              data.by_support.map((row) => [row.name, row.lessons, row.instant, row.no_shows, row.excused, row.forgot, row.absent, row.unmarked, row.rating]),
            )}
          >
            <Download className="size-4" aria-hidden /> Excel
          </Button>
        )}
      />

      <div className="mb-4 flex gap-2">
        {RANGES.map((range) => (
          <Button
            key={range.days}
            size="sm"
            variant={range.days === days ? 'primary' : 'secondary'}
            aria-pressed={range.days === days}
            onClick={() => setDays(range.days)}
          >
            {range.label}
          </Button>
        ))}
      </div>

      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Attendance" value={`${data.totals.attendance_rate}%`} hint="Of marked lessons" />
            <StatTile label="Lessons held" value={data.totals.attended} />
            <StatTile label="Missed by students" value={data.totals.no_show} />
            <StatTile label="Cancelled" value={data.totals.cancelled} />
          </div>

          {data.totals.bookings === 0 ? (
            <div className="mt-4"><EmptyState title="No bookings in this period" /></div>
          ) : (
            <>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-2 font-semibold">Bookings per day</h2>
                  <BookingBars
                    data={data.by_day}
                    x="day"
                    format={(day) => formatDay(String(day))}
                    tick={(day) => String(day).slice(8)}
                  />
                </Card>
                <Card>
                  <h2 className="mb-2 font-semibold">Busiest hours</h2>
                  <BookingBars data={data.by_hour} x="hour" format={hourLabel} tick={hourLabel} />
                </Card>
              </div>

              <SectionTitle>Support teachers</SectionTitle>
              <Table head={SUPPORT_HEAD}>
                {data.by_support.map((row) => (
                  <tr key={row.name}>
                    <Cell className="font-medium">{row.name}</Cell>
                    <Cell className="tabular-nums">{row.lessons}</Cell>
                    <Cell className="tabular-nums">{row.instant}</Cell>
                    <Cell className="tabular-nums">{row.no_shows}</Cell>
                    <Cell className="tabular-nums">{row.excused}</Cell>
                    <Cell className="tabular-nums">{row.forgot}</Cell>
                    <Cell className="tabular-nums">{row.absent}</Cell>
                    <Cell className="tabular-nums">{row.unmarked}</Cell>
                    <Cell className="tabular-nums">{row.rating > 0 ? Number(row.rating).toFixed(1) : '–'}</Cell>
                  </tr>
                ))}
              </Table>

              <SectionTitle>Most active students</SectionTitle>
              <Table head={['Student', 'Lessons', 'Missed']}>
                {data.top_students.map((row) => (
                  <tr key={row.name}>
                    <Cell className="font-medium">{row.name}</Cell>
                    <Cell className="tabular-nums">{row.lessons}</Cell>
                    <Cell className="tabular-nums">{row.no_shows}</Cell>
                  </tr>
                ))}
              </Table>
            </>
          )}
          <MonthReport />
          <WhoTaughtWhom />
        </>
      )}
      <WorkloadTable />
    </>
  )
}
