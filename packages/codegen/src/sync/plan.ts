import type { ManifestFile } from '../model/schemas'

/**
 * The sync engine's decisions, without side effects (decision D1: detect and
 * detach). Given what the generator produced, the manifest from the last
 * sync and the hashes on disk, it says what to write, what to delete and the
 * next manifest. An adapter applies the writes and deletes, then writes the
 * manifest last.
 */

export interface GeneratedFile {
  /** Project-relative, `/`-separated. Never inside `.bildr/`. */
  path: string
  content: string
  /** `managed`: regenerated while untouched. `scaffold`: written once if absent, then the user's. */
  owner: 'managed' | 'scaffold'
  /** The model file it comes from, for the editor's file ↔ model map. */
  source?: string
}

export type ManifestEntries = ManifestFile['files']

export interface SyncInput {
  generated: GeneratedFile[]
  manifest: ManifestEntries
  /** sha256 of each file currently on disk, for every path in `generated` or `manifest`. Missing = not on disk. */
  disk: Record<string, string | undefined>
  hash: (content: string) => string
  /** Paths the user asked to reattach: overwrite them with the generated version. */
  reattach?: string[]
}

export interface SyncReport {
  written: string[]
  unchanged: string[]
  detached: string[]
  deleted: string[]
  orphaned: string[]
  removed: string[]
  /** Manifest or reattach paths outside the project or inside `.bildr/`: ignored, never written or deleted. */
  refused: string[]
}

export interface SyncPlan {
  writes: Array<{ path: string, content: string }>
  deletes: string[]
  manifest: ManifestEntries
  report: SyncReport
}

/**
 * Refuses paths that would escape the project or touch the model. The manifest
 * is committed with the project, so its paths are untrusted too.
 */
export const isSafeProjectPath = (path: string): boolean => {
  const parts = path.split('/')
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.includes('\0')
    && !parts.some(part => part === '..' || part === '.' || part === '' || part.includes(':'))
    // Case-insensitive filesystems (macOS, Windows) treat .BILDR as .bildr.
    && parts[0]!.toLowerCase() !== '.bildr'
}

/** Code-unit order: the same on every machine, whatever the locale. */
const byCodeUnit = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export const planSync = ({ generated, manifest, disk, hash, reattach = [] }: SyncInput): SyncPlan => {
  const writes: SyncPlan['writes'] = []
  const deletes: string[] = []
  const next: ManifestEntries = {}
  const report: SyncReport = { written: [], unchanged: [], detached: [], deleted: [], orphaned: [], removed: [], refused: [] }
  const refused = new Set([...Object.keys(manifest), ...reattach].filter(path => !isSafeProjectPath(path)))
  report.refused = [...refused].sort(byCodeUnit)
  const reattaching = new Set(reattach.filter(path => !refused.has(path)))
  const seen = new Set<string>()

  for (const file of [...generated].sort((a, b) => byCodeUnit(a.path, b.path))) {
    if (!isSafeProjectPath(file.path)) throw new Error(`Unsafe path: ${file.path}`)
    if (seen.has(file.path)) throw new Error(`Generated twice: ${file.path}`)
    seen.add(file.path)

    const previous = manifest[file.path]
    const onDisk = disk[file.path]
    const sha256 = hash(file.content)
    const record = (owner: ManifestEntries[string]['owner'], recorded = sha256) => {
      next[file.path] = { owner, sha256: recorded, ...(file.source ? { source: file.source } : {}) }
    }
    const write = () => {
      writes.push({ path: file.path, content: file.content })
      report.written.push(file.path)
      record(file.owner)
    }

    if (file.owner === 'scaffold') {
      if (previous) next[file.path] = previous
      else if (onDisk === undefined) write()
      continue
    }

    if (reattaching.has(file.path)) {
      write()
      continue
    }
    // Already holds exactly what bildr would write: managed, whatever the manifest says.
    if (onDisk === sha256) {
      record('managed')
      report.unchanged.push(file.path)
      continue
    }
    const state = previous?.owner
    if (onDisk === undefined) {
      // The user removed a file bildr wrote (touched or not): keep it gone. New and orphaned files are (re)written.
      if (state === 'managed' || state === 'detached' || state === 'deleted') {
        record('deleted')
        report.deleted.push(file.path)
      } else {
        write()
      }
      continue
    }
    // On disk with other content: overwrite only what bildr wrote and nobody touched since.
    if (state === 'managed' && onDisk === previous!.sha256) write()
    else {
      record('detached')
      report.detached.push(file.path)
    }
  }

  for (const path of Object.keys(manifest).sort(byCodeUnit)) {
    if (seen.has(path) || refused.has(path)) continue
    const previous = manifest[path]!
    const onDisk = disk[path]
    if (previous.owner === 'scaffold') next[path] = previous
    else if (onDisk === undefined || previous.owner === 'deleted') continue
    else if (previous.owner === 'managed' && onDisk === previous.sha256) {
      deletes.push(path)
      report.removed.push(path)
    } else {
      next[path] = { ...previous, owner: 'orphaned' }
      report.orphaned.push(path)
    }
  }

  const manifestOut = Object.fromEntries(Object.keys(next).sort(byCodeUnit).map(path => [path, next[path]!]))
  return { writes, deletes, manifest: manifestOut, report }
}
