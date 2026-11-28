export type Theme = 'system' | 'light' | 'dark'

const KEY = 'opus-theme'

export const savedTheme = () => (localStorage.getItem(KEY) as Theme | null) ?? 'system'

export function applyTheme(theme: Theme) {
  const dark = theme === 'dark'
    || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function saveTheme(theme: Theme) {
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}
