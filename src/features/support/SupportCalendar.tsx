import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge, Button, Card, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui'
import { useText } from '../../app/config'
import { rpc } from '../../lib/api'
import { addDays, formatDay, formatTime, todayInTashkent } from '../../lib/format'
import type { Booking, Closure, ScheduleRow } from '../../lib/types'

interface Calendar {
  bookings: Booking[]
  closures: Closure[]
  schedule: ScheduleRow[]
}

function weekStart(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

export function WeekView({ support }: { support?: string }) {
  const t = useText()
  const [start, setStart] = useState(() => weekStart(todayInTashkent()))
  const end = addDays(start, 6)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['calendar', support, start],
    queryFn: () => rpc<Calendar>('support_calendar', {
      p_from: start, p_to: end, ...(support ? { p_support: support } : {}),
    }),
  })

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <p className="font-medium">{formatDay(start)} – {formatDay(end)}</p>
        <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>

      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <ul className="flex flex-col gap-2">
          {Array.from({ length: 7 }, (_, index) => addDays(start, index)).map((day) => {
            const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
            const hours = data.schedule.filter((row) => row.weekday === weekday)
            const closure = data.closures.find((item) => item.closed_on === day && !item.start_time)
            const closedHours = data.closures.filter((item) => item.closed_on === day && item.start_time)
            const lessons = data.bookings.filter((booking) => booking.lesson_date === day)
            return (
              <li key={day}>
                <Card>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{formatDay(day)}</p>
                    {closure
                      ? <Badge tone="warn">{t('book.closed')}</Badge>
                      : <span className="text-sm text-muted">
                          {hours.map((row) => `${row.start_time}-${row.end_time}`).join(', ')}
                        </span>}
                  </div>
                  {closedHours.map((item) => (
                    <p key={item.id} className="text-sm text-warn">
                      {t('book.closed')} {item.start_time}-{item.end_time}
                    </p>
                  ))}
                  {lessons.length > 0 && (
                    <ul className="mt-2 divide-y divide-line">
                      {lessons.map((booking) => (
                        <li key={booking.id} className="flex items-start justify-between gap-2 py-2">
                          <div className="min-w-0">
                            <p>
                              <span className="font-medium">{formatTime(booking.starts_at)}</span>
                              {' '}{booking.student_name}
                            </p>
                            {booking.topic && <p className="text-sm text-muted">{booking.topic}</p>}
                          </div>
                          <StatusBadge status={booking.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function SupportCalendar() {
  const t = useText()
  return (
    <>
      <PageHeader title={t('nav.calendar')} />
      <WeekView />
    </>
  )
}
