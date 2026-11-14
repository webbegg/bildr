import { z } from 'zod'
import type { ModelFileChange } from '../node/editor-io.ts'
import type { ModelChangeSource } from '../node/events.ts'
import { HISTORY_CAP, HistoryUnavailable, readHistory, recordChange, redoStep, stepInfo, stepOf, undoStep } from '../node/history.ts'
import type { ReplayOutcome, Unkept } from '../node/history.ts'
import { readModelFiles } from '../node/project.ts'
import { sha256 } from '../node/sync.ts'
import { ActionError, defineAction } from './define.ts'
import type { ActionContext, ActionDef } from './define.ts'

/**
 * Undo/redo (P3b) and the model version, as actions. Every action that
 * changes model files calls `changed` after writing them: one history step,
 * one `model` event.
 */

/**
 * Every accepted model change is undoable: refuses (forbidden), before an action writes
 * anything, when the history can't be read or written here (a cache symlinked away, a
 * history file that is a folder or unreadable).
 */
export const historyReady = (ctx: ActionContext): void => {
  try {
    readHistory(ctx.root)
  } catch (error) {
    if (error instanceof HistoryUnavailable) throw new ActionError('forbidden', `${error.message}: the change couldn't be undone, nothing was written`)
    throw error
  }
}

/**
 * A history write that failed after the model write: `write_failed`. When the model files
 * couldn't be put back either, open editors are told what is on disk now, to resync.
 */
const unkept = (ctx: ActionContext, failure: Unkept, source: ModelChangeSource): never => {
  if (failure.unsettled?.length) {
    const files = readModelFiles(ctx.root)
    ctx.events?.modelChanged(failure.unsettled.map(path => ({ path, sha: Object.hasOwn(files, path) ? sha256(files[path]!) : null })), source)
  }
  throw new ActionError('write_failed', failure.message)
}

/**
 * Records `changes` (already written by `action` over the model files `before`) as one
 * history step and tells open editors. When the step can't be recorded the files are put
 * back and the action fails with `write_failed`: no change is kept that can't be undone.
 */
export const changed = (ctx: ActionContext, action: string, before: Record<string, string>, changes: readonly ModelFileChange[]): void => {
  if (!changes.length) return
  const kept = recordChange(ctx.root, stepOf(action, before, changes))
  if (!kept.ok) unkept(ctx, kept, 'action')
  ctx.events?.modelChanged(changes.map(({ path, content }) => ({ path, sha: content === null ? null : sha256(content) })), 'action')
}

const replayed = (ctx: ActionContext, outcome: ReplayOutcome, source: 'undo' | 'redo') => {
  if (!outcome.ok) {
    if (outcome.reason === 'invalid') throw new ActionError('invalid', outcome.message, outcome.problems)
    if (outcome.reason === 'disk') unkept(ctx, outcome, source)
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
