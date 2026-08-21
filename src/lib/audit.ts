import { db } from '@/lib/db'
import { auditLog } from '@/lib/db/schema'

/**
 * Actions worth a permanent record. Kept as a closed union so the admin console
 * can render a label for every action without a fallback branch.
 */
export type AuditAction =
  | 'user.register'
  | 'user.login'
  | 'user.login_failed'
  | 'user.logout'
  | 'user.role_changed'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.deleted'
  | 'document.uploaded'
  | 'document.url_ingested'
  | 'document.reindexed'
  | 'document.deleted'
  | 'conversation.deleted'

export interface AuditEntry {
  actorId?: string | null
  action: AuditAction
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

/**
 * Never throws. An audit write failing must not turn a successful login into a
 * 500 for the user; it is logged for the operator and the request continues.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? null,
      ipAddress: entry.ipAddress,
    })
  } catch (error) {
    console.error('[audit] failed to record', entry.action, error)
  }
}
