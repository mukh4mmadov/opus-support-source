import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BackLink, buttonClass, ErrorState, RatingLine, Spinner } from '../../components/ui'
import { useText } from '../../app/config'
import { rpc } from '../../lib/api'
import { scheduleLines } from '../../lib/format'
import type { SupportDetail } from '../../lib/types'
import { Avatar } from './SupportsList'

export function SupportPage() {
  const { id } = useParams()
  const t = useText()
  const { data: support, isPending, isError, refetch } = useQuery({
    queryKey: ['support', id],
    queryFn: () => rpc<SupportDetail>('support_detail', { p_support: id }),
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  return (
    <>
      <BackLink to="/supports" />
      <div className="flex items-center gap-3">
        <Avatar name={support.name} />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{support.name}</h1>
          <RatingLine {...support.rating} />
        </div>
      </div>
      {support.bio && <p className="mt-3 text-muted">{support.bio}</p>}
      <p className="mt-1 text-sm text-muted">{scheduleLines(support.schedule).join(' · ')}</p>
      <Link to="/book" className={`${buttonClass('primary', 'md', true)} mt-4`}>{t('home.book')}</Link>
      <p className="mt-3 text-sm text-muted">{t('supports.rating_private')}</p>
    </>
  )
}
