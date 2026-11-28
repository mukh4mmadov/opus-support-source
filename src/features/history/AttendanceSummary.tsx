import { useState } from 'react'
import { clsx } from 'clsx'
import { useText } from '../../app/config'
import { CountUp } from '../../components/motion'
import type { AttendanceSummary as Summary } from '../../lib/types'

const PERIODS = ['week', 'month', 'year', 'all'] as const

export function AttendanceSummary({ summary, forSupport, plain = false }: {
  summary: Summary
  forSupport: boolean
  plain?: boolean
}) {
  const t = useText()
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('month')
  const counts = summary[period]
  const tiles = [
    { label: t('history.came'), value: counts.attended, dot: 'bg-ok' },
    { label: t('history.missed'), value: counts.no_show, dot: 'bg-bad' },
    { label: t('history.excused'), value: counts.excused, dot: 'bg-warn' },
    { label: t('history.cancelled'), value: counts.cancelled, dot: 'bg-muted' },
    ...(forSupport
      ? [
          { label: t('history.forgot'), value: counts.forgot, dot: 'bg-bad' },
          { label: t('history.closed_same_day'), value: counts.closed_same_day, dot: 'bg-warn' },
        ]
      : []),
  ]

  return (
    <section aria-label={t('history.period')} className="mb-4">
      <div className="mb-2 flex flex-wrap gap-1">
        {PERIODS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={item === period}
            onClick={() => setPeriod(item)}
            className={clsx(
              'rounded-lg border px-3 py-1.5 text-sm font-medium',
              item === period ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface',
            )}
          >
            {t(`history.${item}`)}
          </button>
        ))}
      </div>
      <dl className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-line bg-surface p-3">
            <dt className="flex items-center gap-1.5 text-sm text-muted">
              <span className={clsx('size-2 shrink-0 rounded-full', tile.dot)} aria-hidden />
              {tile.label}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">{plain ? tile.value : <CountUp value={tile.value} />}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
