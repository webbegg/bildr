import type { ApiAction, ApiField, ApiModel, ApiParam, ApiQuery } from '@bildr/codegen/model'
import type { ApiSource } from '@bildr/codegen/edit'
import { pathParamNames } from '../shared/simpleApi.ts'
import { plainCopy, sameJson } from './draftJson.ts'

/**
 * The drafts of the simple Data section's API forms (simple data, S4, S6): the API's settings, a query or an action, and a model.
 * Each is held as a draft until Save (`useDraftForm`), judged against its base by what it would write (`…Output`), so a draft that says
 * what the model says has no edits whatever the order its rows were made in. Saving is one module action per form (`api_update`,
 * `api_query_set`, `api_action_set`, `api_model_set`); the module checks the rest and says what it refuses.
 */

// ── Settings ─────────────────────────────────────────────────────────────

export type SignIn = 'none' | 'bearer' | 'header'
export type Runtime = ApiSource['runtime']

export interface SettingsDraft {
  name: string
  baseUrl: string
  runtime: Runtime
  signIn: SignIn
  header: string
}

export const settingsOf = (source: ApiSource): SettingsDraft => ({
  name: source.name,
  baseUrl: source.baseUrl,
  runtime: source.runtime,
  signIn: source.auth?.type ?? 'none',
  header: source.auth?.header ?? ''
})

export const settingsDirty = (draft: SettingsDraft, base: ApiSource): boolean => !sameJson(draft, settingsOf(base))
export const settingsChangedOutside = (base: ApiSource, stored: ApiSource): boolean => !sameJson(settingsOf(base), settingsOf(stored))

/** The draft that keeps what the user touched over a changed API: the settings they did not touch show the stored ones. */
export function settingsRebase(draft: SettingsDraft, base: ApiSource, stored: ApiSource): SettingsDraft {
  const was = settingsOf(base)
  const now = settingsOf(stored)
  const keep = <K extends keyof SettingsDraft>(key: K): SettingsDraft[K] => sameJson(draft[key], was[key]) ? now[key] : draft[key]
  return { name: keep('name'), baseUrl: keep('baseUrl'), runtime: keep('runtime'), signIn: keep('signIn'), header: keep('header') }
}

/** What saving the settings asks of `api_update` besides the API's id: only what changed; null when nothing did. */
export function settingsInput(draft: SettingsDraft, base: ApiSource): Record<string, unknown> | null {
  const was = settingsOf(base)
  const input: Record<string, unknown> = {}
  if (draft.name.trim() !== was.name) input.name = draft.name.trim()
  if (draft.baseUrl.trim() !== was.baseUrl) input.baseUrl = draft.baseUrl.trim()
  if (draft.runtime !== was.runtime) input.runtime = draft.runtime
  if (draft.signIn !== was.signIn || (draft.signIn === 'header' && draft.header.trim() !== was.header)) {
    input.auth = draft.signIn === 'none' ? null : { type: draft.signIn, ...(draft.signIn === 'header' ? { header: draft.header.trim() } : {}) }
  }
  return Object.keys(input).length ? input : null
}

/** What stops the settings from being saved, before the module is asked. */
export function settingsProblems(draft: SettingsDraft): string[] {
  const problems: string[] = []
  if (!draft.name.trim()) problems.push('Give the API a name')
  if (!draft.baseUrl.trim()) problems.push('Give the base URL')
  if (draft.signIn === 'header' && !draft.header.trim()) problems.push('Give the header name, like “X-Api-Key”')
  return problems
}

// ── Queries and actions ──────────────────────────────────────────────────

export type ParamType = ApiParam['type']
export type Method = ApiAction['method']

export interface ParamDraft {
  /** Tells a row from another while it is edited. */
  key: string
  name: string
  type: ParamType
  required: boolean
  /** The key the API calls it, when it isn't its name. */
  remote: string
}

export interface ResultDraft {
  model: string
  many: boolean
  itemsPath: string
}

/** A query or an action as the form holds it. The path parameters follow the path (`pathTypes`), the query parameters are rows. */
export interface OperationDraft {
  kind: 'query' | 'action'
  /** Of an action; a query is a GET. */
  method: Method
  path: string
  /** The type of each path parameter the path has had, by name. */
  pathTypes: Record<string, ParamType>
  /** The query parameters. */
  params: ParamDraft[]
  /** What it answers. An action may answer nothing (null). */
  result: ResultDraft | null
  /** The model of an action's body, or ''. */
  body: string
}

let rows = 0
export const newParam = (): ParamDraft => ({ key: `p_${++rows}`, name: '', type: 'text', required: false, remote: '' })

const resultDraftOf = (result: ApiQuery['result'] | undefined): ResultDraft | null => result ? { model: result.model, many: result.many, itemsPath: result.itemsPath ?? '' } : null

