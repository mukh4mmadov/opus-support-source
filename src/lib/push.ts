import { rpc } from './api'

const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const pushSupported = () =>
  Boolean(publicKey) && 'serviceWorker' in navigator && 'PushManager' in window

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

const toBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

export async function currentSubscription() {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  return registration?.pushManager.getSubscription() ?? null
}

export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toBytes(publicKey!),
  })
  const { endpoint, keys } = subscription.toJSON()
  await rpc('push_subscribe', { p_endpoint: endpoint, p_p256dh: keys!.p256dh, p_auth: keys!.auth })
  return true
}

export async function disablePush() {
  const subscription = await currentSubscription().catch(() => null)
  if (!subscription) return
  await rpc('push_unsubscribe', { p_endpoint: subscription.endpoint }).catch(() => undefined)
  await subscription.unsubscribe()
}
