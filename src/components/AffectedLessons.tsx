import { useText } from '../app/config'
import { formatDateTime, formatTime } from '../lib/format'
import { Notice } from './ui'

export interface AffectedLesson {
  id: string
  student_name: string
  support_name: string
  starts_at: string
  outcome: 'transfer' | 'cancel'
}

export function AffectedLessons({ lessons, showDay = false, showSupport = false }: {
  lessons: AffectedLesson[] | undefined
  showDay?: boolean
  showSupport?: boolean
}) {
  const t = useText()
  if (!lessons) return <div className="skeleton mb-4 h-12 rounded-lg" aria-hidden />
  if (lessons.length === 0) return <p className="mb-4 text-sm text-muted">{t('affected.none')}</p>
  return (
    <div className="mb-4">
      <Notice tone="warn" title={t('affected.title', { count: lessons.length })}>
        <ul className="flex flex-col gap-1.5">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <span className="font-medium">{lesson.student_name}</span>
              {' · '}{showDay ? formatDateTime(lesson.starts_at) : formatTime(lesson.starts_at)}
              {showSupport && ` · ${lesson.support_name}`}
              <span className="block text-sm">{t(`affected.${lesson.outcome}`)}</span>
            </li>
          ))}
        </ul>
      </Notice>
    </div>
  )
}
