import { env } from '@/lib/env'

/**
 * Original files are kept so a document can be re-indexed after a chunking or
 * embedding change without asking the user to upload it again.
 */
export interface StorageDriver {
  readonly name: 'local' | 's3'
  put(key: string, body: Buffer, contentType?: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

/**
 * Keys are always `<ownerId>/<documentId>/<slug>`. Owner-first means a
 * misbehaving key cannot reach another user's prefix even if the rest is wrong.
 */
export function storageKey(ownerId: string, documentId: string, filename: string): string {
  const safe = filename
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120)
  return `${ownerId}/${documentId}/${safe || 'file'}`
}

let driver: StorageDriver | undefined

export async function getStorage(): Promise<StorageDriver> {
  if (!driver) {
    if (env().STORAGE_DRIVER === 's3') {
      // Imported lazily so a local-disk deployment never loads the AWS SDK.
      const { S3Storage } = await import('./s3')
      driver = new S3Storage()
    } else {
      const { LocalStorage } = await import('./local')
      driver = new LocalStorage()
    }
  }
  return driver
}

export function resetStorage() {
  driver = undefined
}
