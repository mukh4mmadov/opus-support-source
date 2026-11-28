import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import qrcode from 'qrcode-generator'
import { ErrorState, Modal, Spinner } from '../../components/ui'
import { useErrorText, useText } from '../../app/config'
import { rpc } from '../../lib/api'
import { checkinUrl } from '../../lib/checkin'
import type { Booking, SupportHome } from '../../lib/types'

const NEW_CODE_EVERY_MS = 25_000
const WATCH_EVERY_MS = 3_000

export function QrImage({ text, alt }: { text: string; alt: string }) {
  const source = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(text)
    code.make()
    return code.createDataURL(8, 16)
  }, [text])
  return <img src={source} alt={alt} className="mx-auto w-full max-w-72 rounded-lg bg-white [image-rendering:pixelated]" />
}

export function SupportQr({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const t = useText()
  const errorText = useErrorText()
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['checkin-code', booking.id],
    queryFn: () => rpc<{ code: string }>('checkin_code', { p_booking: booking.id }),
    refetchInterval: NEW_CODE_EVERY_MS,
    gcTime: 0,
    retry: false,
  })
  useQuery({
    queryKey: ['support-home'],
    queryFn: () => rpc<SupportHome>('support_home'),
    refetchInterval: WATCH_EVERY_MS,
  })

  return (
    <Modal title={t('checkin.show_title', { name: booking.student_name })} onClose={onClose}>
      <p className="mb-3 text-muted">{t('checkin.show_hint')}</p>
      {isPending && <Spinner />}
      {error && (
        <>
          <p className="mb-2">{errorText(error)}</p>
          <ErrorState onRetry={refetch} />
        </>
      )}
      {data && (
        <>
          <QrImage text={checkinUrl(location.origin, booking.id, data.code)} alt={t('checkin.show_title', { name: booking.student_name })} />
          <p className="mt-3 text-center text-sm text-muted">{t('checkin.show_code')}</p>
          <p className="text-center text-3xl font-semibold tracking-widest tabular-nums" data-testid="checkin-code">
            {data.code}
          </p>
        </>
      )}
    </Modal>
  )
}
