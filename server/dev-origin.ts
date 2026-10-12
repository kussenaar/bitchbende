/** Vite may pick another port when 5173 is occupied. Never used in production. */
export function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.origin === origin && url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      (!url.port || (Number(url.port) >= 1 && Number(url.port) <= 65535))
  } catch { return false }
}
