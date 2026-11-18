import type { FileState } from '../types.ts'

/** What each state of a generated file (`FileState`, `codegen/sync/drift.ts`) is called on the Checks and Code screens: who owns the file now, in plain words. */
const LABELS: Record<string, string> = {
  managed: 'Generated',
  scaffold: 'Starter file',
  detached: 'Edited by hand',
  deleted: 'Deleted',
  orphaned: 'No longer generated',
  pending: 'Not written yet'
}

/** A state in plain words; one this does not know says itself. */
export const stateLabel = (state: FileState): string => Object.hasOwn(LABELS, state) ? LABELS[state]! : state
