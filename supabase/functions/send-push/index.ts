import { createClient } from 'npm:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.5'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const vapidKeys = await webpush.importVapidKeys(JSON.parse(Deno.env.get('VAPID_KEYS')!), {
  extractable: false,
})

const appServer = await webpush.ApplicationServer.new({
  contactInformation: Deno.env.get('VAPID_CONTACT')!,
  vapidKeys,
})

Deno.serve(async (req) => {
  if (req.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) {
    return new Response('Forbidden', { status: 403 })
  }

  const { notification_id: id } = await req.json()
  const { data: notification } = await supabase
    .from('notifications')
    .select('user_id, title, body, link')
    .eq('id', id)
    .maybeSingle()
  if (!notification) return new Response('Not found', { status: 404 })

  const { data: devices } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', notification.user_id)

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    link: notification.link,
  })

  await Promise.all((devices ?? []).map(async (device) => {
    const subscriber = appServer.subscribe({
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth },
    })
    try {
      await subscriber.pushTextMessage(payload, {})
    } catch (error) {
      const status = (error as { response?: Response }).response?.status
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', device.id)
      } else {
        console.error('Push failed', status, error)
      }
    }
  }))

  return new Response('ok')
})
