export type PushStep = 'on' | 'ask' | 'install' | 'blocked' | 'unsupported'

export function pushStep(device: {
  supported: boolean
  ios: boolean
  installed: boolean
  permission: NotificationPermission | 'none'
  subscribed: boolean
}): PushStep {
  if (device.ios && !device.installed) return 'install'
  if (!device.supported) return 'unsupported'
  if (device.permission === 'denied') return 'blocked'
  return device.subscribed && device.permission === 'granted' ? 'on' : 'ask'
}
