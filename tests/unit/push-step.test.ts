import { describe, expect, it } from 'vitest'
import { pushStep } from '../../src/lib/pushStep'

const phone = { supported: true, ios: false, installed: false, permission: 'default', subscribed: false } as const

describe('pushStep', () => {
  it('asks on a device that can receive notifications', () => {
    expect(pushStep(phone)).toBe('ask')
  })

  it('asks again when permission remains but the subscription was lost', () => {
    expect(pushStep({ ...phone, permission: 'granted' })).toBe('ask')
  })

  it('is done once permission and subscription are both there', () => {
    expect(pushStep({ ...phone, permission: 'granted', subscribed: true })).toBe('on')
  })

  it('gives steps when the browser has blocked the site', () => {
    expect(pushStep({ ...phone, permission: 'denied' })).toBe('blocked')
  })

  it('sends an iPhone to the Home Screen first, even though Safari hides push there', () => {
    expect(pushStep({ ...phone, ios: true, supported: false, permission: 'none' })).toBe('install')
  })

  it('asks on an iPhone once the site is installed', () => {
    expect(pushStep({ ...phone, ios: true, installed: true })).toBe('ask')
  })

  it('stays quiet on a device with no push at all', () => {
    expect(pushStep({ ...phone, supported: false, permission: 'none' })).toBe('unsupported')
  })
})
