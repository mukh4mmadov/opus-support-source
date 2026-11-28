import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button, Modal } from '../../components/ui'
import { useText } from '../../app/config'
import { canPromptInstall, isInstalled, onInstallChange, promptInstall } from '../../lib/install'
import { isIos } from '../../lib/push'

const DISMISSED = 'opus-install-dismissed'

export function InstallCard() {
  const t = useText()
  const [, refresh] = useState(0)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED) === '1')
  const [guide, setGuide] = useState(false)

  useEffect(() => onInstallChange(() => refresh((n) => n + 1)), [])

  const available = canPromptInstall() || isIos()
  if (dismissed || isInstalled() || !available) return null

  return (
    <div className="flex items-center gap-3 rounded-xl bg-brand-soft p-3">
      <img src="/icon-192.png" alt="" className="size-10 rounded-lg" />
      <p className="min-w-0 flex-1 font-medium">{t('install.title')}</p>
      <Button size="sm" onClick={() => (canPromptInstall() ? promptInstall() : setGuide(true))}>
        <Download className="size-4" aria-hidden />
        {t('install.button')}
      </Button>
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="rounded-md p-1 text-muted hover:bg-sunken"
        onClick={() => {
          localStorage.setItem(DISMISSED, '1')
          setDismissed(true)
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
      {guide && (
        <Modal title={t('install.title')} onClose={() => setGuide(false)}>
          <p>{t('install.ios')}</p>
        </Modal>
      )}
    </div>
  )
}
