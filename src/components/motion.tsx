import { useEffect, useRef, useState } from 'react'
import { useText } from '../app/config'

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const unseen = () => typeof document !== 'undefined' && document.visibilityState !== 'visible'

export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(() => (calm() || unseen() ? value : 0))
  const from = useRef(0)
  useEffect(() => {
    if (calm() || unseen()) {
      setShown(value)
      from.current = value
      return
    }
    const start = performance.now()
    const begin = from.current
    let frame = 0
    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / 700)
      const eased = 1 - (1 - progress) ** 3
      setShown(Math.round(begin + (value - begin) * eased))
      if (progress < 1) frame = requestAnimationFrame(step)
      else from.current = value
    }
    frame = requestAnimationFrame(step)
    const fallback = window.setTimeout(() => {
      setShown(value)
      from.current = value
    }, 900)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(fallback)
    }
  }, [value])
  return <>{shown}</>
}

export function Countdown({ start, end }: { start: string; end: string }) {
  const t = useText()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  const begins = new Date(start).getTime()
  const ends = new Date(end).getTime()
  if (now >= ends) return null
  if (now >= begins) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">
        <span className="live-dot" aria-hidden />
        {t('time.in_progress')}
      </span>
    )
  }
  const minutes = Math.ceil((begins - now) / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  const time = days > 0
    ? t('time.dh', { d: days, h: hours })
    : hours > 0 ? t('time.hm', { h: hours, m: rest }) : t('time.m', { m: rest })
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold">
      {minutes <= 15 && <span className="live-dot" aria-hidden />}
      {t('time.starts_in', { time })}
    </span>
  )
}
