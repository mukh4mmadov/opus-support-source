import { useQuery } from '@tanstack/react-query'
import { BackLink, ErrorState, PageHeader, Spinner } from '../../components/ui'
import { useMe } from '../../app/auth'
import { useText } from '../../app/config'
import { rpc } from '../../lib/api'
import type { AttendanceSummary as Summary } from '../../lib/types'
import { AttendanceChart, type SeriesRow } from './AttendanceChart'
import { AttendanceSummary } from './AttendanceSummary'

export default function HistoryStats() {
  const me = useMe()
  const t = useText()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['my-attendance'],
    queryFn: () => rpc<Summary>('my_attendance'),
  })

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  return (
    <>
      <BackLink to="/history" />
      <PageHeader title={t('history.stats')} />
      <AttendanceSummary summary={data} forSupport={me.role === 'support'} />
      <AttendanceChart
        cacheKey="me"
        load={(unit) => rpc<SeriesRow[]>('my_attendance_series', { p_unit: unit })}
      />
    </>
  )
}
