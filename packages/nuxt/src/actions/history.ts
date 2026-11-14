import { z } from 'zod'
import type { ModelFileChange } from '../node/editor-io.ts'
import { HISTORY_CAP, readHistory, recordStep, redoStep, stepInfo, stepOf, undoStep } from '../node/history.ts'
import type { ReplayOutcome } from '../node/history.ts'
import { sha256 } from '../node/sync.ts'
import { ActionError, defineAction } from './define.ts'
import type { ActionContext, ActionDef } from './define.ts'

/**
 * Undo/redo (P3b) and the model version, as actions. Every action that
 * changes model files calls `changed` after writing them: one history step,
 * one `model` event.
 */

/**
 * Records `changes` (already written by `action` over the model files `before`) as one
 * history step and tells open editors. History is best effort: the edit is on disk, so a
 * history that can't be written (a cache symlinked away, a full disk) never fails it.
 */
export const changed = (ctx: ActionContext, action: string, before: Record<string, string>, changes: readonly ModelFileChange[]): void => {
  if (!changes.length) return
  try {
    recordStep(ctx.root, stepOf(action, before, changes))
  } catch {
    // Not undoable; the change itself stands.
  }
  ctx.events?.modelChanged(changes.map(({ path, content }) => ({ path, sha: content === null ? null : sha256(content) })), 'action')
}

const replayed = (ctx: ActionContext, outcome: ReplayOutcome, source: 'undo' | 'redo') => {
  if (!outcome.ok) {
    if (outcome.reason === 'invalid') throw new ActionError('invalid', outcome.message, outcome.problems)
    const code = ({ empty: 'not_found', conflict: 'conflict', refused: 'forbidden', unavailable: 'forbidden', disk: 'write_failed' } as const)[outcome.reason]
    throw new ActionError(code, outcome.message)
  }
  const { step } = outcome
  ctx.events?.modelChanged(step.changes.map((change) => {
    const content = source === 'undo' ? change.before : change.after
    return { path: change.path, sha: content === null ? null : sha256(content) }
  }), source)
  return stepInfo(step)
}

const historyGet = defineAction({
  name: 'history_get',
  description: `Read the undo and redo history of the model edits made through actions (hand edits on disk are not in it): each step's action, time and files, newest first (at most limit, default 50; the history keeps the last ${HISTORY_CAP}).`,
  input: z.object({ limit: z.number().int().min(1).max(HISTORY_CAP).optional() }),
  readOnly: true,
  run: ({ limit = 50 }, { root }) => {
    let stacks
    try {
      stacks = readHistory(root)
    } catch (error) {
      throw new ActionError('forbidden', (error as Error).message)
    }
    const newest = (steps: typeof stacks.undo) => steps.slice(-limit).reverse().map(stepInfo)
    return { undo: newest(stacks.undo), redo: newest(stacks.redo) }
  }
})

const historyUndo = defineAction({
  name: 'history_undo',
  description: 'Undo the last edit made through an action: its files are written back as they were (a created file is deleted). Refused (conflict) when one of them changed since, e.g. edited by hand, and when the model would no longer generate. Returns the undone step (action, time, files).',
  input: z.object({}),
  run: (_input, ctx) => replayed(ctx, undoStep(ctx.root), 'undo')
})

const historyRedo = defineAction({
  name: 'history_redo',
  description: 'Redo the last undone edit. A new edit empties the redo history. Refused (conflict) when one of its files changed since the undo, and when the model would no longer generate. Returns the redone step.',
  input: z.object({}),
  run: (_input, ctx) => replayed(ctx, redoStep(ctx.root), 'redo')
})

const modelVersionGet = defineAction({
  name: 'model_version_get',
  description: 'The model version of this nuxt dev process: a counter that moves up with every model change (actions, undo/redo, files edited on disk). Compare two reads to know whether to read the model again.',
  input: z.object({}),
  readOnly: true,
  run: (_input, { events }) => ({ version: events?.version ?? 0 })
})

export const HISTORY_ACTIONS: readonly ActionDef[] = [historyGet, historyUndo, historyRedo, modelVersionGet] as ActionDef[]
