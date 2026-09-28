'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
})

export function useTheme() {
  return useContext(ThemeCtx)
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    // Read on mount (not via useState's lazy initializer) deliberately:
    // localStorage isn't available during server rendering, so reading it
    // eagerly would cause a hydration mismatch between server and client.
    const saved = localStorage.getItem('theme') as Theme
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setTheme(saved)
  }, [])

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark')
    if (theme === 'light') document.documentElement.classList.add('light')
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <ThemeCtx.Provider value={{ theme, toggle: () => setTheme(t => t === 'dark' ? 'light' : 'dark') }}>
      {children}
    </ThemeCtx.Provider>
  )
}