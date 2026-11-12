import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MANIFEST_FILE, ManifestFileSchema, SCHEMA_URL, stringifyModelFile } from '@bildr/codegen/model'
import { GENERATOR_VERSION } from '@bildr/codegen/starter'
import { isSafeProjectPath, planSync } from '@bildr/codegen/sync'
import type { GeneratedFile, ManifestEntries, SyncPlan } from '@bildr/codegen/sync'
import { resolvesInside } from './project.ts'

/**
 * The fs side of the sync engine (decision D1). `planSync` decides; this file
 * applies the plan: writes and deletes first, the manifest last and atomically.
 * A run that fails partway is rolled back (files restored, new ones removed),
 * so disk matches the previous manifest again (S6). Without the rollback, the
 * next sync, which in nuxt dev follows the next model change, would take the
 * files that did land for hand edits and detach them.
 */

export const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

/** File operations, injectable so tests can make one fail. Paths are absolute. */
export interface SyncIo {
  writeFile: (path: string, content: string) => void
  remove: (path: string) => void
}

export const nodeIo: SyncIo = {
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  },
  remove: path => rmSync(path, { force: true })
}

/** The manifest's entries, or none for a project that was never synced. */
export const readManifest = (root: string): ManifestEntries => {
  const path = join(root, MANIFEST_FILE)
  if (!existsSync(path)) return {}
  return ManifestFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).files
}

/** sha256 of each path on disk; missing files are absent. */
export const hashFiles = (root: string, paths: Iterable<string>): Record<string, string> => {
  const hashes: Record<string, string> = {}
  for (const path of paths) {
    if (!isSafeProjectPath(path)) continue
    const target = join(root, path)
    if (existsSync(target)) hashes[path] = sha256(readFileSync(target))
  }
  return hashes
}

/** Writes `target` through a temporary file and a rename, so readers never see half a file; the temporary file never outlives a failure. */
export const writeAtomically = (target: string, content: string, io: SyncIo = nodeIo) => {
  const temporary = `${target}.tmp`
  try {
    io.writeFile(temporary, content)
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export const writeManifest = (root: string, files: ManifestEntries, io: SyncIo = nodeIo) => {
  writeAtomically(join(root, MANIFEST_FILE), stringifyModelFile({ $schema: `${SCHEMA_URL}/manifest.v1.json`, generatorVersion: GENERATOR_VERSION, files }), io)
}

/** Applies a sync plan to the project. Every path is checked before anything is touched; a failure rolls back what was done. */
export const applySync = (root: string, plan: SyncPlan, io: SyncIo = nodeIo) => {
  for (const path of [...plan.writes.map(write => write.path), ...plan.deletes]) {
    if (!isSafeProjectPath(path)) throw new Error(`Unsafe path: ${path}`)
    if (!resolvesInside(root, join(root, path))) throw new Error(`Unsafe path: ${path} (resolves outside the project)`)
  }
  // What each touched file held before (undefined: it didn't exist), newest last.
  const undo: Array<{ target: string, previous: Buffer | undefined }> = []
  const remember = (target: string) => undo.push({ target, previous: existsSync(target) ? readFileSync(target) : undefined })
  try {
    for (const write of plan.writes) {
      const target = join(root, write.path)
      remember(target)
      io.writeFile(target, write.content)
    }
    for (const path of plan.deletes) {
      const target = join(root, path)
      remember(target)
      io.remove(target)
    }
    writeManifest(root, plan.manifest, io)
  } catch (error) {
    rollBack(undo)
    throw error
  }
}

/** Best effort: restore every touched file, newest first; a file that can't be restored is left as is (the next sync detaches it). */
const rollBack = (undo: Array<{ target: string, previous: Buffer | undefined }>) => {
  for (const { target, previous } of [...undo].reverse()) {
    try {
      if (previous === undefined) rmSync(target, { force: true })
      else writeFileSync(target, previous)
    } catch {
      // Keep restoring the others.
    }
  }
}

/** Plans and applies one sync of `generated` onto the project. */
export const syncProject = (root: string, generated: GeneratedFile[], options: { reattach?: string[], io?: SyncIo } = {}): SyncPlan => {
  const manifest = readManifest(root)
  const plan = planSync({
    generated,
    manifest,
    disk: hashFiles(root, new Set([...generated.map(file => file.path), ...Object.keys(manifest)])),
    hash: sha256,
    ...(options.reattach ? { reattach: options.reattach } : {})
  })
  applySync(root, plan, options.io)
  return plan
}
