import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import qrcode from 'qrcode-generator'
import { CircleCheck, LogOut, Maximize } from 'lucide-react'
import { Button, ErrorState, Notice, PageHeader, Spinner } from '../../components/ui'
import { useErrorText } from '../../app/config'
import { rpc } from '../../lib/api'
import { formatTime } from '../../lib/format'
import { attendUrl } from './shared'

interface Screen {
  code: string
  seconds_left: number
  events: { id: string; name: string; kind: 'arrive' | 'leave'; at: string }[]
}

const POLL_MS = 1_500

function BigQr({ text }: { text: string }) {
  const source = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(text)
    code.make()
    return code.createDataURL(10, 16)
  }, [text])
  return (
    <img src={source} alt="Attendance QR"
      className="mx-auto aspect-square w-full max-w-[min(70vh,28rem)] rounded-xl bg-white [image-rendering:pixelated]" />
  )
}

export function AttendanceQr() {
  const errorText = useErrorText()
  const box = useRef<HTMLDivElement>(null)
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['staff-qr-screen'],
    queryFn: () => rpc<Screen>('staff_qr_screen'),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    gcTime: 0,
    retry: false,
  })

  useEffect(() => {
    let lock: WakeLockSentinel | undefined
    let stopped = false
    const ask = () => {
      navigator.wakeLock?.request('screen')
        .then((sentinel) => {
          if (stopped) sentinel.release()
          else lock = sentinel
        })
        .catch(() => {})
    }
    ask()
    const again = () => {
      if (document.visibilityState === 'visible') ask()
    }
    document.addEventListener('visibilitychange', again)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', again)
      lock?.release()
    }
  }, [])

  const off = error instanceof Error && error.message.includes('ATTENDANCE_OFF')

  return (
    <>
      <PageHeader
        title="Attendance QR"
        subtitle="Keep this page open on the reception computer. Support teachers scan it with the OPUS app when they arrive and when they leave."
        action={(
          <Button size="sm" variant="secondary" onClick={() => box.current?.requestFullscreen?.()}>
            <Maximize className="size-4" aria-hidden />
            Full screen
          </Button>
        )}
      />
      {isPending && <Spinner />}
      {off && <Notice tone="warn">Attendance is turned off. The developer turns it on in Settings.</Notice>}
      {error && !off && (
        <>
          <p className="mb-2">{errorText(error)}</p>
          <ErrorState onRetry={refetch} />
        </>
      )}
      {data && (
        <div ref={box} className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-surface p-4">
          <div className="w-full" data-testid="attend-qr" data-code={data.code}>
            <BigQr text={attendUrl(location.origin, data.code)} />
          </div>
          <p className="text-center text-muted">
            OPUS app → Attendance → Scan the QR. The code changes every 10 seconds.
          </p>
          <ul className="flex w-full max-w-xl flex-col gap-2" aria-live="polite">
            {data.events.map((event) => (
              <li key={event.id}
                className="flex items-center gap-3 rounded-xl bg-ok-soft p-4 text-xl font-semibold text-ok">
                {event.kind === 'arrive'
                  ? <CircleCheck className="size-7 shrink-0" aria-hidden />
                  : <LogOut className="size-7 shrink-0" aria-hidden />}
                <span>
                  {event.name} — {event.kind === 'arrive' ? 'arrived' : 'left'} {formatTime(event.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
