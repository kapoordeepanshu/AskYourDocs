import bcrypt from 'bcryptjs'

/**
 * 12 rounds is roughly 250ms on modest hardware in 2026 — slow enough to make
 * offline cracking expensive, fast enough that a self-hoster on a small VPS
 * does not notice it on login.
 */
const ROUNDS = 12

/** Long enough to matter, short enough that bcrypt's 72-byte truncation is explicit. */
export const MIN_PASSWORD_LENGTH = 10
const MAX_PASSWORD_LENGTH = 72

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  // bcrypt silently ignores bytes past 72, which would make a long password
  // weaker than it looks. Reject rather than truncate.
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} bytes.`
  }
  return null
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Burns roughly the same time as a real verification. Called when the email is
 * unknown so that response timing does not reveal which accounts exist.
 */
export async function fakeVerify(): Promise<void> {
  await bcrypt.compare(
    'timing-equalisation',
    '$2a$12$C6UzMDM.H6dfI/f/IKcEe.e8N2Q3xLQZ8vRhZ0z5mJ0vXlLZ8YQ0q',
  )
}
