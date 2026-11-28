export interface CalendarLesson {
  id: string
  startsAt: string
  endsAt: string
  title: string
  details: string
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, '')

const escapeText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

export function lessonIcs(lesson: CalendarLesson, now = new Date()) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OPUS Learning Center//Support Booking//EN',
    'BEGIN:VEVENT',
    `UID:${lesson.id}@opus-support`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(lesson.startsAt)}`,
    `DTEND:${stamp(lesson.endsAt)}`,
    `SUMMARY:${escapeText(lesson.title)}`,
    `DESCRIPTION:${escapeText(lesson.details)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(lesson.title)}`,
    'TRIGGER:-PT60M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

export function googleCalendarUrl(lesson: CalendarLesson) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: lesson.title,
    dates: `${stamp(lesson.startsAt)}/${stamp(lesson.endsAt)}`,
    details: lesson.details,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

export function downloadIcs(lesson: CalendarLesson) {
  const url = URL.createObjectURL(new Blob([lessonIcs(lesson)], { type: 'text/calendar' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'opus-lesson.ics'
  link.click()
  URL.revokeObjectURL(url)
}
