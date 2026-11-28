export const checkinUrl = (origin: string, booking: string, code: string) =>
  `${origin}/checkin?b=${encodeURIComponent(booking)}&c=${encodeURIComponent(code)}`

export function parseCheckin(text: string) {
  try {
    const { pathname, searchParams } = new URL(text)
    const booking = searchParams.get('b')
    const code = searchParams.get('c')
    return pathname === '/checkin' && booking && code ? { booking, code } : null
  } catch {
    return null
  }
}
