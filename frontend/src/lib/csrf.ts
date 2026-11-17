/** Lee una cookie por nombre desde un string `document.cookie` (función pura para pruebas). */
export function readCookie(cookieString: string, name: string): string | null {
  if (!cookieString) return null
  for (const part of cookieString.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    if (key === name) {
      const raw = part.slice(idx + 1).trim()
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
  }
  return null
}

/** Token CSRF de Django (cookie `csrftoken`). */
export function getCsrfToken(cookieString: string = typeof document !== 'undefined' ? document.cookie : ''): string | null {
  return readCookie(cookieString, 'csrftoken')
}
