/**
 * An attacker-supplied `?next=` must never become an off-site redirect, so only
 * same-origin absolute paths are allowed through. Protocol-relative URLs
 * ("//evil.example") look like paths but are not, hence the second check.
 */
export function safeNext(value: string | undefined, fallback = '/documents'): string {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  return value
}
