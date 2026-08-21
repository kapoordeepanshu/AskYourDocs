'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { ApiErrorBody } from '@/lib/api'

export interface AdminUser {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
  disabled: boolean
  documentCount: number
  createdAt: string
}

export function AdminUsers({ users, currentUserId }: { users: AdminUser[]; currentUserId: string }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function call(id: string, init: RequestInit) {
    setBusyId(id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/users/${id}`, init)
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null
        setError(body?.error.message ?? 'That change could not be applied.')
        return
      }
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const patch = (id: string, changes: Record<string, unknown>) =>
    call(id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    })

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-border bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Documents</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const busy = busyId === user.id
              const isSelf = user.id === currentUserId

              return (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{user.name || user.email}</div>
                    {user.name && <div className="text-xs text-muted">{user.email}</div>}
                  </td>

                  <td className="px-4 py-2.5">
                    <select
                      value={user.role}
                      disabled={busy}
                      onChange={(e) => patch(user.id, { role: e.target.value })}
                      className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                      aria-label={`Role for ${user.email}`}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>

                  <td className="px-4 py-2.5 text-muted">{user.documentCount}</td>

                  <td className="px-4 py-2.5">
                    {user.disabled ? (
                      <span className="text-danger">Disabled</span>
                    ) : (
                      <span className="text-success">Active</span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => patch(user.id, { disabled: !user.disabled })}
                      className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50"
                    >
                      {user.disabled ? 'Enable' : 'Disable'}
                    </button>

                    {!isSelf && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              `Delete ${user.email}? Their documents, conversations, and uploads are removed permanently.`,
                            )
                          ) {
                            void call(user.id, { method: 'DELETE' })
                          }
                        }}
                        className="ml-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