/** The draft of a saved query or action, or the empty draft of a new one (`stored` null). */
export function operationDraftOf(kind: 'query' | 'action', stored: ApiQuery | ApiAction | null): OperationDraft {
  const params = stored?.params ?? []
  return {
    kind,
    method: stored && 'method' in stored ? stored.method : 'POST',
    path: stored?.path ?? '/',
    pathTypes: Object.fromEntries(params.filter(param => param.in === 'path').map(param => [param.name, param.type])),
    params: params.filter(param => param.in === 'query').map(param => ({ key: `p_${++rows}`, name: param.name, type: param.type, required: param.required ?? false, remote: param.key ?? '' })),
    result: stored ? resultDraftOf(stored.result) : kind === 'query' ? { model: '', many: false, itemsPath: '' } : null,
    body: stored && 'body' in stored ? stored.body?.model ?? '' : ''
  }
}

/** The path parameters of the draft's path, then its query parameters: what the module is sent. */
export function paramsOutput(draft: OperationDraft): ApiParam[] {
  return [
    ...pathParamNames(draft.path).map((name): ApiParam => ({ name, in: 'path', type: draft.pathTypes[name] ?? 'text' })),
    ...draft.params.filter(param => param.name.trim()).map((param): ApiParam => ({
      name: param.name.trim(),
      in: 'query',
      type: param.type,
      ...(param.required ? { required: true } : {}),
      ...(param.remote.trim() ? { key: param.remote.trim() } : {})
    }))
  ]
}

const resultOutput = (result: ResultDraft | null): ApiQuery['result'] | undefined => result?.model
  ? { model: result.model, many: result.many, ...(result.many && result.itemsPath.trim() ? { itemsPath: result.itemsPath.trim() } : {}) }
  : undefined

/** The query the draft is, named `name`. */
export const queryOutput = (name: string, draft: OperationDraft): ApiQuery => ({
  name,
  path: draft.path.trim(),
  params: paramsOutput(draft),
  result: resultOutput(draft.result) ?? { model: '', many: false }
})

/** The action the draft is, named `name`. */
export const actionOutput = (name: string, draft: OperationDraft): ApiAction => {
  const result = resultOutput(draft.result)
  return {
    name,
    method: draft.method,
    path: draft.path.trim(),
    params: paramsOutput(draft),
    ...(draft.body ? { body: { model: draft.body } } : {}),
    ...(result ? { result } : {})
  }
}

const outputOf = (draft: OperationDraft) => draft.kind === 'query' ? queryOutput('', draft) : actionOutput('', draft)

export const operationDirty = (draft: OperationDraft, base: ApiQuery | ApiAction | null): boolean => !sameJson(outputOf(draft), outputOf(operationDraftOf(draft.kind, base)))
/** A rename is not a change of what the form holds: the form follows the item by its name (it is `name` of the editor), so names are left out. */
const unnamed = <T extends { name: string } | null>(item: T): T => item ? { ...item, name: '' } : item

export const operationChangedOutside = (base: ApiQuery | ApiAction | null, stored: ApiQuery | ApiAction | null): boolean => !sameJson(unnamed(base), unnamed(stored))

/** "Keep my edits": the user's draft stays as it is, and replaces the new version when it is saved. */
export const operationRebase = (draft: OperationDraft): OperationDraft => draft

/** What stops a query or an action from being saved, before the module is asked. */
export function operationProblems(draft: OperationDraft): string[] {
  const problems: string[] = []
  if (!draft.path.trim().startsWith('/')) problems.push('The path starts with “/”, like “/products/:id”')
  if (draft.kind === 'query' && !draft.result?.model) problems.push('Choose what the answer looks like: pick a model, or use “Try it” to find one')
  if (draft.params.some(param => !param.name.trim())) problems.push('Give every parameter a name, or remove it')
  return problems
}

/** The value of each parameter `values` holds, as `api_try` takes it (by the key the API calls it); parameters left empty are not sent. */
export function tryParams(draft: OperationDraft, values: Record<string, string | boolean>): Record<string, string | number | boolean> {
  const sent: Record<string, string | number | boolean> = {}
  for (const param of paramsOutput(draft)) {
    const value = values[param.name]
    if (value === undefined || value === '') continue
    const key = param.in === 'path' ? param.name : param.key ?? param.name
    sent[key] = param.type === 'boolean' ? value === true || value === 'true' : param.type === 'integer' || param.type === 'number' ? Number(value) : String(value)
  }
  return sent
}

// ── Models ───────────────────────────────────────────────────────────────

export interface FieldDraft {
  key: string
  name: string
  type: ApiField['type']
  /** For a field of type model: the model of its value. */
  model: string
  list: boolean
  optional: boolean
  nullable: boolean
  remote: string
}

export interface ModelDraft {
  fields: FieldDraft[]
}

export const newField = (): FieldDraft => ({ key: `f_${++rows}`, name: '', type: 'text', model: '', list: false, optional: false, nullable: false, remote: '' })

/** The draft of a saved model, or the one of a new model (`stored` null): one empty field to start with. */
export const modelDraftOf = (stored: ApiModel | null): ModelDraft => ({
  fields: stored
    ? stored.fields.map(field => ({ key: `f_${++rows}`, name: field.name, type: field.type, model: field.model ?? '', list: field.list ?? false, optional: field.optional ?? false, nullable: field.nullable ?? false, remote: field.key ?? '' }))
    : [newField()]
})

