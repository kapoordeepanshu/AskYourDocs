import { desc, eq } from 'drizzle-orm'
import type { Metadata } from 'next'

import { DocumentsView, type DocumentSummary } from '@/components/documents-view'
import { requirePageUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { documents } from '@/lib/db/schema'
import { env } from '@/lib/env'

export const metadata: Metadata = { title: 'Documents' }
export const dynamic = 'force-dynamic'

export default async function DocumentsPage() {
  const user = await requirePageUser('/documents')

  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.ownerId, user.id))
    .orderBy(desc(documents.createdAt))
    .limit(500)

  // Dates are serialised for the client component; everything else maps across.
  const initial: DocumentSummary[] = rows.map((doc) => ({
    id: doc.id,
    title: doc.title,
    sourceType: doc.sourceType,
    sourceUrl: doc.sourceUrl,
    filename: doc.filename,
    byteSize: doc.byteSize,
    status: doc.status,
    error: doc.error,
    pageCount: doc.pageCount,
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt.toISOString(),
  }))

  return <DocumentsView initialDocuments={initial} maxUploadMb={env().MAX_UPLOAD_MB} />
}
