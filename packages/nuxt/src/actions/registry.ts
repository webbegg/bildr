import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { hasDatabase } from '@bildr/codegen/generate'
import { MANIFEST_FILE, fileKind, loadModel } from '@bildr/codegen/model'
import type { DataSourceFile } from '@bildr/codegen/model'
import { CHECK_NAMES, readHealth } from '../node/health.ts'
import type { CheckName } from '../node/health.ts'
import { codeView, deleteModelFile, isDeletableModelPath, isModelFilePath, matchesBase, pendingMigration, saveModelFile } from '../node/editor-io.ts'
import { readModelFiles } from '../node/project.ts'
import { ActionError, defineAction } from './define.ts'
import type { ActionDef } from './define.ts'
import { DATA_ACTIONS } from './data.ts'
import { EDIT_ACTIONS } from './editing.ts'
import { EDITOR_ACTIONS } from './editor.ts'
import { HISTORY_ACTIONS, changed, historyReady } from './history.ts'

/**
 * The editor's operations (T10 action contract). The editor UI calls them
 * over HTTP (`/__bildr/api/actions/:name`), agents as MCP tools
 * (`/__bildr/mcp`); both go through `createActions`.
 */

const modelPath = z.string().min(1).describe('A .bildr/ model file, relative to the project root, e.g. ".bildr/modules/main/pages/index.json"')

/** Each model file as its parsed JSON, and the text of the ones that don't parse (`invalid`, which the problems name too). */
const readableFiles = (files: Record<string, string>): { parsed: Record<string, unknown>, invalid: Record<string, string> } => {
  const parsed: Record<string, unknown> = {}
  const invalid: Record<string, string> = {}
  for (const [path, text] of Object.entries(files)) {
    if (!isModelFilePath(path)) continue
    try {
      parsed[path] = JSON.parse(text) as unknown
    } catch {
      invalid[path] = text
    }
  }
  return { parsed, invalid }
}

/**
 * Whether the project has an app database (V7): a sqlite data source file. Read from the
 * files, so it holds while the rest of the model has problems.
 */
const databaseOf = (parsed: Record<string, unknown>) => hasDatabase({
  datasources: Object.entries(parsed).filter(([path]) => path.startsWith('.bildr/datasources/')).map(([, file]) => file as DataSourceFile)
})

const modelGet = defineAction({
  name: 'model_get',
  description: 'Read the project\'s .bildr/ model: the validated model and every model file as JSON, or the problems that keep it from loading (the files are returned too, so they can be fixed). A file that is not valid JSON is not in `files`: `invalid` has its text by path. `database` says whether the project has an app database (a sqlite data source); without one there are no migrations.',
  input: z.object({}),
  readOnly: true,
  run: (_input, { root }) => {
    const files = readModelFiles(root)
    const result = loadModel(files)
    const { parsed, invalid } = readableFiles(files)
    const database = databaseOf(parsed)
    return result.ok ? { ok: true, model: result.model, files: parsed, invalid, database } : { ok: false, problems: result.problems, files: parsed, invalid, database }
  }
})

const modelFilePut = defineAction({
  name: 'model_file_put',
  description: 'Create or replace one .bildr/ model file with the given JSON, in canonical form; the app regenerates from it. A valid model must stay valid. A model that already has problems takes a file that has none of its own and adds none to another file; the problems that remain are returned as `problems`. `base` is the file the edit started from (its JSON, its text when it was not valid JSON, null when it did not exist): the write is refused as a conflict when the file is not that any more.',
  input: z.object({
    path: modelPath,
    content: z.record(z.string(), z.unknown()).describe('The file\'s JSON object'),
    base: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).optional().describe('The file as it was read: its JSON, its text when it was not valid JSON, or null when it did not exist. Omit it to replace the file whatever it holds')
  }),
  run: ({ path, content, base }, ctx) => {
    const { root } = ctx
    if (!isModelFilePath(path)) throw new ActionError('forbidden', 'Only .bildr/ model files can be written (not the manifest, the cache or project files)')
    historyReady(ctx)
    const before = readModelFiles(root)
    if (base !== undefined && !matchesBase(before[path], base)) throw new ActionError('conflict', `${path} changed since it was opened, so it was not saved`)
    const saved = saveModelFile(root, path, JSON.stringify(content))
    if (saved.ok) {
      const after = readFileSync(join(root, path), 'utf8')
      if (before[path] !== after) changed(ctx, 'model_file_put', before, [{ path, content: after }])
      return { sha256: saved.sha256, ...(saved.problems ? { problems: saved.problems } : {}) }
    }
    if (saved.reason === 'invalid') throw new ActionError('invalid', `The model would have problems, ${path} was not saved`, saved.problems)
    throw new ActionError(saved.reason === 'json' ? 'invalid_input' : 'forbidden', saved.message)
  }
})

