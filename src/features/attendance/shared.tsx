import { Badge } from '../../components/ui'
import { useText } from '../../app/config'
import { formatTime } from '../../lib/format'
import type { StaffDay, StaffDayStatus } from '../../lib/types'

const TONE: Record<StaffDayStatus, 'neutral' | 'brand' | 'ok' | 'warn' | 'bad'> = {
  off: 'neutral',
  waiting: 'neutral',
  missing: 'warn',
  here: 'ok',
  done: 'brand',
  absent: 'bad',
  excused: 'neutral',
}

export function DayStatusBadge({ status }: { status: StaffDayStatus }) {
  const t = useText()
  return <Badge tone={TONE[status]}>{t(`attend.status.${status}`)}</Badge>
}

export const workTime = (day: StaffDay) =>
  day.expected_start && day.expected_end
    ? `${formatTime(day.expected_start)}-${formatTime(day.expected_end)}`
    : null

export function DayFacts({ day }: { day: StaffDay }) {
  const t = useText()
  const lines: { text: string; tone?: 'warn' | 'bad' }[] = []
  if (day.arrived_at) {
    lines.push({ text: t('attend.arrived', { time: formatTime(day.arrived_at) }) })
    if (day.is_late) lines.push({ text: t('attend.late', { minutes: day.late_minutes }), tone: 'warn' })
    if (day.arrive_manual_by) lines.push({ text: t('attend.manual', { name: day.arrive_manual_by }) })
  }
  if (day.left_at) {
    lines.push({ text: t('attend.left', { time: formatTime(day.left_at) }) })
    if (day.leave_manual_by) lines.push({ text: t('attend.manual', { name: day.leave_manual_by }) })
  } else if (day.no_leave && day.left_estimated) {
    lines.push({ text: t('attend.left_estimated', { time: formatTime(day.left_estimated) }), tone: 'warn' })
  }
  if (day.is_early) lines.push({ text: t('attend.early', { minutes: day.early_minutes }), tone: 'warn' })
  if (day.excused && day.excuse_note) lines.push({ text: day.excuse_note })
  if (lines.length === 0) return null
  return (
    <ul className="text-sm">
      {lines.map((line, index) => (
        <li key={index} className={line.tone === 'warn' ? 'text-warn' : line.tone === 'bad' ? 'text-bad' : 'text-muted'}>
          {line.text}
        </li>
      ))}
    </ul>
  )
}

export const attendUrl = (origin: string, code: string) => `${origin}/attend?c=${encodeURIComponent(code)}`

export function parseAttend(text: string) {
  try {
    const url = new URL(text)
    return url.pathname === '/attend' ? url.searchParams.get('c') : null
  } catch {
    return null
  }
}
