import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, SectionTitle, Spinner,
} from '../../components/ui'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { useAction } from './shared'

interface Setting {
  key: string
  value: string | number | boolean
  kind: 'int' | 'bool' | 'text' | 'color' | 'image'
  section: string
  label: string
  help: string
}

interface Template {
  type: string
  title: string
  body: string
  enabled: boolean
  description: string
}

interface AnnouncementRow {
  id: string
  title: string
  body: string
  audience: string
  is_active: boolean
}

interface Config {
  settings: Setting[]
  templates: Template[]
  announcements: AnnouncementRow[]
}

const SECTION_ORDER = ['Branding', 'Booking', 'Attendance', 'Reminders', 'Features', 'Staff attendance']

function LocationField({ setting, value, onChange }: {
  setting: Setting
  value: string
  onChange: (next: string) => void
}) {
  const toast = useToast()
  const [finding, setFinding] = useState(false)

  function takeHere() {
    if (!navigator.geolocation) {
      toast('This device cannot share its location.', true)
      return
    }
    setFinding(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFinding(false)
        const { latitude, longitude, accuracy } = position.coords
        onChange(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`)
        toast(`Location found (accurate to about ${Math.round(accuracy)} m). Save to keep it.`)
      },
      () => {
        setFinding(false)
        toast('The location could not be found. Allow location for this site and try again.', true)
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    )
  }

  return (
    <Field label={setting.label} hint={setting.help || undefined}>
      {(id, className) => (
        <div className="flex flex-wrap gap-2">
          <input id={id} className={`${className} h-11 min-w-0 flex-1`} placeholder="40.386400, 71.786400"
            value={value} onChange={(event) => onChange(event.target.value)} />
          <Button size="sm" variant="secondary" className="h-11" loading={finding} onClick={takeHere}>
            Use this device's location
          </Button>
        </div>
      )}
    </Field>
  )
}

function resizeImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onerror = reject
    image.onload = () => {
      const scale = Math.min(1, 320 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(image.src)
      resolve(canvas.toDataURL('image/png'))
    }
    image.src = URL.createObjectURL(file)
  })
}

function LogoField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)

  async function pick(file?: File) {
    if (!file) return
    try {
      onChange(await resizeImage(file))
    } catch {
      toast('This image could not be read.', true)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {value
        ? <img src={value} alt="Current logo" className="h-12 rounded bg-sunken p-1" />
        : <span className="text-muted">No logo yet, the center name is shown.</span>}
      <input ref={input} type="file" accept="image/*" className="hidden"
        onChange={(event) => pick(event.target.files?.[0])} />
      <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>Upload</Button>
      {value && <Button size="sm" variant="ghost" onClick={() => onChange('')}>Remove</Button>}
    </div>
  )
}

function SettingControl({ setting, value, onChange }: {
  setting: Setting
  value: Setting['value']
  onChange: (next: Setting['value']) => void
}) {
  if (setting.kind === 'bool') {
    return (
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 size-4" checked={value as boolean}
          onChange={(event) => onChange(event.target.checked)} />
        <span>
          <span className="font-medium">{setting.label}</span>
          {setting.help && <span className="block text-sm text-muted">{setting.help}</span>}
        </span>
      </label>
    )
  }

  if (setting.key === 'staff_center_location') {
    return <LocationField setting={setting} value={value as string} onChange={onChange} />
  }

  if (setting.kind === 'image') {
    return (
      <div>
        <p className="mb-1 text-sm font-medium">{setting.label}</p>
        <LogoField value={value as string} onChange={onChange} />
      </div>
    )
  }

  return (
    <Field label={setting.label} hint={setting.help || undefined}>
      {(id, className) => {
        if (setting.kind === 'color') {
          return (
            <input id={id} type="color" className="h-11 w-20 rounded-lg border border-line bg-surface p-1"
              value={value as string} onChange={(event) => onChange(event.target.value)} />
          )
        }
        return (
          <input
            id={id}
            type={setting.kind === 'int' ? 'number' : 'text'}
            min={setting.kind === 'int' ? 0 : undefined}
            className={`${className} h-11`}
            value={value as string | number}
            onChange={(event) => onChange(
              setting.kind === 'int' ? Number(event.target.value) : event.target.value,
            )}
          />
        )
      }}
    </Field>
  )
}

function RulesTab({ settings }: { settings: Setting[] }) {
  const [draft, setDraft] = useState<Record<string, Setting['value']>>({})

  const save = useAction(async () => {
    for (const [key, value] of Object.entries(draft)) {
      await rpc('admin_save_setting', { p_key: key, p_value: value })
    }
    setDraft({})
  }, 'Settings saved.')

  const changed = Object.keys(draft).length

  return (
    <>
      {SECTION_ORDER.map((section) => (
        <div key={section}>
          <SectionTitle>{section}</SectionTitle>
          <Card className="grid gap-4 sm:grid-cols-2">
            {settings.filter((item) => item.section === section).map((setting) => (
              <SettingControl
                key={setting.key}
                setting={setting}
                value={draft[setting.key] ?? setting.value}
                onChange={(next) => setDraft({ ...draft, [setting.key]: next })}
              />
            ))}
          </Card>
        </div>
      ))}
      {changed > 0 && (
        <div className="sticky bottom-3 mt-4 flex justify-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save {changed} {changed === 1 ? 'change' : 'changes'}
          </Button>
        </div>
      )}
    </>
  )
}

function TemplateEditor({ template, onClose }: { template: Template; onClose: () => void }) {
  const [title, setTitle] = useState(template.title)
  const [body, setBody] = useState(template.body)
  const [enabled, setEnabled] = useState(template.enabled)

  const save = useAction(async () => {
    await rpc('admin_save_template', {
      p_type: template.type, p_title: title, p_body: body, p_enabled: enabled,
    })
    onClose()
  }, 'Saved.')

  return (
    <Modal title={template.description} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          {(id, className) => (
            <input id={id} className={`${className} h-11`} value={title}
              onChange={(event) => setTitle(event.target.value)} />
          )}
        </Field>
        <Field label="Message" hint="Keep the words in {{double braces}}: they are filled in automatically.">
          {(id, className) => (
            <textarea id={id} rows={3} className={`${className} py-2`} value={body}
              onChange={(event) => setBody(event.target.value)} />
          )}
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)} />
          Send this notification
        </label>
        <Button disabled={!title.trim() || !body.trim()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Modal>
  )
}

function TemplatesTab({ templates }: { templates: Template[] }) {
  const [editing, setEditing] = useState<Template | null>(null)
  return (
    <>
      <ul className="mt-4 flex flex-col gap-2">
        {templates.map((template) => (
          <li key={template.type}>
            <button
              type="button"
              onClick={() => setEditing(template)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-left hover:bg-sunken"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted">{template.description}</span>
                {!template.enabled && <Badge>Off</Badge>}
              </span>
              <span className="block font-semibold">{template.title}</span>
              <span className="block">{template.body}</span>
            </button>
          </li>
        ))}
      </ul>
      {editing && <TemplateEditor template={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function AnnouncementEditor({ item, onClose }: {
  item: Partial<AnnouncementRow>
  onClose: () => void
}) {
  const [title, setTitle] = useState(item.title ?? '')
  const [body, setBody] = useState(item.body ?? '')
  const [audience, setAudience] = useState(item.audience ?? 'all')
  const [active, setActive] = useState(item.is_active ?? true)

  const save = useAction(async () => {
    await rpc('admin_save_announcement', {
      p_id: item.id ?? null, p_title: title, p_body: body, p_audience: audience, p_active: active,
    })
    onClose()
  }, 'Saved.')
  const remove = useAction(async () => {
    await rpc('admin_delete_announcement', { p_id: item.id })
    onClose()
  }, 'Deleted.')

  return (
    <Modal title={item.id ? 'Edit announcement' : 'New announcement'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          {(id, className) => (
            <input id={id} className={`${className} h-11`} value={title}
              onChange={(event) => setTitle(event.target.value)} />
          )}
        </Field>
        <Field label="Message">
          {(id, className) => (
            <textarea id={id} rows={4} className={`${className} py-2`} value={body}
              onChange={(event) => setBody(event.target.value)} />
          )}
        </Field>
        <Field label="Shown to">
          {(id, className) => (
            <select id={id} className={`${className} h-11`} value={audience}
              onChange={(event) => setAudience(event.target.value)}>
              <option value="all">Everyone</option>
              <option value="student">Students</option>
              <option value="support">Support teachers</option>
            </select>
          )}
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={active}
            onChange={(event) => setActive(event.target.checked)} />
          Visible now
        </label>
        <div className="flex justify-between gap-2">
          {item.id
            ? <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>
            : <span />}
          <Button disabled={!title.trim() || !body.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function AnnouncementsTab({ items }: { items: AnnouncementRow[] }) {
  const [editing, setEditing] = useState<Partial<AnnouncementRow> | null>(null)
  return (
    <>
      <div className="my-4">
        <Button onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New announcement</Button>
      </div>
      {items.length === 0 && <EmptyState title="No announcements" hint="They appear on the home screen." />}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setEditing(item)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-left hover:bg-sunken"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{item.title}</span>
                {!item.is_active && <Badge>Hidden</Badge>}
              </span>
              <span className="block whitespace-pre-line text-muted">{item.body}</span>
            </button>
          </li>
        ))}
      </ul>
      {editing && <AnnouncementEditor item={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

const TABS = [
  { id: 'rules', label: 'Rules' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'announcements', label: 'Announcements' },
] as const

export function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('rules')
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => rpc<Config>('admin_config'),
  })

  return (
    <>
      <PageHeader title="Settings" subtitle="Every change applies at once, with no code." />
      <div className="flex gap-2" role="tablist">
        {TABS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            role="tab"
            aria-selected={tab === item.id}
            variant={tab === item.id ? 'primary' : 'secondary'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {isPending && <Spinner />}
      {isError && <ErrorState onRetry={refetch} />}
      {data && tab === 'rules' && <RulesTab settings={data.settings} />}
      {data && tab === 'notifications' && <TemplatesTab templates={data.templates} />}
      {data && tab === 'announcements' && <AnnouncementsTab items={data.announcements} />}
    </>
  )
}
