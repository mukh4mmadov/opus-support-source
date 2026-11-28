import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { Button, Modal, Notice } from '../../components/ui'
import { useMe } from '../../app/auth'
import { useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { isInstalled } from '../../lib/install'
import { currentSubscription, enablePush, isIos, pushSupported } from '../../lib/push'
import { pushStep, type PushStep } from '../../lib/pushStep'

const ASKED = 'opus-push-asked'

function usePushStep() {
  const [step, setStep] = useState<PushStep | null>(null)

  async function check() {
    const subscription = await currentSubscription().catch(() => null)
    setStep(pushStep({
      supported: pushSupported(),
      ios: isIos(),
      installed: isInstalled(),
      permission: 'Notification' in window ? Notification.permission : 'none',
      subscribed: Boolean(subscription),
    }))
  }

  useEffect(() => {
    void check()
  }, [])

  return { step, check }
}

function PushReasons({ step, onChange }: { step: PushStep; onChange: () => void }) {
  const me = useMe()
  const t = useText()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const { role } = me

  async function turnOn() {
    setBusy(true)
    const ok = await enablePush().catch(() => false)
    setBusy(false)
    toast(t(ok ? 'push.on' : 'push.failed'), !ok)
    onChange()
  }

  return (
    <>
      <p className="font-medium">{t(`push.why_${role}`)}</p>
      <ul className="my-3 flex list-disc flex-col gap-1 pl-5">
        <li>{t(`push.${role}_1`)}</li>
        <li>{t(`push.${role}_2`)}</li>
        <li>{t(`push.${role}_3`)}</li>
      </ul>
      {step === 'ask' && (
        <Button block loading={busy} onClick={turnOn}>
          <BellRing className="size-4" aria-hidden />
          {t('push.turn_on')}
        </Button>
      )}
      {step === 'install' && <p className="font-medium">{t('push.install_steps')}</p>}
      {step === 'blocked' && <p className="font-medium">{t('push.blocked_steps')}</p>}
    </>
  )
}

const needsAction = (step: PushStep | null) => step === 'ask' || step === 'install' || step === 'blocked'

export function PushCard() {
  const t = useText()
  const { step, check } = usePushStep()
  if (!needsAction(step)) return null
  return (
    <Notice tone="bad" title={t('push.title')}>
      <PushReasons step={step!} onChange={check} />
    </Notice>
  )
}

function askedThisSession() {
  try {
    return sessionStorage.getItem(ASKED) === '1'
  } catch {
    return true
  }
}

function rememberAsked() {
  try {
    sessionStorage.setItem(ASKED, '1')
  } catch {
  }
}

export function PushReminder() {
  const t = useText()
  const { step, check } = usePushStep()
  const [open, setOpen] = useState(() => !askedThisSession())

  function close() {
    rememberAsked()
    setOpen(false)
  }

  if (!open || !needsAction(step)) return null
  return (
    <Modal title={t('push.title')} onClose={close}>
      <PushReasons step={step!} onChange={check} />
      <Button variant="ghost" block className="mt-2" onClick={close}>{t('push.later')}</Button>
    </Modal>
  )
}
