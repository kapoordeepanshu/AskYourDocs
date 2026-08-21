import { lookup } from 'node:dns/promises'
import net from 'node:net'

import { env } from '@/lib/env'

/**
 * Server-side fetching of a user-supplied URL is a request originating inside
 * your network. Without guards it reaches cloud metadata endpoints, internal
 * admin panels, and databases bound to localhost.
 *
 * Defence here is layered:
 *   1. scheme allowlist        - no file:, gopher:, data:
 *   2. DNS resolution + IP check on every hop
 *   3. manual redirect handling, so hop 2 cannot skip the check
 *   4. hard byte cap enforced while streaming, not from Content-Length
 *   5. wall-clock timeout
 *
 * Residual risk: DNS rebinding between our check and the socket connect. Fully
 * closing that needs a custom agent that pins the validated IP. Documented
 * rather than silently ignored; the byte cap and timeout bound the blast radius.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

const MAX_REDIRECTS = 5

/** Content types worth trying to extract text from. */
const ACCEPTED_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'text/markdown',
  'application/pdf',
]

export interface FetchedResource {
  /** URL after redirects, used as the canonical source. */
  url: string
  contentType: string
  body: Buffer
}

function ipv4ToBytes(ip: string): number[] {
  return ip.split('.').map((part) => Number(part))
}

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ipv4ToBytes(ip)
  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, includes 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // TEST-NET-2
  if (a === 203 && b === 0) return true // TEST-NET-3
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]

  if (lower === '::1' || lower === '::') return true

  // IPv4-mapped (::ffff:10.0.0.1) and NAT64 wrappers must be unwrapped, or a
  // private v4 address slips through disguised as v6.
  const mapped = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])

  const head = lower.split(':')[0]
  const first = parseInt(head || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (lower.startsWith('2001:db8')) return true // documentation range

  return false
}

export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  return true // unparseable is not trusted
}

/** Throws UnsafeUrlError unless every address the host resolves to is public. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('That does not look like a valid URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs can be imported.')
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs containing credentials are not accepted.')
  }

  if (env().ALLOW_PRIVATE_NETWORK_FETCH) return url

  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  // A literal IP needs no DNS round trip.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new UnsafeUrlError('That address is on a private network and cannot be imported.')
    }
    return url
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${hostname}.`)
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Could not resolve ${hostname}.`)
  }

  // Every address, not just the first: a host with one public and one private
  // A record must not be reachable by retrying.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeUrlError(
        `${hostname} resolves to a private network address and cannot be imported.`,
      )
    }
  }

  return url
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  // Content-Length is a hint from an untrusted server, so enforce the cap while
  // reading rather than trusting the header.
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)

  const parts: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new UnsafeUrlError(
        `That page is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`,
      )
    }
    parts.push(value)
  }

  return Buffer.concat(parts)
}

export async function fetchSafely(raw: string): Promise<FetchedResource> {
  const config = env()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.URL_FETCH_TIMEOUT_MS)

  try {
    let current = raw

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertSafeUrl(current)

      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Identify honestly; some sites serve a different page to unknown agents.
          'user-agent': 'AskYourDocs/0.1 (+https://github.com/kapoordeepanshu/AskYourDocs)',
          accept: ACCEPTED_TYPES.join(', ') + ', */*;q=0.5',
          'accept-language': 'en',
        },
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new UnsafeUrlError('The server sent a redirect without a target.')
        // Re-enter the loop so the new host is validated too. Following
        // redirects automatically is the classic way SSRF guards get bypassed.
        current = new URL(location, url).toString()
        continue
      }

      if (!response.ok) {
        throw new UnsafeUrlError(
          `The page could not be fetched (HTTP ${response.status} ${response.statusText}).`,
        )
      }

      const contentType = (response.headers.get('content-type') ?? 'text/html')
        .split(';')[0]
        .trim()
        .toLowerCase()

      if (!ACCEPTED_TYPES.includes(contentType)) {
        throw new UnsafeUrlError(
          `That URL returned ${contentType}, which cannot be imported. Supported: HTML, plain text, Markdown, PDF.`,
        )
      }

      const body = await readCapped(response, config.URL_FETCH_MAX_BYTES)
      if (body.length === 0) throw new UnsafeUrlError('That page returned no content.')

      return { url: url.toString(), contentType, body }
    }

    throw new UnsafeUrlError('Too many redirects.')
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error
    if (controller.signal.aborted) {
      throw new UnsafeUrlError(
        `The page took longer than ${Math.round(config.URL_FETCH_TIMEOUT_MS / 1000)} seconds to respond.`,
      )
    }
    throw new UnsafeUrlError(
      error instanceof Error ? `Could not fetch that URL: ${error.message}` : 'Could not fetch that URL.',
    )
  } finally {
    clearTimeout(timer)
  }
}
