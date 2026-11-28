export const FAKE_FACE = Boolean(import.meta.env.VITE_FAKE_FACE)

export interface FaceSample {
  embedding: number[]
  yaw: number
  real: number
  live: number
  score: number
  blink: boolean
}

export interface FrameResult {
  faces: number
  sample: FaceSample | null
}

type HumanInstance = {
  load: () => Promise<void>
  detect: (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) => Promise<{
    face: {
      score: number
      embedding?: number[]
      real?: number
      live?: number
      rotation?: { angle: { yaw: number } } | null
    }[]
    gesture: { face?: number; gesture: string }[]
  }>
}

let human: Promise<HumanInstance> | undefined

export function loadFaceEngine() {
  human ??= (async () => {
    const { Human } = await import('@vladmandic/human')
    const instance = new Human({
      modelBasePath: '/models/human/',
      cacheSensitivity: 0,
      warmup: 'none',
      debug: false,
      filter: { enabled: true, equalization: false, flip: false },
      face: {
        enabled: true,
        detector: { rotation: true, maxDetected: 2, minConfidence: 0.5, return: false },
        mesh: { enabled: true },
        iris: { enabled: false },
        description: { enabled: true },
        emotion: { enabled: false },
        antispoof: { enabled: true },
        liveness: { enabled: true },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      segmentation: { enabled: false },
      gesture: { enabled: true },
    }) as unknown as HumanInstance
    await instance.load()
    return instance
  })()
  human.catch(() => { human = undefined })
  return human
}

export async function readFrame(input: HTMLVideoElement | HTMLImageElement): Promise<FrameResult> {
  const engine = await loadFaceEngine()
  const result = await engine.detect(input)
  const face = result.face[0]
  if (result.face.length !== 1 || !face?.embedding?.length) {
    return { faces: result.face.length, sample: null }
  }
  return {
    faces: 1,
    sample: {
      embedding: Array.from(face.embedding),
      yaw: face.rotation?.angle.yaw ?? 0,
      real: face.real ?? 0,
      live: face.live ?? 0,
      score: face.score,
      blink: result.gesture.some((item) => item.gesture.startsWith('blink')),
    },
  }
}

export function snapshot(source: HTMLVideoElement | HTMLImageElement, maxSide = 320) {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  const scale = Math.min(1, maxSide / Math.max(width || 1, height || 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.75)
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = URL.createObjectURL(file)
  })
}

export async function describePhoto(file: File) {
  const image = await loadImage(file)
  try {
    const photo = snapshot(image, 480)
    if (FAKE_FACE) return { embedding: fakeEmbedding(file.name.replace(/\.[^.]+$/, '')), photo }
    const { faces, sample } = await readFrame(image)
    if (faces === 0) throw new Error('NO_FACE')
    if (faces > 1 || !sample) throw new Error('MANY_FACES')
    return { embedding: sample.embedding, photo }
  } finally {
    URL.revokeObjectURL(image.src)
  }
}

let fakeNoise = 0
export function fakeEmbedding(name: string) {
  let seed = 0
  for (const char of name.toLowerCase()) seed = (seed * 31 + char.charCodeAt(0)) % 1000
  const base = 0.5 + seed / 250
  fakeNoise += 1
  const jitter = Math.random() * 100 + fakeNoise
  return Array.from({ length: 1024 }, (_, i) =>
    Math.round((Math.sin(base * (i + 1)) * 2 + Math.sin(jitter * 7.3 + i) * 0.02) * 1e4) / 1e4)
}

export function fakeFaceName() {
  try {
    return localStorage.getItem('fake-face') ?? 'nobody'
  } catch {
    return 'nobody'
  }
}