/** The model the draft is, named `name`. */
export const modelOutput = (name: string, draft: ModelDraft): ApiModel => ({
  name,
  fields: draft.fields.filter(field => field.name.trim()).map((field): ApiField => ({
    name: field.name.trim(),
    type: field.type,
    ...(field.type === 'model' && field.model ? { model: field.model } : {}),
    ...(field.list ? { list: true } : {}),
    ...(field.optional ? { optional: true } : {}),
    ...(field.nullable ? { nullable: true } : {}),
    ...(field.remote.trim() ? { key: field.remote.trim() } : {})
  }))
})

export const modelDirty = (draft: ModelDraft, base: ApiModel | null): boolean => !sameJson(modelOutput('', draft), modelOutput('', modelDraftOf(base)))
export const modelChangedOutside = (base: ApiModel | null, stored: ApiModel | null): boolean => !sameJson(unnamed(base), unnamed(stored))

export function modelProblems(draft: ModelDraft): string[] {
  const problems: string[] = []
  if (!draft.fields.some(field => field.name.trim())) problems.push('A model needs at least one field')
  if (draft.fields.some(field => field.type === 'model' && !field.model)) problems.push('Choose the model of each field that holds another model')
  return problems
}

export function moveField(draft: ModelDraft, from: number, to: number): FieldDraft[] {
  const fields = [...draft.fields]
  const [moved] = fields.splice(from, 1)
  if (moved) fields.splice(to, 0, moved)
  return fields
}

// ── Using an answer ──────────────────────────────────────────────────────

/** What using a proposed set of models does to the API's own, before anything is sent. */
export interface ProposalPlan {
  /** The models to send with `api_model_set`, in order (nested ones first, the root last), under the names they will have. */
  models: ApiModel[]
  /** The name the root model has once they are set. */
  root: string
}

export type Resolution = { how: 'replace' } | { how: 'rename', name: string }

const renamesOf = (choices: Record<string, Resolution>) =>
  new Map(Object.entries(choices).flatMap(([from, choice]) => choice.how === 'rename' && choice.name ? [[from, choice.name] as const] : []))

/** The proposed models as they would be sent under the user's renames: under their new names, and every field that names a renamed one follows. */
function renamedProposal(proposed: ApiModel[], choices: Record<string, Resolution>): ApiModel[] {
  const renamed = renamesOf(choices)
  return plainCopy(proposed).map((model) => {
    for (const field of model.fields) if (field.model && renamed.has(field.model)) field.model = renamed.get(field.model)
    return { ...model, name: renamed.get(model.name) ?? model.name }
  })
}

/**
 * The proposed models whose name an existing model has, and that say something else (the same model needs nothing). `choices` are what the
 * user chose before (a first try that stopped half way): a model that is there under the new name they gave it, saying what it says, is done,
 * and so is one whose fields name it.
 */
export const clashesOf = (proposed: ApiModel[], existing: ApiModel[], choices: Record<string, Resolution> = {}): string[] =>
  renamedProposal(proposed, choices).flatMap((model, at) => existing.some(entry => entry.name === model.name && !sameJson(entry.fields, model.fields)) ? [proposed[at]!.name] : [])

/**
 * Why the names the user gave to clashing models can't be taken (Pascal-cased already): one is empty, or is the name of a proposed model, of
 * another new name, or of an existing model that says something else. An existing model that says what the renamed one says is the one
 * already set by an earlier try: that name is fine. Nothing when they can.
 */
export function renameProblem(proposed: ApiModel[], existing: ApiModel[], choices: Record<string, Resolution>): string {
  const renamed = renamedProposal(proposed, choices)
  const given = new Set<string>()
  for (const [at, model] of proposed.entries()) {
    const choice = choices[model.name]
    if (choice?.how !== 'rename') continue
    if (!choice.name) return `Give the new name of “${model.name}”`
    const there = existing.find(entry => entry.name === choice.name)
    const done = !!there && sameJson(there.fields, renamed[at]!.fields)
    if ((there && !done) || proposed.some(other => other.name === choice.name) || given.has(choice.name)) return `“${choice.name}” is taken too: pick another name`
    given.add(choice.name)
  }
  return ''
}

/**
 * The models to send for a proposal, under the user's choices for the models that clash: a model that says what an existing one says is
 * left alone, a replaced one is sent under its name, a renamed one under its new name, and every field that names it follows.
 */
export function planProposal(proposed: ApiModel[], existing: ApiModel[], choices: Record<string, Resolution>): ProposalPlan {
  const models = renamedProposal(proposed, choices).filter(model => !existing.some(entry => entry.name === model.name && sameJson(entry.fields, model.fields)))
  const root = proposed.at(-1)
  return { models, root: root ? renamesOf(choices).get(root.name) ?? root.name : '' }
}
