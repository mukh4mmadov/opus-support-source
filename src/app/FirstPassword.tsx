import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, PageHeader } from '../components/ui'
import { PasswordForm } from '../features/profile/Profile'
import { useAuth, useMe } from './auth'
import { useText } from './config'
import { belongsToAnotherRole } from './routeAccess'

export function FirstPassword() {
  const me = useMe()
  const t = useText()
  const { signOut } = useAuth()
  const queryClient = useQueryClient()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (belongsToAnotherRole(me.role, pathname)) navigate('/', { replace: true })
  }, [me.role, pathname, navigate])

  return (
    <main className="animate-rise mx-auto max-w-md px-4 py-10">
      <PageHeader title={t('first.title')} subtitle={t('first.body')} />
      <Card>
        <PasswordForm onDone={() => queryClient.invalidateQueries({ queryKey: ['me'] })} />
      </Card>
      <Button variant="ghost" className="mt-4" onClick={signOut}>{t('profile.logout')}</Button>
    </main>
  )
}
