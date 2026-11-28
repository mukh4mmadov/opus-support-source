import { createReadStream, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const FACE_MODELS = ['blazeface', 'facemesh', 'faceres', 'antispoof', 'liveness']
  .flatMap((name) => [`${name}.json`, `${name}.bin`])
const FACE_MODEL_DIR = join('node_modules', '@vladmandic', 'human', 'models')

function faceModels(): Plugin {
  return {
    name: 'face-models',
    configureServer(server) {
      server.middlewares.use('/models/human/', (req, res, next) => {
        const file = (req.url ?? '').slice(1).split('?')[0]
        if (!FACE_MODELS.includes(file)) return next()
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream')
        createReadStream(join(FACE_MODEL_DIR, file)).pipe(res)
      })
    },
    generateBundle() {
      for (const file of FACE_MODELS) {
        this.emitFile({ type: 'asset', fileName: `models/human/${file}`, source: readFileSync(join(FACE_MODEL_DIR, file)) })
      }
    },
  }
}

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(
      `${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'} ${new Date().toISOString().slice(0, 16)}`,
    ),
  },
  plugins: [
    react(),
    tailwindcss(),
    faceModels(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/human.esm-*.js'],
      },
      manifest: {
        name: 'OPUS Support',
        short_name: 'OPUS',
        description: 'Book a support lesson at OPUS Learning Center',
        theme_color: '#294a41',
        background_color: '#294a41',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
