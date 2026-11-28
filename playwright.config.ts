import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    ...devices['Pixel 7'],
    channel: 'chrome',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/local-backend.mjs --memory',
      url: 'http://localhost:54399/rest/v1/rpc/none',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      env: { PORT: '54399' },
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      env: { VITE_SUPABASE_URL: 'http://localhost:54399', VITE_VAPID_PUBLIC_KEY: 'test-key', VITE_FAKE_FACE: '1' },
    },
  ],
})
