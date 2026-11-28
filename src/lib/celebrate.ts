const COLORS = ['#2346d0', '#4b78dd', '#f5b301', '#16a34a', '#ef4444', '#a855f7', '#06b6d4']

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function celebrate() {
  navigator.vibrate?.(calm() ? 30 : [25, 40, 60])
  if (calm() || typeof document === 'undefined') return

  const layer = document.createElement('div')
  layer.className = 'celebrate'
  layer.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 70; i += 1) {
    const piece = document.createElement('span')
    piece.style.left = `${Math.random() * 100}%`
    piece.style.background = COLORS[i % COLORS.length]
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 40}vw`)
    piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`)
    piece.style.animationDelay = `${Math.random() * 0.25}s`
    piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`
    if (i % 3 === 0) piece.style.borderRadius = '50%'
    layer.append(piece)
  }
  const badge = document.createElement('div')
  badge.className = 'celebrate-badge'
  badge.innerHTML = '<svg viewBox="0 0 52 52" width="52" height="52"><path d="M14 27l8 8 16-17" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  layer.append(badge)
  document.body.append(layer)
  window.setTimeout(() => layer.remove(), 3000)
}

export const tap = () => navigator.vibrate?.(8)
