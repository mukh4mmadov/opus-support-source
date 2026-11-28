import { describe, expect, it } from 'vitest'
import { googleCalendarUrl, lessonIcs } from '../../src/lib/calendar'

const lesson = {
  id: 'abc',
  startsAt: '2030-01-08T09:00:00.000Z',
  endsAt: '2030-01-08T09:30:00.000Z',
  title: 'OPUS lesson with Ozodbek',
  details: 'Past Simple, Present; Perfect\nline two',
}

describe('calendar files', () => {
  it('uses exact UTC times, so the phone shows the right local hour', () => {
    const file = lessonIcs(lesson, new Date('2030-01-01T00:00:00Z'))
    expect(file).toContain('DTSTART:20300108T090000Z')
    expect(file).toContain('DTEND:20300108T093000Z')
    expect(file).toContain('UID:abc@opus-support')
  })

  it('escapes text and uses the line endings calendars require', () => {
    const file = lessonIcs(lesson)
    expect(file).toContain('DESCRIPTION:Past Simple\\, Present\\; Perfect\\nline two')
    expect(file.split('\r\n')[0]).toBe('BEGIN:VCALENDAR')
  })

  it('reminds an hour before', () => {
    expect(lessonIcs(lesson)).toContain('TRIGGER:-PT60M')
  })

  it('builds a Google Calendar link', () => {
    const url = new URL(googleCalendarUrl(lesson))
    expect(url.searchParams.get('dates')).toBe('20300108T090000Z/20300108T093000Z')
    expect(url.searchParams.get('text')).toBe('OPUS lesson with Ozodbek')
  })
})
