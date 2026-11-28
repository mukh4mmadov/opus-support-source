import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { EmptyState, ErrorState, PageHeader, RatingLine, Spinner } from '../../components/ui'
import { useText } from '../../app/config'
import { rpc } from '../../lib/api'
import { formatDateTime, scheduleLines } from '../../lib/format'
import type { SupportCard } from '../../lib/types'

export const initials = (name: string) =>
  name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()

export function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-ink">
      {initials(name)}
    </span>
  )
}

export function SupportsList() {
  const t = useText()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['supports'],
    queryFn: () => rpc<SupportCard[]>('list_supports'),
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  return (
    <>
      <PageHeader title={t('supports.title')} subtitle={t('supports.subtitle')} />
      {data.length === 0 && <EmptyState title={t('supports.none')} />}
      <ul className="flex flex-col gap-2">
        {data.map((support) => (
          <li key={support.id}>
            <Link
              to={`/supports/${support.id}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-sunken"
            >
              <Avatar name={support.name} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{support.name}</p>
                <RatingLine {...support.rating} />
                {support.bio && <p className="truncate text-sm text-muted">{support.bio}</p>}
                <p className="text-sm text-muted">{scheduleLines(support.schedule).join(' · ')}</p>
                <p className="text-sm font-medium text-brand-ink">
                  {support.next_free
                    ? t('supports.next_free', { when: formatDateTime(support.next_free) })
                    : t('supports.no_free')}
                </p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
