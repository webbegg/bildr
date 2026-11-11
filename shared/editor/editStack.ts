/**
 * The editor's navigation stack, Framer's breadcrumb: the page is the base,
 * and each component or layout opened on top of it is a level
 * (`Home › Card › Button`). Editing a nested instance's component pushes a
 * level; opening one from Assets or ⌘K replaces the stack. Esc with nothing
 * selected and Done go up one level, a crumb goes to its level. Each level
 * remembers the selection of the level under it when it opened (`back`), so
 * going up selects the instance it was opened from again.
 */

export type EditKind = 'component' | 'layout'

export interface EditLevel {
  kind: EditKind
  id: string
  /** The selection of the level under this one when it opened; going back restores it. */
  back: string[]
}

export interface LevelMove {
  stack: EditLevel[]
  /** The selection to restore, or null when nothing changed. */
  restore: string[] | null
}

export function topLevel(stack: readonly EditLevel[]): EditLevel | null {
  return stack.at(-1) ?? null
}

/**
 * Opens a component or layout. `nested` (an instance inside the tree being
 * edited) pushes it; otherwise it replaces the stack, keeping the page
 * selection to go back to. A level already on the stack is gone back to.
 */
export function openLevel(stack: EditLevel[], level: { kind: EditKind, id: string }, back: string[], { nested = false }: { nested?: boolean } = {}): EditLevel[] {
  const at = stack.findIndex(l => l.kind === level.kind && l.id === level.id)
  if (at === stack.length - 1 && at >= 0) return stack
  if (at >= 0) return stack.slice(0, at + 1)
  const entry = { kind: level.kind, id: level.id }
  if (nested) return [...stack, { ...entry, back }]
  return [{ ...entry, back: stack.length ? stack[0]!.back : back }]
}

/** Esc with nothing selected, and Done: up one level, restoring the selection it was opened from. */
export function leaveLevel(stack: EditLevel[]): LevelMove {
  const top = topLevel(stack)
  return top ? { stack: stack.slice(0, -1), restore: top.back } : { stack, restore: null }
}

/** A breadcrumb click: keeps the levels up to `index` (-1 is the page). */
export function goToLevel(stack: EditLevel[], index: number): LevelMove {
  if (index >= stack.length - 1) return { stack, restore: null }
  const keep = Math.max(-1, index)
  return { stack: stack.slice(0, keep + 1), restore: stack[keep + 1]!.back }
}

/** The stack without a level that no longer `exists` (deleted here or elsewhere) and the levels opened from it. */
export function pruneLevels(stack: EditLevel[], exists: (level: EditLevel) => boolean): EditLevel[] {
  const gone = stack.findIndex(level => !exists(level))
  return gone < 0 ? stack : stack.slice(0, gone)
}

export interface Crumb {
  kind: 'page' | EditKind
  label: string
  /** The `goToLevel` index: -1 for the page. */
  index: number
}

/** The breadcrumb: the page, then each level by name. */
export function levelTrail(pageName: string, stack: readonly EditLevel[], nameOf: (id: string) => string | undefined): Crumb[] {
  return [
    { kind: 'page', label: pageName, index: -1 },
    ...stack.map((level, index) => ({ kind: level.kind, label: nameOf(level.id) ?? 'Missing', index }))
  ]
}
