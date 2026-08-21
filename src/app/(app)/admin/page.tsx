import { desc, eq, sql } from 'drizzle-orm'
import type { Metadata } from 'next'

import { AdminUsers, type AdminUser } from '@/components/admin-users'
import { requirePageAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { auditLog, documents, jobs, users } from '@/lib/db/schema'
import { env } from '@/lib/env'

export const metadata: Metadata = { title: 'Admin' }
export const dynamic = 'force-dynamic'

const ACTION_LABEL: Record<string, string> = {
  'user.register': 'registered',
  'user.login': 'signed in',
  'user.login_failed': 'failed sign-in',
  'user.logout': 'signed out',
  'user.role_changed': 'changed a role',
  'user.disabled': 'disabled an account',
  'user.enabled': 'enabled an account',
  'user.deleted': 'deleted an account',
  'document.uploaded': 'uploaded a document',
  'document.url_ingested': 'imported a URL',
  'document.reindexed': 're-indexed a document',
  'document.deleted': 'deleted a document',
  'conversation.deleted': 'deleted a conversation',
}

export default async function AdminPage() {
  const admin = await requirePageAdmin()

  const [userRows, auditRows, failedJobs] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        disabledAt: users.disabledAt,
        createdAt: users.createdAt,
        documentCount: sql<number>`(
          select count(*)::int from ${documents} where ${documents.ownerId} = ${users.id}
        )`,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(200),

    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorEmail: users.email,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .orderBy(desc(auditLog.createdAt))
      .limit(50),

    db
      .select({
        id: jobs.id,
        type: jobs.type,
        lastError: jobs.lastError,
        attempts: jobs.attempts,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(eq(jobs.status, 'failed'))
      .orderBy(desc(jobs.finishedAt))
      .limit(20),
  ])

  const adminUsers: AdminUser[] = userRows.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabledAt !== null,
    documentCount: user.documentCount,
    createdAt: user.createdAt.toISOString(),
  }))

  const config = env()

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted">
          {adminUsers.length} account{adminUsers.length === 1 ? '' : 's'} on this instance.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Users</h2>
        <AdminUsers users={adminUsers} currentUserId={admin.id} />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Configuration</h2>
        <dl className="card divide-y divide-border text-sm">
          {[
            ['Chat model', `${config.LLM_PROVIDER} · ${modelFor(config)}`],
            ['Embeddings', `${config.EMBEDDING_PROVIDER} · ${config.EMBEDDING_DIMENSIONS} dimensions`],
            ['Storage', config.STORAGE_DRIVER],
            ['Reranking', config.RERANK_ENABLED ? 'on' : 'off'],
            ['Refusal threshold', String(config.RETRIEVAL_MIN_SCORE)],
            ['Public registration', config.ALLOW_PUBLIC_REGISTRATION ? 'open' : 'closed'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between px-4 py-2.5">
              <dt className="text-muted">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {/* Keys are never rendered, only which provider is selected. */}
      </section>

      {failedJobs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">Failed jobs</h2>
          <ul className="card divide-y divide-border text-sm">
            {failedJobs.map((job) => (
              <li key={job.id} className="px-4 py-2.5">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{job.type}</span>
                  <span className="text-xs text-muted">
                    {job.attempts} attempt{job.attempts === 1 ? '' : 's'}
                  </span>
                </div>
                {job.lastError && (
                  <p className="mt-1 text-xs text-danger">{job.lastError}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
        <ul className="card divide-y divide-border text-sm">
          {auditRows.length === 0 && (
            <li className="px-4 py-3 text-muted">Nothing recorded yet.</li>
          )}
          {auditRows.map((entry) => (
            <li key={entry.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
              <span>
                <span className="font-medium">{entry.actorEmail ?? 'Someone'}</span>{' '}
                <span className="text-muted">
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </span>
              </span>
              <time
                dateTime={entry.createdAt.toISOString()}
                className="text-xs text-muted"
              >
                {entry.createdAt.toISOString().replace('T', ' ').slice(0, 16)}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function modelFor(config: ReturnType<typeof env>): string {
  if (config.LLM_PROVIDER === 'anthropic') return config.ANTHROPIC_MODEL
  if (config.LLM_PROVIDER === 'openai') return config.OPENAI_MODEL
  return config.OLLAMA_MODEL
}
