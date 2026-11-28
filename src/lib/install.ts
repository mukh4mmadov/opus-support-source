interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let offer: InstallPrompt | null = null
const listeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  offer = event as InstallPrompt
  listeners.forEach((notify) => notify())
})

window.addEventListener('appinstalled', () => {
  offer = null
  listeners.forEach((notify) => notify())
})

export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true

export const canPromptInstall = () => offer !== null

export function onInstallChange(notify: () => void) {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export async function promptInstall() {
  if (!offer) return
  await offer.prompt()
  await offer.userChoice
  offer = null
  listeners.forEach((notify) => notify())
}
