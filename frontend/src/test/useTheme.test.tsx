// @vitest-environment jsdom
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The system colour-scheme setting, which a test flips the way a person changes it in the OS. */
function systemScheme(dark: boolean) {
  const listeners = new Set<() => void>()
  let matches = dark
  const query = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_type: string, listener: () => void) => void listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => void listeners.delete(listener)),
  }
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(() => query) })
  return {
    listeners,
    set(next: boolean) {
      matches = next
      listeners.forEach((l) => l())
    },
  }
}

/** A fresh copy of the module: the theme is module state shared by every caller, so each test starts clean. */
async function load() {
  vi.resetModules()
  return import('../ui/useTheme')
}

const html = document.documentElement

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    html.className = ''
    html.style.colorScheme = ''
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('follows the system setting while nothing is chosen, as it changes, and stops listening on unmount', async () => {
    const os = systemScheme(true)
    const { useTheme } = await load()
    const { result, unmount } = renderHook(() => useTheme())
    expect(result.current).toMatchObject({ mode: 'system', resolved: 'dark' })
    expect(html).toHaveClass('dark')
    expect(html.style.colorScheme).toBe('dark')

    act(() => os.set(false))
    expect(result.current).toMatchObject({ mode: 'system', resolved: 'light' })
    expect(html).not.toHaveClass('dark')
    expect(html.style.colorScheme).toBe('light')

    unmount()
    expect(os.listeners.size).toBe(0)
  })

  it('keeps an explicit choice from storage over the system setting, and stores a new one', async () => {
    const os = systemScheme(false)
    localStorage.setItem('atlas-theme', 'dark')
    const { useTheme } = await load()
    const { result } = renderHook(() => useTheme())
    expect(result.current).toMatchObject({ mode: 'dark', resolved: 'dark' })
    expect(html).toHaveClass('dark')
    act(() => os.set(true))
    act(() => os.set(false))
    expect(result.current).toMatchObject({ mode: 'dark', resolved: 'dark' })
    expect(html).toHaveClass('dark')

    act(() => result.current.setMode('light'))
    expect(localStorage.getItem('atlas-theme')).toBe('light')
    expect(result.current).toMatchObject({ mode: 'light', resolved: 'light' })
    expect(html).not.toHaveClass('dark')
    // back to the system setting, which is light now
    act(() => result.current.setMode('system'))
    expect(result.current).toMatchObject({ mode: 'system', resolved: 'light' })
    expect(localStorage.getItem('atlas-theme')).toBe('system')
  })

  it('reads a value it does not know as the system setting', async () => {
    systemScheme(true)
    localStorage.setItem('atlas-theme', 'blue')
    const { useTheme, getThemeMode } = await load()
    const { result } = renderHook(() => useTheme())
    expect(result.current).toMatchObject({ mode: 'system', resolved: 'dark' })
    expect(getThemeMode()).toBe('system')
  })

  it('toggles to the explicit opposite of what is on screen, and every caller agrees', async () => {
    systemScheme(true)
    const { useTheme } = await load()
    const { ThemeToggle } = await import('../ui/ThemeToggle')
    function Header() {
      const { mode, cycle } = useTheme()
      return <ThemeToggle mode={mode} onCycle={cycle} />
    }
    const elsewhere = renderHook(() => useTheme())
    render(<Header />)
    const user = userEvent.setup()

    // the system is dark, so the toggle offers light, and choosing it is an explicit choice
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(localStorage.getItem('atlas-theme')).toBe('light')
    expect(elsewhere.result.current).toMatchObject({ mode: 'light', resolved: 'light' })
    expect(html).not.toHaveClass('dark')

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(localStorage.getItem('atlas-theme')).toBe('dark')
    expect(elsewhere.result.current).toMatchObject({ mode: 'dark', resolved: 'dark' })
    expect(html).toHaveClass('dark')
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument()
  })

  it('still applies a choice for the session when storage throws (private mode, quota, blocked site data)', async () => {
    systemScheme(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const { useTheme } = await load()
    const { result } = renderHook(() => useTheme())
    expect(result.current).toMatchObject({ mode: 'system', resolved: 'light' })

    act(() => result.current.cycle())
    expect(result.current).toMatchObject({ mode: 'dark', resolved: 'dark' })
    expect(html).toHaveClass('dark')
    expect(html.style.colorScheme).toBe('dark')
  })

  it('takes a browser without matchMedia for light', async () => {
    const { useTheme, resolveTheme, systemPrefersDark } = await load()
    expect(systemPrefersDark()).toBe(false)
    expect(resolveTheme('system')).toBe('light')
    const { result } = renderHook(() => useTheme())
    expect(result.current).toMatchObject({ mode: 'system', resolved: 'light' })
    expect(html).not.toHaveClass('dark')
  })

  it('renders system/light on the server, whatever the browser holds', async () => {
    systemScheme(true)
    localStorage.setItem('atlas-theme', 'dark')
    const { useTheme } = await load()
    function Probe() {
      const { mode, resolved } = useTheme()
      return <span>{`${mode}:${resolved}`}</span>
    }
    expect(renderToString(<Probe />)).toContain('system:light')
  })
})
