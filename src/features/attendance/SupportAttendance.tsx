import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, QrCode, ScanFace } from 'lucide-react'
import {
  Button, buttonClass, Card, ConfirmDialog, EmptyState, ErrorState, Modal, Notice, PageHeader, SectionTitle, Spinner,
} from '../../components/ui'
import { useErrorText, useText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { celebrate } from '../../lib/celebrate'
import { formatDay, formatTime } from '../../lib/format'
import type { StringKey } from '../../lib/strings'
import type { MyStaffAttendance, StaffDay } from '../../lib/types'
import { FaceCheck, type FaceProof } from './FaceCheck'
import { DayFacts, DayStatusBadge, parseAttend, workTime } from './shared'

const QrScanner = lazy(() => import('../checkin/QrScanner'))

type Kind = 'arrive' | 'leave'

type Phase =
  | { name: 'idle' }
  | { name: 'scanning' }
  | { name: 'busy'; label: StringKey }
  | { name: 'confirm_leave'; scan: string; endsAt: string }
  | { name: 'face'; scan: string; kind: Kind }
  | { name: 'retry'; scan: string; kind: Kind; message: string }
  | { name: 'refused'; message: string }
  | { name: 'done'; kind: Kind; at: string }

interface ScanStart {
  scan: string
  kind: Kind
  expected_end: string | null
  early: boolean
}

interface FaceAnswer {
  ok: boolean
  kind?: Kind
  tries_left?: number
  day?: StaffDay
}

const useMyAttendance = () => useQuery({
  queryKey: ['my-staff-attendance'],
  queryFn: () => rpc<MyStaffAttendance>('my_staff_attendance'),
  refetchInterval: 60_000,
})

function locate() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 20_000, maximumAge: 0,
    })
  })
}