const modelFileDelete = defineAction({
  name: 'model_file_delete',
  description: 'Delete one artifact file of the model (a data source, a layout, or an entity, repository, query, action, state, component, page or fixtures file of a module). Never bildr.json, theme.json, the manifest or a module.json. Refused when it would add a problem to the rest of the model (a model with problems already may lose a broken file; the problems that remain are returned as `problems`).',
  input: z.object({ path: modelPath }),
  run: ({ path }, ctx) => {
    const { root } = ctx
    if (!isDeletableModelPath(path)) throw new ActionError('forbidden', 'Only artifact files of the model can be deleted (not bildr.json, theme.json, the manifest, a module.json or files outside the model)')
    historyReady(ctx)
    const before = readModelFiles(root)
    const deleted = deleteModelFile(root, path)
    if (deleted.ok) {
      changed(ctx, 'model_file_delete', before, [{ path, content: null }])
      return deleted.problems ? { problems: deleted.problems } : {}
    }
    if (deleted.reason === 'invalid') throw new ActionError('invalid', `The rest of the model would have problems, ${path} was not deleted`, deleted.problems)
    throw new ActionError(deleted.reason === 'missing' ? 'not_found' : 'forbidden', deleted.message)
  }
})

const codeViewAction = defineAction({
  name: 'code_view',
  description: 'Show the code generated from one .bildr/ model file: each generated file with its state (managed, detached, deleted, orphaned, pending…), its content on disk and, for files edited by hand, the diff from what bildr generates.',
  input: z.object({ path: modelPath }),
  readOnly: true,
  run: ({ path }, { root }) => {
    if (path === MANIFEST_FILE || !fileKind(path)) throw new ActionError('invalid_input', `${path} is not a .bildr/ model file`)
    if (!(path in readModelFiles(root))) throw new ActionError('not_found', `${path} doesn't exist`)
    return { files: codeView(root, path) }
  }
})

const healthGet = defineAction({
  name: 'health_get',
  description: 'Read the Health report: drift of the generated files (with diffs), the pending migration, whether the model loads, and the last result of each check (lint with architecture boundaries, types, tests, build).',
  input: z.object({}),
  readOnly: true,
  run: (_input, { root }) => readHealth(root)
})

const healthRun = defineAction({
  name: 'health_run',
  description: `Run Health checks now and return their results (they are also stored in the Health report). Checks: ${CHECK_NAMES.join(', ')}. types and build take seconds to minutes.`,
  input: z.object({
    checks: z.array(z.enum(CHECK_NAMES as readonly [CheckName, ...CheckName[]])).min(1)
      .refine(checks => new Set(checks).size === checks.length, 'Ask for each check once')
  }),
  run: async ({ checks }, { runHealth }) => {
    if (!runHealth) throw new ActionError('unavailable', 'Health checks can\'t run here: the bildr module gave no check runner')
    return { results: await runHealth(checks) }
  }
})

const migrationPendingGet = defineAction({
  name: 'migration_pending_get',
  description: 'Read the database migration that would lose data and waits for confirmation (what it drops, its statements and its hash), or null when there is none. `database` is false when the project has no app database (no sqlite data source): then nothing is ever pending.',
  input: z.object({}),
  readOnly: true,
  run: (_input, { root }) => {
    const database = databaseOf(readableFiles(readModelFiles(root)).parsed)
    return { pending: database ? pendingMigration(root) : null, database }
  }
})

const migrationConfirm = defineAction({
  name: 'migration_confirm',
  description: 'Confirm the pending destructive migration by its hash: bildr writes and applies it. A stale hash (the plan changed since it was read) leaves it pending.',
  input: z.object({ hash: z.string().min(1).describe('The `hash` of the pending migration') }),
  run: async ({ hash }, { confirmMigration }) => {
    if (!confirmMigration) throw new ActionError('unavailable', 'Migrations can\'t be confirmed here: the bildr module gave no regenerator')
    return { migration: await confirmMigration(hash) }
  }
})

export const ACTIONS: readonly ActionDef[] = [
  modelGet,
  modelFilePut,
  modelFileDelete,
  codeViewAction,
  healthGet,
  healthRun,
  migrationPendingGet,
  migrationConfirm,
  // The visual editor's operations (P3a): nodes, pages, components, instances, layouts, theme, project.
  // …and the data ones (P3c): data sources, entities, fields; previews and env status.
  ...EDIT_ACTIONS,
  ...DATA_ACTIONS,
  ...EDITOR_ACTIONS,
  // Undo/redo and the model version (P3b).
  ...HISTORY_ACTIONS
] as ActionDef[]
