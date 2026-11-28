import {
  useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, LoaderCircle, Star, X } from 'lucide-react'
import type { BookingStatus } from '../../lib/types'
import { useText } from '../../app/config'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:brightness-110',
  secondary: 'bg-surface text-ink border border-line hover:bg-sunken',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-surface text-bad border border-line hover:bg-bad-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
  block?: boolean
}

export const buttonClass = (variant: Variant = 'primary', size: 'sm' | 'md' = 'md', block = false) =>
  clsx(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition select-none active:scale-[0.97]',
    'disabled:opacity-50',
    size === 'md' ? 'h-11 px-4' : 'h-9 px-3 text-sm',
    block && 'w-full',
    VARIANTS[variant],
  )

export function Button({
  variant, size, loading, block, children, className, disabled, ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      className={clsx(buttonClass(variant, size, block), className)}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-surface p-4', className)}>
      {children}
    </section>
  )
}

export function PageHeader({ title, subtitle, action }: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-6 text-sm font-semibold text-muted">{children}</h2>
}

const fieldClass =
  'w-full rounded-lg border border-line bg-surface px-3 text-ink placeholder:text-muted'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  children: (id: string, className: string) => ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children(id, fieldClass)}
      {hint && !error && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {error && <p className="mt-1 text-sm text-bad">{error}</p>}
    </div>
  )
}

export function Spinner() {
  const t = useText()
  return (
    <div className="flex flex-col gap-3 py-2" role="status" aria-label={t('common.loading')}>
      <div className="skeleton h-7 w-1/2 rounded-lg" />
      <div className="skeleton h-28 rounded-2xl" />
      <div className="skeleton h-20 rounded-2xl" />
      <div className="skeleton h-20 rounded-2xl" />
    </div>
  )
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const t = useText()
  return (
    <Card className="text-center">
      <p className="mb-3" role="alert">{t('common.error')}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button>}
    </Card>
  )
}

export function EmptyState({ title, hint, action }: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad'

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  brand: 'bg-brand-soft text-brand-ink',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      TONES[tone],
    )}>
      {children}
    </span>
  )
}

const STATUS_TONE: Record<BookingStatus, Tone> = {
  booked: 'brand',
  needs_transfer: 'warn',
  attended: 'ok',
  no_show: 'bad',
  cancelled: 'neutral',
  support_absent: 'warn',
  unmarked: 'warn',
  excused: 'warn',
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const t = useText()
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>
}

export function Notice({ tone, title, children }: {
  tone: 'warn' | 'bad' | 'brand'
  title?: string
  children: ReactNode
}) {
  const color = { warn: 'bg-warn-soft', bad: 'bg-bad-soft', brand: 'bg-brand-soft' }[tone]
  return (
    <div className={clsx('rounded-xl p-4', color)} role={tone === 'bad' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  )
}

export function Stars({ value, onChange, size = 'sm' }: {
  value: number
  onChange?: (rating: number) => void
  size?: 'sm' | 'lg'
}) {
  const icon = size === 'lg' ? 'size-9' : 'size-4'
  return (
    <div className="flex gap-0.5" role={onChange ? 'radiogroup' : 'img'} aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = (
          <Star
            className={clsx(icon, n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-line')}
            aria-hidden
          />
        )
        return onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} stars`}
            onClick={() => onChange(n)}
          >
            {star}
          </button>
        ) : <span key={n}>{star}</span>
      })}
    </div>
  )
}

export function RatingLine({ average, count }: { average: number; count: number }) {
  const t = useText()
  if (count === 0) return <span className="text-sm text-muted">{t('supports.no_reviews')}</span>
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
      <span className="font-medium">{Number(average).toFixed(1)}</span>
      <span className="text-muted">({t('supports.reviews', { count })})</span>
    </span>
  )
}

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const focusableIn = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0)

const openDialogs: HTMLElement[] = []

function syncInert() {
  const top = openDialogs.at(-1)
  document.getElementById('root')!.inert = Boolean(top)
  openDialogs.forEach((dialog) => { dialog.inert = dialog !== top })
}

export function Modal({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const overlay = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef(document.activeElement as HTMLElement | null)

  useEffect(() => {
    const root = overlay.current!
    const box = panel.current!
    openDialogs.push(root)
    syncInert()
    if (!box.contains(document.activeElement)) {
      const items = focusableIn(box)
      const target = matchMedia('(pointer: coarse)').matches ? box : items[1] ?? items[0] ?? box
      target.focus()
    }
    return () => {
      openDialogs.splice(openDialogs.indexOf(root), 1)
      syncInert()
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const box = panel.current
      if (!box || overlay.current !== openDialogs.at(-1)) return
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const items = focusableIn(box)
      const active = document.activeElement
      const edge = event.shiftKey ? items[0] : items.at(-1)
      const wrapTo = event.shiftKey ? items.at(-1) : items[0]
      const leaving = active === edge || !box.contains(active) || (event.shiftKey && active === box)
      if (!leaving) return
      event.preventDefault()
      ;(wrapTo ?? box).focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      ref={overlay}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 outline-none sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-sunken">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function PasswordInput({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useText()
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} className={clsx(className, 'pr-11')} />
      <button
        type="button"
        aria-label={t(shown ? 'common.hide_typed' : 'common.show_typed')}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-ink"
      >
        {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  )
}

export function ConfirmDialog({ title, body, confirmLabel, danger, loading, onConfirm, onClose, children }: {
  title: string
  body: string
  children?: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useText()
  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-4 text-muted">{body}</p>
      {children}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel ?? t('common.confirm')}
        </Button>
      </div>
    </Modal>
  )
}

export function BackLink({ to }: { to: string }) {
  const t = useText()
  return <Link to={to} className="mb-3 inline-block text-sm text-muted hover:text-ink">← {t('common.back')}</Link>
}
