import { useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '../../components/ui'
import { useText } from '../../app/config'
import type { StringKey } from '../../lib/strings'
import { FAKE_FACE, fakeEmbedding, fakeFaceName, loadFaceEngine, readFrame, snapshot } from '../../lib/face'

export interface FaceProof {
  faces: number[][]
  photo: string
  real: number | null
  live: number | null
}

type Step = 'straight' | 'turn' | 'turn_other' | 'blink' | 'straight_end'

const FRAME_EVERY_MS = 120
const GIVE_UP_MS = 45_000
const TURNED = 0.3
const STRAIGHT = 0.15
const REAL_ENOUGH = 0.25

function randomSteps(): Step[] {
  const middle: Step[][] = [['turn', 'turn_other'], ['blink']]
  if (Math.random() < 0.5) middle.reverse()
  return ['straight', ...middle.flat(), 'straight_end']
}

const HINT: Record<Step, StringKey> = {
  straight: 'attend.face_straight',
  turn: 'attend.face_turn',
  turn_other: 'attend.face_turn_other',
  blink: 'attend.face_blink',
  straight_end: 'attend.face_straight',
}

export function FaceCheck({ onDone, onFail }: {
  onDone: (proof: FaceProof) => void
  onFail: (reason: 'camera' | 'timeout' | 'engine') => void
}) {
  if (FAKE_FACE) return <FakeFaceCheck onDone={onDone} />
  return <RealFaceCheck onDone={onDone} onFail={onFail} />
}

function RealFaceCheck({ onDone, onFail }: {
  onDone: (proof: FaceProof) => void
  onFail: (reason: 'camera' | 'timeout' | 'engine') => void
}) {
  const t = useText()
  const video = useRef<HTMLVideoElement>(null)
  const callbacks = useRef({ onDone, onFail })
  callbacks.current = { onDone, onFail }
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState<Step>('straight')
  const [problem, setProblem] = useState<StringKey | null>(null)
  const [steps] = useState(randomSteps)

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: number | undefined
    let stopped = false
    let index = 0
    let side = 0
    const faces: number[][] = []
    let real = 1
    let live = 1
    const started = Date.now()

    async function tick() {
      if (stopped) return
      if (Date.now() - started > GIVE_UP_MS) {
        callbacks.current.onFail('timeout')
        return
      }
      const source = video.current
      if (source && source.videoWidth > 0) {
        try {
          const { faces: count, sample } = await readFrame(source)
          if (stopped) return
          if (count === 0) setProblem('attend.face_none')
          else if (count > 1) setProblem('attend.face_many')
          else setProblem(null)
          const current = steps[index]
          let passed = false
          if (sample) {
            if (current === 'straight' || current === 'straight_end') {
              if (Math.abs(sample.yaw) < STRAIGHT) {
                if (sample.real < REAL_ENOUGH || sample.live < REAL_ENOUGH) {
                  setProblem('attend.face_light')
                } else {
                  faces.push(sample.embedding)
                  real = Math.min(real, sample.real)
                  live = Math.min(live, sample.live)
                  passed = true
                }
              }
            } else if (current === 'turn') {
              if (Math.abs(sample.yaw) > TURNED) {
                side = Math.sign(sample.yaw)
                passed = true
              }
            } else if (current === 'turn_other') {
              passed = sample.yaw * side < -TURNED
            } else if (current === 'blink') {
              passed = sample.blink
            }
          }
          if (passed) {
            index += 1
            if (index === steps.length) {
              stopped = true
              callbacks.current.onDone({ faces, photo: snapshot(source), real, live })
              return
            }
            setStep(steps[index])
          }
        } catch {
          callbacks.current.onFail('engine')
          return
        }
      }
      timer = window.setTimeout(tick, FRAME_EVERY_MS)
    }

    Promise.all([
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } } }),
      loadFaceEngine(),
    ])
      .then(([media]) => {
        if (stopped || !media) {
          media?.getTracks().forEach((track) => track.stop())
          if (!media) callbacks.current.onFail('camera')
          return
        }
        stream = media
        video.current!.srcObject = media
        setReady(true)
        tick()
      })
      .catch((error: unknown) => {
        const camera = error instanceof DOMException
        callbacks.current.onFail(camera ? 'camera' : 'engine')
      })

    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [steps])

  return (
    <div>
      {!ready && (
        <div className="mb-3 text-center">
          <Spinner />
          <p className="text-sm text-muted">{t('attend.face_loading')}</p>
        </div>
      )}
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        className="aspect-square w-full -scale-x-100 rounded-full bg-black object-cover"
      />
      {ready && (
        <>
          <p className="mt-3 text-center text-lg font-semibold" aria-live="polite">{t(HINT[step])}</p>
          {problem && <p className="text-center text-sm text-warn">{t(problem)}</p>}
          <p className="mt-1 text-center text-sm text-muted">
            {t('attend.face_step', { step: steps.indexOf(step) + 1, count: steps.length })}
          </p>
        </>
      )}
    </div>
  )
}

function FakeFaceCheck({ onDone }: { onDone: (proof: FaceProof) => void }) {
  function pass() {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const name = fakeFaceName()
    onDone({
      faces: [fakeEmbedding(name), fakeEmbedding(name)],
      photo: canvas.toDataURL('image/jpeg', 0.75),
      real: 0.9,
      live: 0.9,
    })
  }
  return (
    <div className="text-center">
      <p className="mb-3 text-muted">Test camera</p>
      <Button onClick={pass}>Look at the camera</Button>
    </div>
  )
}
