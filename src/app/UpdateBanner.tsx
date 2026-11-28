import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { registerSW } from 'virtual:pwa-register'
import { Button } from '../components/ui'
import { useText } from './config'

let ready = false
let onReady: (() => void) | null = null
let update: ((reload?: boolean) => Promise<void>) | null = null

if ('serviceWorker' in navigator) {
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true
      onReady?.()
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => undefined)
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.setInterval(check, 30 * 60_000)
    },
  })
}

export function UpdateBanner() {
  const t = useText()
  const [shown, setShown] = useState(ready)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    onReady = () => setShown(true)
    return () => {
      onReady = null
    }
  }, [])
  if (!shown) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 shadow-lg md:bottom-4 print:hidden"
    >
      <p className="text-sm font-medium">{t('update.ready')}</p>
      <Button
        size="sm"
        loading={busy}
        onClick={() => {
          setBusy(true)
          update?.(true).catch(() => location.reload())
          window.setTimeout(() => location.reload(), 4000)
        }}
      >
        <RefreshCw className="size-4" aria-hidden />
        {t('update.button')}
      </Button>
    </div>
  )
}
