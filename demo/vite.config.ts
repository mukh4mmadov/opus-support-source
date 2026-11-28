import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BASE = '/demo/opus/'
process.env.VITE_SUPABASE_URL = 'https://demo.invalid'
process.env.VITE_SUPABASE_ANON_KEY = 'demo'
process.env.VITE_FAKE_FACE = '1'

const swap = (code: string, from: string | RegExp, to: string, where: string) => {
  const next = code.replace(from as string, to)
  if (next === code) throw new Error(`demo build: "${from}" not found in ${where}`)
  return next
}

function demoSite(): Plugin {
  const stubs: Record<string, string> = {
    'virtual:pwa-register': 'export const registerSW = () => async () => {}',
    '@vladmandic/human': 'export class Human {}; export default Human',
  }
  return {
    name: 'demo-site',
    enforce: 'pre',
    resolveId: (id) => (stubs[id] ? `\0demo:${id}` : null),
    load: (id) => (id.startsWith('\0demo:') ? stubs[id.slice(6)] : null),
    transform(code, id) {
      const file = id.replace(/\\/g, '/').split('?')[0]
      if (!file.includes('/src/')) return null
      if (file.endsWith('/src/main.tsx')) {
        code = swap(code, '<BrowserRouter>', '<BrowserRouter basename={(window as any).__basename}>', file)
        code = swap(code, 'const queryClient = new QueryClient(', 'const queryClient = (window as any).__qc = new QueryClient(', file)
      }
      if (file.endsWith('/src/app/auth.tsx')) {
        code = swap(code, "location.assign('/')", "location.assign((window as any).__basename + '/')", file)
        code = swap(code, "location.assign(error ? '/' : '/admin')", "location.assign((window as any).__basename + (error ? '/' : '/admin'))", file)
      }
      return code.replace(/(["'])\/(logo|icon-192)\.png\1/g, `$1${BASE}$2.png$1`)
    },
  }
}

export default defineConfig({
  root: join(import.meta.dirname, '..'),
  base: BASE,
  cacheDir: join(import.meta.dirname, '.vite'),
  define: { __APP_BUILD__: JSON.stringify('demo') },
  plugins: [demoSite(), react(), tailwindcss()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  build: {
    outDir: process.env.DEMO_OUT ?? 'demo-dist',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      input: { app: join(import.meta.dirname, 'app.html'), engine: join(import.meta.dirname, 'engine.ts') },
      output: { entryFileNames: (c: { name: string }) => (c.name === 'engine' ? 'engine.js' : 'assets/[name]-[hash].js') },
    },
  },
})
