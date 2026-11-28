const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)
const keys = {
  publicKey: await crypto.subtle.exportKey('jwk', publicKey),
  privateKey: await crypto.subtle.exportKey('jwk', privateKey),
}
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
console.log('Supabase secret VAPID_KEYS:')
console.log(JSON.stringify(keys))
console.log('\nVercel variable VITE_VAPID_PUBLIC_KEY:')
console.log(Buffer.from(raw).toString('base64url'))