function TodayCard({ day, action }: { day: StaffDay; action?: ReactNode }) {
  const t = useText()
  const hours = workTime(day)
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{t('attend.card_title')}</h2>
          <p className="text-sm text-muted">
            {hours ? t('attend.work_time', { from: hours.split('-')[0], to: hours.split('-')[1] }) : t('attend.no_work')}
          </p>
        </div>
        <DayStatusBadge status={day.status} />
      </div>
      <div className="mt-2"><DayFacts day={day} /></div>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

export function AttendanceCard() {
  const t = useText()
  const { data } = useMyAttendance()
  if (!data?.enabled) return null
  return (
    <TodayCard
      day={data.today}
      action={!data.today.left_at && (
        <Link to="/attendance?scan=1" className={buttonClass('primary', 'sm')}>
          <QrCode className="size-4" aria-hidden />
          {t('attend.scan')}
        </Link>
      )}
    />
  )
}

export function SupportAttendance() {
  const t = useText()
  const errorText = useErrorText()
  const toast = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const { data, isPending, isError, refetch } = useMyAttendance()
  const started = useRef(false)

  async function start(code: string) {
    try {
      setPhase({ name: 'busy', label: 'attend.locating' })
      let position: GeolocationPosition
      try {
        position = await locate()
      } catch {
        toast(t('attend.gps_needed'), true)
        setPhase({ name: 'idle' })
        return
      }
      setPhase({ name: 'busy', label: 'attend.checking' })
      const scan = await rpc<ScanStart>('staff_scan', {
        p_code: code,
        p_lat: position.coords.latitude,
        p_lng: position.coords.longitude,
        p_accuracy: position.coords.accuracy,
      })
      if (scan.early && scan.expected_end) {
        setPhase({ name: 'confirm_leave', scan: scan.scan, endsAt: scan.expected_end })
      } else {
        setPhase({ name: 'face', scan: scan.scan, kind: scan.kind })
      }
    } catch (error) {
      toast(errorText(error), true)
      setPhase({ name: 'idle' })
    }
  }

  async function sendFace(scan: string, kind: Kind, proof: FaceProof) {
    setPhase({ name: 'busy', label: 'attend.checking' })
    try {
      const answer = await rpc<FaceAnswer>('staff_face', {
        p_scan: scan,
        p_faces: proof.faces,
        p_photo: proof.photo,
        p_real: proof.real,
        p_live: proof.live,
      })
      await queryClient.invalidateQueries()
      if (answer.ok && answer.day) {
        const at = (kind === 'arrive' ? answer.day.arrived_at : answer.day.left_at) ?? new Date().toISOString()
        setPhase({ name: 'done', kind, at })
        celebrate()
      } else if ((answer.tries_left ?? 0) > 0) {
        setPhase({ name: 'retry', scan, kind, message: t('attend.face_no_match', { count: answer.tries_left ?? 0 }) })
      } else {
        setPhase({ name: 'refused', message: t('attend.face_refused') })
      }
    } catch (error) {
      toast(errorText(error), true)
      setPhase({ name: 'idle' })
    }
  }

  function faceFailed(scan: string, kind: Kind, reason: 'camera' | 'timeout' | 'engine') {
    if (reason === 'camera') {
      toast(t('attend.no_camera'), true)
      setPhase({ name: 'retry', scan, kind, message: t('attend.no_camera') })
    } else if (reason === 'timeout') {
      setPhase({ name: 'retry', scan, kind, message: t('attend.face_timeout') })
    } else {
      setPhase({ name: 'refused', message: t('attend.face_engine') })
    }
  }

  function read(text: string) {
    const code = parseAttend(text)
    if (!code) {
      toast(t('attend.wrong_qr'), true)
      setPhase({ name: 'idle' })
      return
    }
    start(code)
  }

  useEffect(() => {
    if (started.current || !data) return
    const code = params.get('c')
    if (code) {
      started.current = true
      navigate({ search: '' }, { replace: true })
      start(code)
    } else if (params.get('scan') && !data.today.left_at) {
      started.current = true
      navigate({ search: '' }, { replace: true })
      setPhase({ name: 'scanning' })
    }
  }, [data])

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  return (
    <>
      <PageHeader title={t('attend.title')} />
      {!data.enabled && <Notice tone="warn">{t('attend.off')}</Notice>}
      {data.enabled && (
        <div className="flex flex-col gap-3">
          {!data.face_set && <Notice tone="warn">{t('attend.no_face')}</Notice>}
          {phase.name === 'done' && (
            <Notice tone="brand">
              <span className="flex items-center gap-2 font-semibold">
                <CircleCheck className="size-5 text-ok" aria-hidden />
                {t(phase.kind === 'arrive' ? 'attend.done_arrive' : 'attend.done_leave', { time: formatTime(phase.at) })}
              </span>
            </Notice>
          )}
          {phase.name === 'refused' && <Notice tone="bad">{phase.message}</Notice>}
          <TodayCard
            day={data.today}
            action={!data.today.left_at && (
              <>
                <p className="mb-3 text-sm text-muted">{t('attend.scan_hint')}</p>
                <Button block onClick={() => setPhase({ name: 'scanning' })}>
                  <QrCode className="size-4" aria-hidden />
                  {t('attend.scan')}
                </Button>
              </>
            )}
          />
        </div>
      )}

      <SectionTitle>{t('attend.history')}</SectionTitle>
      {data.days.length === 0 && <EmptyState title={t('attend.no_history')} />}
      <ul className="flex flex-col gap-2">
        {data.days.map((day) => (
          <li key={day.work_date}>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{formatDay(day.work_date)}</p>
                  {workTime(day) && <p className="text-sm text-muted">{workTime(day)}</p>}
                </div>
                <DayStatusBadge status={day.status} />
              </div>
              <div className="mt-1"><DayFacts day={day} /></div>
            </Card>
          </li>
        ))}
      </ul>

      {phase.name === 'scanning' && (
        <Modal title={t('attend.scan')} onClose={() => setPhase({ name: 'idle' })}>
          <Suspense fallback={<Spinner />}>
            <QrScanner
              onRead={read}
              onFail={() => {
                toast(t('attend.no_camera'), true)
                setPhase({ name: 'idle' })
              }}
            />
          </Suspense>
        </Modal>
      )}
      {phase.name === 'busy' && (
        <Modal title={t('attend.title')} onClose={() => {}}>
          <Spinner />
          <p className="text-center text-muted" role="status">{t(phase.label)}</p>
        </Modal>
      )}
      {phase.name === 'confirm_leave' && (
        <ConfirmDialog
          title={t('attend.leave_confirm_title')}
          body={t('attend.leave_confirm', { time: formatTime(phase.endsAt) })}
          confirmLabel={t('attend.leave_button')}
          onConfirm={() => setPhase({ name: 'face', scan: phase.scan, kind: 'leave' })}
          onClose={() => setPhase({ name: 'idle' })}
        />
      )}
      {phase.name === 'face' && (
        <Modal title={t('attend.face_title')} onClose={() => setPhase({ name: 'idle' })}>
          <FaceCheck
            onDone={(proof) => sendFace(phase.scan, phase.kind, proof)}
            onFail={(reason) => faceFailed(phase.scan, phase.kind, reason)}
          />
        </Modal>
      )}
      {phase.name === 'retry' && (
        <Modal title={t('attend.face_title')} onClose={() => setPhase({ name: 'idle' })}>
          <p className="mb-3">{phase.message}</p>
          <Button block onClick={() => setPhase({ name: 'face', scan: phase.scan, kind: phase.kind })}>
            <ScanFace className="size-4" aria-hidden />
            {t('attend.try_again')}
          </Button>
        </Modal>
      )}
    </>
  )
}
