import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Toast = { id: number; text: string; bad: boolean }

const ToastContext = createContext<(text: string, bad?: boolean) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const show = useCallback((text: string, bad = false) => {
    const id = nextId.current++
    setToasts((all) => [...all, { id, text, bad }])
    setTimeout(() => setToasts((all) => all.filter((toast) => toast.id !== id)), 4000)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
          <div className="contents" aria-live="polite">
            {toasts.filter((toast) => !toast.bad).map((toast) => (
              <div key={toast.id} className="max-w-sm rounded-lg bg-ink px-4 py-2.5 font-medium text-page shadow-lg">
                {toast.text}
              </div>
            ))}
          </div>
          <div className="contents" role="alert" aria-live="assertive">
            {toasts.filter((toast) => toast.bad).map((toast) => (
              <div key={toast.id} className="max-w-sm rounded-lg bg-bad px-4 py-2.5 font-medium text-white shadow-lg dark:text-black">
                {toast.text}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
