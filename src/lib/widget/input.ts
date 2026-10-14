import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/lib/db'
import { documents } from '@/lib/db/schema'
import { normalizeOriginPattern } from './origins'

/** Shared by create and update, so both validate a widget the same way. */
export const widgetInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the widget a name.').max(80),
  title: z.string().trim().min(1, 'Add a title for the chat header.').max(80),
  greeting: z.string().trim().min(1, 'Add a greeting.').max(500),
  fallbackMessage: z
    .string()
    .trim()
    .min(1, 'Add what the widget should say when it does not know.')
    .max(500),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #2563eb.'),
  allowedOrigins: z
    .array(z.string())
    .max(20, 'At most 20 websites.')
    .transform((values, ctx) => {
      const out: string[] = []
      for (const value of values) {
        if (!value.trim()) continue
        const origin = normalizeOriginPattern(value)
        if (!origin) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${value}" is not a website address.` })
          return z.NEVER
        }
        if (!out.includes(origin)) out.push(origin)
      }
      return out
    }),
  /** Null answers from every document, including ones uploaded later. */
  documentIds: z.array(z.string().uuid()).max(500).nullable(),
  enabled: z.boolean().default(true),
})

export type WidgetInput = z.infer<typeof widgetInputSchema>

/**
 * Drops any id that is not one of the owner's documents. Retrieval filters on
 * owner as well, so a foreign id could never leak anything, but it should not
 * be stored as though it were in scope either.
 */
export async function ownedDocumentIds(
  ownerId: string,
  ids: string[] | null,
): Promise<string[] | null> {
  if (ids === null) return null
  if (ids.length === 0) return []

  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.ownerId, ownerId), inArray(documents.id, ids)))
  return rows.map((row) => row.id)
}
