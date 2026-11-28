import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { rpc } from '../lib/api'
import { DEFAULT_STRINGS } from '../lib/strings'

export interface PublicConfig {
  settings: {
    center_name: string
    logo_data_url: string
    primary_color: string
    accent_color: string
    center_phone: string
    center_address: string
  }
  strings: Record<string, string>
}

const FALLBACK: PublicConfig = {
  settings: {
    center_name: 'OPUS Learning Center',
    logo_data_url: '',
    primary_color: '#294a41',
    accent_color: '#39aa00',
    center_phone: '',
    center_address: '',
  },
  strings: {},
}

const ConfigContext = createContext<PublicConfig>(FALLBACK)

function readableOn(hex: string) {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? '#ffffff' : '#111111'
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ['public-config'],
    queryFn: () => rpc<PublicConfig>('get_public_config'),
    staleTime: 60_000,
  })
  const config = data ?? FALLBACK

  useEffect(() => {
    const { primary_color: color, accent_color: accent, center_name: name } = config.settings
    document.documentElement.style.setProperty('--brand', color)
    document.documentElement.style.setProperty('--accent', accent)
    document.documentElement.style.setProperty('--brand-fg', readableOn(color))
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
    document.title = name
  }, [config.settings])

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
}

export const useConfig = () => useContext(ConfigContext)

export function useText() {
  const { strings } = useConfig()
  return useCallback((key: string, vars?: Record<string, string | number>) => {
    let text: string = strings[key] ?? DEFAULT_STRINGS[key as keyof typeof DEFAULT_STRINGS] ?? key
    for (const [name, value] of Object.entries(vars ?? {})) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }, [strings])
}

export function useErrorText() {
  const t = useText()
  return useMemo(() => (error: unknown) => {
    const code = error instanceof Error ? error.message : ''
    const key = `error.${code}`
    return key in DEFAULT_STRINGS ? t(key) : t('common.error')
  }, [t])
}
