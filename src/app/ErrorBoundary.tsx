import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '../components/ui'
import { noteCrash } from '../lib/errorReport'
import { isLoadFailure, reloadOnce } from '../lib/loadFailure'

const reloadPage = () => location.reload()

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isLoadFailure(error) && navigator.onLine) reloadOnce(sessionStorage, Date.now(), reloadPage)
    noteCrash(error, { componentStack: info.componentStack?.slice(0, 3000) })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorState onRetry={reloadPage} />
      </main>
    )
  }
}
