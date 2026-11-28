import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app/App'
import { AuthProvider } from './app/auth'
import { ConfigProvider } from './app/config'
import { ErrorBoundary } from './app/ErrorBoundary'
import { ToastProvider } from './app/toast'
import { UpdateBanner } from './app/UpdateBanner'
import { applyTheme, savedTheme } from './lib/theme'
import './app/errorReports'
import './lib/install'
import './index.css'

applyTheme(savedTheme())

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <AuthProvider>
            <ToastProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
              <UpdateBanner />
            </ToastProvider>
          </AuthProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
