import { useState, type FormEvent } from 'react'
import { Button, Card, Field, PasswordInput } from '../../components/ui'
import { useAuth } from '../../app/auth'
import { useConfig, useText } from '../../app/config'
import { Brand } from '../../app/Shell'

export function Login() {
  const { signIn } = useAuth()
  const { settings } = useConfig()
  const t = useText()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [failed, setFailed] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFailed(undefined)
    const result = await signIn(login, password)
    setBusy(false)
    if (result === 'wrong') setFailed(t('login.failed'))
    if (result === 'busy') setFailed(t('login.too_many'))
    if (result === 'network') setFailed(t('error.NETWORK'))
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-brand p-4">
      <div className="glow-blob left-[-20%] top-[-10%] size-80 bg-[color:var(--accent)]" aria-hidden />
      <div className="glow-blob bottom-[-15%] right-[-20%] size-96 bg-white/40 [animation-delay:-7s]" aria-hidden />
      <div className="relative w-full max-w-sm">
        <div className="animate-pop-in mb-4 text-center">
          <Brand large />
          <p className="mt-1 font-medium text-brand-fg">{settings.center_name}</p>
        </div>
        <Card className="animate-rise p-5 shadow-2xl [animation-delay:120ms]">
          <h1 className="text-lg font-semibold">{t('login.title')}</h1>
          <p className="mb-4 text-muted">{t('login.subtitle')}</p>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label={t('login.login')}>
              {(id, className) => (
                <input
                  id={id}
                  className={`${className} h-11`}
                  value={login}
                  onChange={(event) => setLogin(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
              )}
            </Field>
            <Field label={t('login.password')} error={failed}>
              {(id, className) => (
                <PasswordInput
                  id={id}
                  className={`${className} h-11`}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>
            <Button type="submit" block loading={busy}>{t('login.submit')}</Button>
          </form>
        </Card>
        <section
          aria-label={t('login.help_title')}
          className="animate-rise mt-4 rounded-2xl bg-white/10 p-4 text-sm text-brand-fg backdrop-blur-sm [animation-delay:200ms]"
        >
          <h2 className="mb-2 font-semibold">{t('login.help_title')}</h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>{t('login.help_1', { center: settings.center_name })}</li>
            <li>{t('login.help_2')}</li>
            <li>{t('login.help_3')}</li>
            <li>{t('login.help_4')}</li>
          </ol>
        </section>
        {settings.center_phone && (
          <p className="mt-4 text-center text-sm text-brand-fg">{settings.center_phone}</p>
        )}
      </div>
    </main>
  )
}
