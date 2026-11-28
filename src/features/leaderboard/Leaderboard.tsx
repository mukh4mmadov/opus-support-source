import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Trophy } from 'lucide-react'
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useMe } from '../../app/auth'
import { useText } from '../../app/config'
import { rpc } from '../../lib/api'

interface Ranking {
  top: { place: number; name: string; lessons: number; is_me: boolean }[]
  me: { place: number; lessons: number } | null
}

const PERIODS = ['month', 'all'] as const
const loadRanking = (period: string) => rpc<Ranking>('leaderboard', { p_period: period })

export function RankCard() {
  const me = useMe()
  const t = useText()
  const { data } = useQuery({
    queryKey: ['leaderboard', 'month'],
    queryFn: () => loadRanking('month'),
    enabled: me.leaderboard_enabled,
  })
  if (!me.leaderboard_enabled || !data) return null
  return (
    <Link to="/top" className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 hover:bg-sunken">
      <Trophy className="size-6 shrink-0 text-warn" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">
        {data.me
          ? t('top.my_place', { place: data.me.place, lessons: data.me.lessons })
          : t('top.invite')}
      </span>
    </Link>
  )
}

export function Leaderboard() {
  const t = useText()
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('month')
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: () => loadRanking(period),
  })

  return (
    <>
      <PageHeader title={t('top.title')} subtitle={t('top.subtitle')} />
      <div className="mb-3 flex gap-1">
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
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data?.top.length === 0 && <EmptyState title={t('top.empty')} />}
      {data && data.top.length > 0 && (
        <ol className="mb-3 grid grid-cols-3 items-end gap-2" aria-label={t('top.title')}>
          {[1, 0, 2].map((index) => {
            const row = data.top[index]
            if (!row) return <li key={index} aria-hidden />
            const medal = ['#f5b301', '#a8b3c4', '#cd7f45'][index]
            return (
              <li
                key={`${row.place}-${row.name}`}
                className={clsx('animate-pop-in flex flex-col items-center text-center', row.is_me && 'font-semibold')}
                style={{ animationDelay: `${[150, 0, 300][index]}ms` }}
              >
                <span
                  className="mb-1 grid size-12 place-items-center rounded-full text-lg font-bold text-white shadow-lg"
                  style={{ background: medal }}
                >
                  {row.place}
                </span>
                <span className="line-clamp-2 text-sm font-medium">{row.name}</span>
                <span className="text-xs text-muted tabular-nums">{t('top.lessons', { count: row.lessons })}</span>
                <span
                  className={clsx('hero mt-2 w-full rounded-t-xl', row.is_me && 'ring-2 ring-[color:var(--accent)]')}
                  style={{ height: `${[96, 64, 44][index]}px` }}
                  aria-hidden
                />
              </li>
            )
          })}
        </ol>
      )}
      {data && data.top.length > 3 && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <ol className="stagger divide-y divide-line" start={4}>
            {data.top.slice(3).map((row) => (
              <li
                key={`${row.place}-${row.name}`}
                className={clsx('flex items-center gap-3 px-4 py-3', row.is_me && 'bg-brand-soft')}
              >
                <span className="flex w-8 shrink-0 justify-center font-semibold tabular-nums">
                  {row.place === 1 ? <Trophy className="size-5 text-warn" aria-label="1" /> : row.place}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                <span className="text-muted tabular-nums">{t('top.lessons', { count: row.lessons })}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {data?.me && !data.top.some((row) => row.is_me) && (
        <p className="mt-3 text-center text-muted">
          {t('top.my_place', { place: data.me.place, lessons: data.me.lessons })}
        </p>
      )}
    </>
  )
}
