import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, ErrorState, Spinner } from '../../components/ui'
import { useText } from '../../app/config'
import { formatMonth, formatShortDay } from '../../lib/format'

export interface SeriesRow {
  start: string
  attended: number
  no_show: number
  excused: number
}

const UNITS = ['week', 'month'] as const
type Unit = (typeof UNITS)[number]

const SERIES = [
  { key: 'attended', label: 'history.came', color: 'var(--ok)', dot: 'bg-ok' },
  { key: 'no_show', label: 'history.missed', color: 'var(--bad)', dot: 'bg-bad' },
  { key: 'excused', label: 'history.excused', color: 'var(--warn)', dot: 'bg-warn' },
] as const

function ChartTip({ active, row, label }: { active?: boolean; row?: SeriesRow; label: string }) {
  const t = useText()
  if (!active || !row) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm">
      <p className="font-medium">{label}</p>
      {SERIES.map((series) => (
        <p key={series.key} className="flex items-center gap-1.5 text-muted">
          <span className={clsx('size-2 rounded-full', series.dot)} aria-hidden />
          {t(series.label)}: <span className="text-ink tabular-nums">{row[series.key]}</span>
        </p>
      ))}
    </div>
  )
}

export function AttendanceChart({ cacheKey, load }: {
  cacheKey: string
  load: (unit: Unit) => Promise<SeriesRow[]>
}) {
  const t = useText()
  const [unit, setUnit] = useState<Unit>('week')
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['attendance-series', cacheKey, unit],
    queryFn: () => load(unit),
  })
  const tick = (start: string) => (unit === 'week' ? formatShortDay(start) : formatMonth(start))
  const axis = { fontSize: 12, fill: 'var(--muted)' }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('history.chart_title')}</h2>
        <div className="flex gap-1">
          {UNITS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === unit}
              onClick={() => setUnit(item)}
              className={clsx(
                'rounded-lg border px-2.5 py-1 text-sm font-medium',
                item === unit ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface',
              )}
            >
              {t(`history.by_${item}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-sm text-muted">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className={clsx('size-2 rounded-full', series.dot)} aria-hidden />
            {t(series.label)}
          </span>
        ))}
      </div>
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="start"
              tick={axis}
              tickFormatter={tick}
              tickLine={false}
              axisLine={{ stroke: 'var(--line)' }}
              minTickGap={24}
            />
            <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--sunken)' }}
              content={({ active, label, payload }) => (
                <ChartTip
                  active={active}
                  row={payload?.[0]?.payload as SeriesRow | undefined}
                  label={label ? tick(String(label)) : ''}
                />
              )}
            />
            {SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                stackId="lessons"
                fill={series.color}
                stroke="var(--surface)"
                strokeWidth={2}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}
