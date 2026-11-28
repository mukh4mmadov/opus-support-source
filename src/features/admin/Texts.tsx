import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Badge, Button, ErrorState, Field, Modal, PageHeader, Spinner } from '../../components/ui'
import { rpc } from '../../lib/api'
import { DEFAULT_STRINGS } from '../../lib/strings'
import { useAction } from './shared'

const ALL = Object.entries(DEFAULT_STRINGS) as [string, string][]

function Editor({ textKey, original, current, onClose }: {
  textKey: string
  original: string
  current?: string
  onClose: () => void
}) {
  const [value, setValue] = useState(current ?? original)

  const save = useAction(async (next: string) => {
    await rpc('admin_save_string', { p_key: textKey, p_value: next === original ? '' : next })
    onClose()
  }, 'Saved.')

  return (
    <Modal title="Edit text" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Original: {original}</p>
        <Field label="Text" hint="Keep words in {single braces}: they are filled in automatically.">
          {(id, className) => (
            <textarea id={id} rows={3} className={`${className} py-2`} value={value}
              onChange={(event) => setValue(event.target.value)} />
          )}
        </Field>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => save.mutate('')}>Restore original</Button>
          <Button disabled={!value.trim()} loading={save.isPending} onClick={() => save.mutate(value)}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

export function Texts() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-strings'],
    queryFn: () => rpc<{ strings: Record<string, string> }>('get_public_config'),
  })

  const rows = useMemo(() => {
    const term = search.toLowerCase()
    return ALL.filter(([key, text]) =>
      `${key} ${text} ${data?.strings[key] ?? ''}`.toLowerCase().includes(term))
  }, [search, data])

  if (isPending) return <Spinner />
  if (isError) return <ErrorState onRetry={refetch} />

  return (
    <>
      <PageHeader title="Texts" subtitle="Change any sentence students and support teachers read." />
      <div className="relative mb-3">
        <Search className="absolute left-3 top-3 size-5 text-muted" aria-hidden />
        <input
          aria-label="Search texts"
          placeholder="Search"
          className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-3"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map(([key, original]) => {
          const custom = data.strings[key]
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => setEditing(key)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-left hover:bg-sunken"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">{key}</span>
                  {custom && <Badge tone="brand">Edited</Badge>}
                </span>
                <span className="block">{custom ?? original}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {editing && (
        <Editor
          textKey={editing}
          original={DEFAULT_STRINGS[editing as keyof typeof DEFAULT_STRINGS]}
          current={data.strings[editing]}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
