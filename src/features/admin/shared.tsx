import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useErrorText } from '../../app/config'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import type { Booking } from '../../lib/types'
import { formatDate, formatTime } from '../../lib/format'
import { StatusBadge } from '../../components/ui'
import { CountUp } from '../../components/motion'

export function useAction<V = void>(run: (variables: V) => Promise<unknown>, done?: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const errorText = useErrorText()
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      if (done) toast(done)
      queryClient.invalidateQueries()
    },
    onError: (error) => {
      const known = errorText(error)
      const raw = error instanceof Error ? error.message : ''
      toast(raw && /^[A-Z_]+$/.test(raw) ? raw.replaceAll('_', ' ').toLowerCase() : known, true)
    },
  })
}

export const markBooking = (booking: string, status: string) =>
  rpc('mark_attendance', { p_booking: booking, p_status: status })

export function StatTile({ label, value, hint }: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{typeof value === 'number' ? <CountUp value={value} /> : value}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  )
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line text-sm text-muted">
            {head.map((label, index) => (
              <th key={index} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}

export const Cell = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={`px-3 py-2 align-top ${className ?? ''}`}>{children}</td>
)

export function BookingRow({ booking, actions }: { booking: Booking; actions?: ReactNode }) {
  return (
    <tr>
      <Cell className="whitespace-nowrap">
        <span className="font-medium">{formatTime(booking.starts_at)}</span>
        <span className="block text-sm text-muted">{formatDate(booking.starts_at)}</span>
      </Cell>
      <Cell>
        <StatusBadge status={booking.status} />
        {booking.auto_marked && <span className="block text-sm text-muted">Automatic</span>}
        {booking.instant && <span className="block text-sm text-muted">Lesson now</span>}
        {booking.checked_in_at && <span className="block text-sm text-muted">QR scanned</span>}
        {booking.excuse_reason && <span className="block max-w-48 text-sm text-muted">{booking.excuse_reason}</span>}
      </Cell>
      <Cell>
        <Link to={`/admin/users/${booking.student_id}`} className="font-medium hover:underline">
          {booking.student_name}
        </Link>
      </Cell>
      <Cell>
        <Link to={`/admin/users/${booking.support_id}`} className="hover:underline">
          {booking.support_name}
        </Link>
      </Cell>
      <Cell className="max-w-56 text-sm text-muted">{booking.topic}</Cell>
      {actions !== undefined && <Cell className="whitespace-nowrap">{actions}</Cell>}
    </tr>
  )
}
