import type { GeneratedFile, ManifestEntries } from './plan.ts'

/**
 * Drift for the Health report (T9, RA §7): which files no longer match what
 * bildr generates, and how. Pure: the caller reads the disk and hashes.
 */

export type DriftState
  /** Edited by hand: kept, no longer overwritten. */
  = | 'detached'
  /** A generated file removed from disk: not recreated until reattached. */
    | 'deleted'
  /** No longer generated, kept because it was edited. */
    | 'orphaned'
  /** Generated but not written yet (the next sync writes it). */
    | 'pending'

export interface DriftFile {
  path: string
  state: DriftState
  /** For detached files: generated version → disk, unified format. */
  diff?: string
}

export interface DriftReport {
  files: DriftFile[]
  /** No manifest: the project was never synced by bildr. */
  missingManifest: boolean
}

export interface DriftInput {
  generated: GeneratedFile[]
  manifest: ManifestEntries
  /** Content on disk of every generated and manifest path; undefined = missing. */
  disk: Record<string, string | undefined>
  hash: (content: string) => string
}

export const driftReport = ({ generated, manifest, disk, hash }: DriftInput): DriftReport => {
  const missingManifest = Object.keys(manifest).length === 0
  const managed = new Map(generated.filter(file => file.owner === 'managed').map(file => [file.path, file]))
  const scaffold = new Set(generated.filter(file => file.owner === 'scaffold').map(file => file.path))
  const files: DriftFile[] = []
  for (const path of [...new Set([...managed.keys(), ...Object.keys(manifest)])].sort()) {
    const entry = manifest[path]
    const file = managed.get(path)
    const onDisk = disk[path]
    if (scaffold.has(path) || entry?.owner === 'scaffold') continue
    if (!file) {
      // Not generated any more: only what the next sync keeps is drift.
      if (onDisk !== undefined && (entry?.owner === 'orphaned' || entry?.owner === 'detached')) files.push({ path, state: 'orphaned' })
      continue
    }
    if (!entry) {
      if (!missingManifest) files.push({ path, state: 'pending' })
      continue
    }
    if (onDisk === undefined) files.push({ path, state: 'deleted' })
    else if (hash(onDisk) !== hash(file.content)) files.push({ path, state: 'detached', diff: unifiedDiff(file.content, onDisk, path) })
  }
  return { files, missingManifest }
}

// ── Line diff ─────────────────────────────────────────────────────────

const CONTEXT = 3
/** Beyond this many line pairs (after the common prefix and suffix) a diff isn't computed. */
const MAX_CELLS = 2_000_000
const NO_NEWLINE = '\\ No newline at end of file'

interface Line { text: string, last: boolean }
const linesOf = (text: string): { lines: Line[], endsWithNewline: boolean } => {
  if (text === '') return { lines: [], endsWithNewline: true }
  const endsWithNewline = text.endsWith('\n')
  const parts = (endsWithNewline ? text.slice(0, -1) : text).split('\n')
  return { lines: parts.map((part, index) => ({ text: part, last: index === parts.length - 1 })), endsWithNewline }
}

type Op = { kind: ' ' | '-' | '+', text: string, noNewline: boolean, a: number, b: number }

/** `before` (generated) → `after` (on disk) as a unified diff with 3 lines of context; '' when equal. */
export const unifiedDiff = (before: string, after: string, path: string): string => {
  if (before === after) return ''
  const header = `--- ${path} (generated)\n+++ ${path} (on disk)\n`
  const a = linesOf(before)
  const b = linesOf(after)
  // The last line without a newline differs from the same text with one.
  const key = (line: Line, endsWithNewline: boolean) => line.last && !endsWithNewline ? `${line.text}\0` : line.text
  const ka = a.lines.map(line => key(line, a.endsWithNewline))
  const kb = b.lines.map(line => key(line, b.endsWithNewline))

  let prefix = 0
  while (prefix < ka.length && prefix < kb.length && ka[prefix] === kb[prefix]) prefix++
  let suffix = 0
  while (suffix < ka.length - prefix && suffix < kb.length - prefix && ka[ka.length - 1 - suffix] === kb[kb.length - 1 - suffix]) suffix++
  const n = ka.length - prefix - suffix
  const m = kb.length - prefix - suffix
  if (n * m > MAX_CELLS) return `${header}(too large to show a line diff)\n`

  // Longest common subsequence over the middle, then walk it into an edit script.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = ka[prefix + i] === kb[prefix + j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const ops: Op[] = []
  const push = (kind: Op['kind'], ai: number, bi: number) => {
    const line = kind === '+' ? b.lines[bi]! : a.lines[ai]!
    const ends = kind === '+' ? b.endsWithNewline : a.endsWithNewline
    ops.push({ kind, text: line.text, noNewline: line.last && !ends, a: ai, b: bi })
  }
  for (let i = 0; i < prefix; i++) push(' ', i, i)
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && ka[prefix + i] === kb[prefix + j]) {
      push(' ', prefix + i++, prefix + j++)
    } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      // Removals before additions, as diff and git show them.
      push('-', prefix + i++, prefix + j)
    } else {
      push('+', prefix + i, prefix + j++)
    }
  }
  for (let k = 0; k < suffix; k++) push(' ', ka.length - suffix + k, kb.length - suffix + k)

  // Hunks: changes with CONTEXT lines around them, merged when their contexts touch.
  const changed = ops.flatMap((op, index) => op.kind === ' ' ? [] : [index])
  const hunks: Array<[number, number]> = []
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT)
    const end = Math.min(ops.length - 1, index + CONTEXT)
    const previous = hunks.at(-1)
    if (previous && start <= previous[1] + 1) previous[1] = end
    else hunks.push([start, end])
  }
  const range = (start: number, count: number) => count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`
  const body = hunks.map(([start, end]) => {
    const slice = ops.slice(start, end + 1)
    const aCount = slice.filter(op => op.kind !== '+').length
    const bCount = slice.filter(op => op.kind !== '-').length
    const lines = slice.map(op => `${op.kind}${op.text}\n${op.noNewline ? `${NO_NEWLINE}\n` : ''}`)
    return `@@ -${range(slice[0]!.a + 1, aCount)} +${range(slice[0]!.b + 1, bCount)} @@\n${lines.join('')}`
  })
  return header + body.join('')
}
