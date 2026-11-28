import { lazy, Suspense, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QrCode } from 'lucide-react'
import { Button, buttonClass, Field, Modal, Notice, PageHeader, Spinner } from '../../components/ui'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { parseCheckin } from '../../lib/checkin'
import { celebrate } from '../../lib/celebrate'
import { formatTime } from '../../lib/format'
import type { Booking } from '../../lib/types'

const QrScanner = lazy(() => import('./QrScanner'))

export function CheckIn({ booking }: { booking: Booking }) {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)

  const send = useMutation({
    mutationFn: (value: string) => rpc<string>('check_in', { p_booking: booking.id, p_code: value }),
    onSuccess: (result) => {
      if (result !== 'ok') {
        toast(t('checkin.wrong'), true)
        return
      }
      toast(t('checkin.done'))
      celebrate()
      queryClient.invalidateQueries()
    },
    onError: (error) => toast(errorText(error), true),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    send.mutate(code)
  }

  function read(text: string) {
    setScanning(false)
    const found = parseCheckin(text)
    if (found?.booking === booking.id) send.mutate(found.code)
    else toast(t('checkin.wrong'), true)
  }

  return (
    <Notice tone="brand" title={t('checkin.title')}>
      <p className="mb-3">{t('checkin.hint', { time: formatTime(booking.mark_until) })}</p>
      <Button block onClick={() => setScanning(true)}>
        <QrCode className="size-4" aria-hidden />
        {t('checkin.scan')}
      </Button>
      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={t('checkin.code')}>
            {(id, className) => (
              <input
                id={id}
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                className={`${className} h-11 tracking-widest`}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={code.trim().length !== 6} loading={send.isPending}>
          {t('checkin.submit')}
        </Button>
      </form>
      {scanning && (
        <Modal title={t('checkin.scan')} onClose={() => setScanning(false)}>
          <Suspense fallback={<Spinner />}>
            <QrScanner
              onRead={read}
              onFail={() => {
                setScanning(false)
                toast(t('checkin.no_camera'), true)
              }}
            />
          </Suspense>
        </Modal>
      )}
    </Notice>
  )
}

export function CheckInPage() {
  const t = useText()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const booking = params.get('b')
  const code = params.get('c')
  const { data, error, isPending } = useQuery({
    queryKey: ['check-in', booking, code],
    queryFn: async () => {
      const result = await rpc<string>('check_in', { p_booking: booking, p_code: code })
      if (result === 'ok') celebrate()
      await queryClient.invalidateQueries({ queryKey: ['student-home'] })
      return result
    },
    enabled: Boolean(booking && code),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  return (
    <>
      <PageHeader title={t('checkin.title')} />
      {isPending && booking && code && <Spinner />}
      {data === 'ok' && <Notice tone="brand">{t('checkin.done')}</Notice>}
      {data === 'wrong' && <Notice tone="bad">{t('checkin.wrong')}</Notice>}
      {error && <Notice tone="bad">{errorText(error)}</Notice>}
      {(!booking || !code) && <Notice tone="bad">{t('checkin.wrong')}</Notice>}
      <Link to="/" className={`${buttonClass('secondary', 'md', true)} mt-3`}>{t('nav.home')}</Link>
    </>
  )
}
