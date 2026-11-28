import qrcode from 'qrcode-generator'

const BASE = import.meta.env.BASE_URL
const role = location.pathname.slice(`${BASE}app/`.length).split('/')[0]
const ACCOUNTS: Record<string, [string, string]> = {
  student: ['madina', 'demo-student'],
  support: ['kamila', 'demo-support'],
  admin: ['admin', 'demo-admin'],
}
const API = import.meta.env.VITE_SUPABASE_URL as string
const g = window as any
g.__basename = `${BASE}app/${role}`

const prefix = `opus-demo:${role}:`
const own = Storage.prototype
const { getItem, setItem, removeItem } = own
own.getItem = function (k) { return getItem.call(this, prefix + k) }
own.setItem = function (k, v) { setItem.call(this, prefix + k, v) }
own.removeItem = function (k) { removeItem.call(this, prefix + k) }
g.BroadcastChannel = class { onmessage = null; postMessage() {} close() {} addEventListener() {} removeEventListener() {} }
g.WebSocket = class extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  readyState = 0; binaryType = 'blob'; bufferedAmount = 0
  send() {}
  close() { this.readyState = 3 }
}

let seq = 0
const waiting = new Map<number, (m: any) => void>()
const ask = (message: Record<string, unknown>) =>
  new Promise<any>((resolve) => {
    const id = ++seq
    waiting.set(id, resolve)
    parent.postMessage({ demo: 'opus', role, id, ...message }, location.origin)
  })
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== parent || e.data?.demo !== 'opus') return
  if (e.data.changed) { g.__qc?.invalidateQueries(); return }
  waiting.get(e.data.id)?.(e.data)
  waiting.delete(e.data.id)
})

const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init)
  if (!req.url.startsWith(API)) return realFetch(input, init)
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.text()
  const reply = await ask({ req: { url: req.url, method: req.method, headers: Object.fromEntries(req.headers), body } })
  return new Response(reply.status === 204 ? null : reply.body, { status: reply.status, headers: { 'Content-Type': 'application/json' } })
}

if (navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 640
    const c = canvas.getContext('2d')!
    let text: string | null = null
    const poll = () => fetch(`${API}/__demo/qr`).then((r) => r.json()).then((r) => { text = r.qr }).catch(() => {})
    poll()
    const polling = setInterval(poll, 1500)
    const draw = () => {
      c.fillStyle = '#20242c'
      c.fillRect(0, 0, 640, 640)
      if (text) {
        const q = qrcode(0, 'M')
        q.addData(text)
        q.make()
        const n = q.getModuleCount()
        const s = Math.floor(440 / n)
        const o = (640 - n * s) / 2
        c.fillStyle = '#fff'
        c.fillRect(o - 30, o - 30, n * s + 60, n * s + 60)
        c.fillStyle = '#000'
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) c.fillRect(o + x * s, o + y * s, s, s)
      } else {
        c.fillStyle = '#fff'
        c.font = '600 30px sans-serif'
        c.textAlign = 'center'
        c.fillText('Demo camera', 320, 290)
        c.font = '24px sans-serif'
        c.fillText('Open the lesson code as the support teacher', 320, 340)
      }
    }
    draw()
    const drawing = setInterval(draw, 200)
    const stream = canvas.captureStream(10)
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track)
      track.stop = () => { clearInterval(polling); clearInterval(drawing); stop() }
    }
    return stream
  }
}

const start = async () => {
  if (parent === window || !ACCOUNTS[role]) {
    document.getElementById('root')!.textContent = 'Open this demo from the portfolio page.'
    return
  }
  const { boot } = await ask({ hello: true })
  if (localStorage.getItem('boot') !== boot) {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) removeItem.call(localStorage, key)
    localStorage.setItem('boot', boot)
    localStorage.setItem('opus-theme', 'light')
    const [login, password] = ACCOUNTS[role]
    const res = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: `${login}@opus.internal`, password }) })
    localStorage.setItem('sb-demo-auth-token', await res.text())
  }
  await import('../src/main')
  parent.postMessage({ demo: 'opus', role, shown: true }, location.origin)
}
start()
