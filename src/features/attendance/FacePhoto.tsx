import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, ConfirmDialog, Spinner } from '../../components/ui'
import { useToast } from '../../app/toast'
import { rpc } from '../../lib/api'
import { describePhoto } from '../../lib/face'
import { formatDateTime } from '../../lib/format'
import { useAction } from '../admin/shared'

export function FacePhotoCard({ support }: { support: string }) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const { data, isPending } = useQuery({
    queryKey: ['staff-face', support],
    queryFn: () => rpc<{ photo: string; updated_at: string } | null>('admin_staff_face', { p_user: support }),
  })
  const save = useAction(
    (face: { embedding: number[]; photo: string }) =>
      rpc('admin_set_staff_face', { p_user: support, p_descriptor: face.embedding, p_photo: face.photo }),
    'Photo saved.',
  )
  const remove = useAction(async () => {
    await rpc('admin_remove_staff_face', { p_user: support })
    setRemoving(false)
  }, 'Photo removed.')

  async function pick(file?: File) {
    if (!file) return
    setReading(true)
    try {
      save.mutate(await describePhoto(file))
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      toast(
        code === 'NO_FACE' ? 'No face was found in this photo. Use a clear photo of the face, from the front.'
          : code === 'MANY_FACES' ? 'This photo has more than one face. Use a photo of this teacher alone.'
            : 'This photo could not be read.',
        true,
      )
    } finally {
      setReading(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Card>
      <p className="mb-3 text-sm text-muted">
        Attendance compares the face check on the teacher's phone with this photo. Use a clear photo of the face,
        from the front, in good light, with nobody else in it. It is never shown to the teacher's phone.
      </p>
      {isPending && <Spinner />}
      <div className="flex flex-wrap items-center gap-3">
        {data
          ? (
            <figure>
              <img src={data.photo} alt="Face photo" className="h-32 rounded-lg" />
              <figcaption className="text-sm text-muted">Uploaded {formatDateTime(data.updated_at)}</figcaption>
            </figure>
          )
          : !isPending && <span className="text-muted">No photo yet. This teacher cannot scan in until one is uploaded.</span>}
        <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Face photo file"
          onChange={(event) => pick(event.target.files?.[0])} />
        <Button size="sm" variant="secondary" loading={reading || save.isPending} onClick={() => input.current?.click()}>
          {data ? 'Replace photo' : 'Upload photo'}
        </Button>
        {data && <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>Remove</Button>}
      </div>
      {removing && (
        <ConfirmDialog
          title="Remove the face photo?"
          body="Until a new photo is uploaded, this teacher cannot scan in and reception has to mark them by hand."
          danger
          loading={remove.isPending}
          onConfirm={() => remove.mutate()}
          onClose={() => setRemoving(false)}
        />
      )}
    </Card>
  )
}
