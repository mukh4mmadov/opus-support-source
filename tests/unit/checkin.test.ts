import { describe, expect, it } from 'vitest'
import { checkinUrl, parseCheckin } from '../../src/lib/checkin'

describe('check-in codes', () => {
  it('reads back what the support shows', () => {
    const url = checkinUrl('https://opus.example', 'abc-123', '004211')
    expect(parseCheckin(url)).toEqual({ booking: 'abc-123', code: '004211' })
  })

  it('ignores other QR codes', () => {
    expect(parseCheckin('https://example.com/menu')).toBeNull()
    expect(parseCheckin('https://example.com/checkin?b=1')).toBeNull()
    expect(parseCheckin('not a link')).toBeNull()
  })
})
