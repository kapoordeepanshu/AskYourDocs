import { describe, expect, it } from 'vitest'

import { UnsafeUrlError, assertSafeUrl, isBlockedAddress } from '@/lib/ingest/fetch-safe'

/**
 * The SSRF guard is the highest-severity surface in this project: it decides
 * whether a user-supplied string can make the server talk to its own network.
 * Every range here is one an attacker actually reaches for.
 */
describe('isBlockedAddress', () => {
  it.each([
    ['169.254.169.254', 'cloud instance metadata'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'RFC1918 /8'],
    ['172.16.0.1', 'RFC1918 /12 lower bound'],
    ['172.31.255.254', 'RFC1918 /12 upper bound'],
    ['192.168.1.1', 'RFC1918 /16'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([
    ['::1', 'IPv6 loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fc00::1', 'unique local'],
    ['fd12:3456::1', 'unique local'],
    ['ff02::1', 'multicast'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata address'],
    ['::ffff:10.0.0.1', 'IPv4-mapped RFC1918'],
    ['64:ff9b::127.0.0.1', 'NAT64-wrapped loopback'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true)
  })

  it.each([['8.8.8.8'], ['1.1.1.1'], ['172.32.0.1'], ['2606:4700::1111']])(
    'allows public address %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false)
    },
  )

  it('treats an unparseable value as blocked', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
    expect(isBlockedAddress('')).toBe(true)
  })

  it('does not confuse 172.15 or 172.32 with the private /12', () => {
    expect(isBlockedAddress('172.15.0.1')).toBe(false)
    expect(isBlockedAddress('172.32.0.1')).toBe(false)
  })
})

describe('assertSafeUrl', () => {
  it.each([
    'file:///etc/passwd',
    'gopher://example.com',
    'data:text/html,hello',
    'ftp://example.com/x',
  ])('rejects the %s scheme', async (url) => {
    await expect(assertSafeUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('rejects URLs carrying credentials', async () => {
    await expect(assertSafeUrl('http://user:pass@example.com')).rejects.toThrow(/credentials/i)
  })

  it('rejects a literal private address without a DNS lookup', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private network/i,
    )
    await expect(assertSafeUrl('http://[::1]:8080/admin')).rejects.toThrow(/private network/i)
  })

  it('rejects a malformed URL', async () => {
    await expect(assertSafeUrl('not a url')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('allows a literal public address', async () => {
    const url = await assertSafeUrl('https://8.8.8.8/robots.txt')
    expect(url.hostname).toBe('8.8.8.8')
  })
})
