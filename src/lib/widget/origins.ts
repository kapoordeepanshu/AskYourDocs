/**
 * Origin allowlisting for embedded widgets.
 *
 * Pure functions with no environment access, so the matching rules can be
 * tested on their own. A browser always sends a truthful Origin header on a
 * cross-origin request, which is what makes this a real restriction on which
 * websites can host a widget. It does nothing against a script calling the API
 * directly; the rate limits are what bound that.
 */

const WILDCARD_PLACEHOLDER = 'wildcard-placeholder'

/**
 * Normalises user input into a comparable origin, or null if it is not one.
 * Accepts "example.com" and "https://example.com/some/path" alike, because
 * people paste whatever is in their address bar.
 */
export function normalizeOriginPattern(input: string): string | null {
  let value = input.trim().toLowerCase()
  if (!value) return null
  if (!/^https?:\/\//.test(value)) value = `https://${value}`

  // URL() rejects "*" in a hostname, so swap the wildcard out while parsing.
  const wildcard = value.includes('://*.')
  if (wildcard) value = value.replace('://*.', `://${WILDCARD_PLACEHOLDER}.`)

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null

  const origin = url.origin
  return wildcard ? origin.replace(`://${WILDCARD_PLACEHOLDER}.`, '://*.') : origin
}

/** True when `origin` matches `pattern`, an exact origin or a `*.` subdomain wildcard. */
export function matchOrigin(pattern: string, origin: string): boolean {
  const normalizedOrigin = origin.trim().toLowerCase()
  if (!pattern.includes('://*.')) return pattern === normalizedOrigin

  const [scheme, rest] = pattern.split('://*.')
  const prefix = `${scheme}://`
  if (!normalizedOrigin.startsWith(prefix)) return false

  // *.example.com matches shop.example.com and a.b.example.com, but not
  // example.com itself and not evil-example.com.
  const host = normalizedOrigin.slice(prefix.length)
  return host.endsWith(`.${rest}`)
}

/**
 * The app's own origin is always allowed so the owner can preview a widget
 * from the dashboard. An empty allowlist means any site may embed it.
 */
export function isOriginAllowed(
  allowed: string[],
  origin: string | null,
  appOrigin: string,
): boolean {
  if (origin && origin.toLowerCase() === appOrigin.toLowerCase()) return true
  if (allowed.length === 0) return true
  // With an allowlist set, a request with no Origin did not come from a
  // browser on one of those sites, so it does not qualify.
  if (!origin) return false
  return allowed.some((pattern) => matchOrigin(pattern, origin))
}
