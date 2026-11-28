const TZ = 'Asia/Tashkent'

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...options })

const timeFmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: false })
const dateFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' })
const dateTimeFmt = fmt({
  weekday: 'short', day: 'numeric', month: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
})
const shortDayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
})

export const formatTime = (iso: string) => timeFmt.format(new Date(iso))
export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))

export const formatDeadline = (iso: string) =>
  dateTimeFmt.format(new Date(new Date(iso).getTime() - 60_000))

export const formatDay = (day: string) => shortDayFmt.format(new Date(`${day}T00:00:00Z`))

const dayMonthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' })
export const formatShortDay = (day: string) => dayMonthFmt.format(new Date(`${day}T00:00:00Z`))
export const formatMonth = (day: string) => monthFmt.format(new Date(`${day}T00:00:00Z`))

export const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const todayInTashkent = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface ScheduleRow {
  weekday: number
  start_time: string
  end_time: string
}

export function scheduleLines(rows: ScheduleRow[]) {
  const byHours = new Map<string, number[]>()
  for (const row of rows) {
    const hours = `${row.start_time}-${row.end_time}`
    byHours.set(hours, [...(byHours.get(hours) ?? []), row.weekday])
  }
  return [...byHours].map(([hours, days]) => {
    const sorted = [...new Set(days)].sort((a, b) => a - b)
    const runs: number[][] = []
    for (const day of sorted) {
      const run = runs.at(-1)
      if (run && run.at(-1) === day - 1) run.push(day)
      else runs.push([day])
    }
    const label = runs
      .map((run) => run.length > 1
        ? `${WEEKDAYS[run[0] - 1]}-${WEEKDAYS[run.at(-1)! - 1]}`
        : WEEKDAYS[run[0] - 1])
      .join(', ')
    return `${label} ${hours}`
  })
}

export function lessonLength(start: string, end: string) {
  return {
    start: formatTime(start),
    end: formatTime(end),
    minutes: Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  }
}
