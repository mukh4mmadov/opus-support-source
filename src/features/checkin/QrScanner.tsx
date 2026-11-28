import { useEffect, useRef } from 'react'
import jsQR from 'jsqr'

const SCAN_EVERY_MS = 250

export default function QrScanner({ onRead, onFail }: {
  onRead: (text: string) => void
  onFail: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const callbacks = useRef({ onRead, onFail })
  callbacks.current = { onRead, onFail }

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: number | undefined
    let stopped = false
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })

    function scan() {
      const source = video.current
      if (source && context && source.videoWidth > 0) {
        canvas.width = source.videoWidth
        canvas.height = source.videoHeight
        context.drawImage(source, 0, 0)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const found = jsQR(image.data, image.width, image.height)
        if (found?.data) {
          callbacks.current.onRead(found.data)
          return
        }
      }
      timer = window.setTimeout(scan, SCAN_EVERY_MS)
    }

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        stream = media
        video.current!.srcObject = media
        scan()
      })
      .catch(() => callbacks.current.onFail())
    if (!navigator.mediaDevices) callbacks.current.onFail()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return <video ref={video} autoPlay muted playsInline className="aspect-square w-full rounded-xl bg-black object-cover" />
}
