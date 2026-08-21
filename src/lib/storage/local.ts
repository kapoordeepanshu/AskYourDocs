import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '@/lib/env'
import type { StorageDriver } from './index'

export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const
  private root: string

  constructor() {
    this.root = path.resolve(env().LOCAL_STORAGE_PATH)
  }

  /**
   * Resolves a key inside the storage root and refuses anything that escapes
   * it. Keys are generated internally, but this is the one place where a bug
   * elsewhere would turn into arbitrary file write, so it is checked here too.
   */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key)
    const prefix = this.root + path.sep
    if (target !== this.root && !target.startsWith(prefix)) {
      throw new Error(`Refusing to access a path outside the storage root: ${key}`)
    }
    return target
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, body)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key))
  }

  async delete(key: string): Promise<void> {
    // force:true so deleting an already-missing file is not an error; document
    // deletion should stay idempotent.
    await rm(this.resolve(key), { force: true })
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key))
      return true
    } catch {
      return false
    }
  }
}
