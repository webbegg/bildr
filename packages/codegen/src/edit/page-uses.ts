import type { Model, ModuleModel } from '../model/load.ts'
import type { ApiQuery, DataSourceFile, PageFile, StateFile, Value } from '../model/schemas.ts'
import { apiComposableName, composableOf, handlerName, loadMoreCounter, stateComposableOf, useNames } from '../generate/names.ts'
import { loadMoreSize } from '../render/rules.ts'
import { apiParamRequired, apiQueryOf } from './api-uses.ts'
import { mapPaths, rootOf } from './bindings.ts'
import { autoImportedNameProblem } from './reserved-names.ts'
import { walk } from './tree.ts'

/**
 * What a page's script declares, and what the arguments of its API uses read. Both are pure over the model, so the edits and the
 * model's load check refuse the same things: the generated page has to compile.
 */

/** Names the generated page script declares itself: a use can't take them. */
export const RESERVED = ['site', 'layout', 'route', 'form', 'props', 'toast', 'set', 'execute']

/** Every alias a page already uses. */
export const aliasesOf = (page: PageFile): string[] => [
  ...page.uses?.state ?? [], ...page.uses?.queries ?? [], ...page.uses?.apis ?? [], ...page.uses?.actions ?? [], ...page.uses?.computed ?? []
].map(use => use.as)

export type UseKind = 'state' | 'query' | 'api' | 'action' | 'computed'

export type Declared = Array<{ name: string, by: string }>

/** The module a page is in, with its name. */
export const moduleOfPageIn = (model: Model, page: PageFile): { name: string, mod: ModuleModel } => {
  const entry = Object.entries(model.modules).find(([, mod]) => mod.pages.includes(page))!
  return { name: entry[0], mod: entry[1] }
}

/**
 * The names the generated page script declares for a use `as` of `kind` (generate/ui/files.ts, `pageFile`): the name itself, and what the
 * page derives from it: a state's `set<As>` (what changes it), a query's status `<as>Status` (a module's or an API's), an action's `<as>Pending` and
 * `<as>Error`. Each says in `by` what it is, as a refusal shows it.
 */
export const declaredBy = (as: string, kind: UseKind): Declared => {
  const { set, status, pending, error } = useNames(as)
  const derived: Array<[string, string]> = kind === 'state'
    ? [[set, `the "set…" name of the state "${as}"`]]
    : kind === 'query' || kind === 'api'
      ? [[status, `the status of "${as}"`]]
      : kind === 'action' ? [[pending, `the pending flag of "${as}"`], [error, `the error of "${as}"`]] : []
  return [{ name: as, by: `"${as}"` }, ...derived.map(([name, by]) => ({ name, by }))]
}

/**
 * Every name the page's script declares today: its uses and what they derive, the composables it calls, the handler of each
 * interaction (`on<Node><Event>`) and the counter of each List that loads more (`shown<Node>`).
 */
export const declaredNames = (model: Model, page: PageFile): Declared => {
  const { name: module, mod } = moduleOfPageIn(model, page)
  const names: Declared = []
  // A composable is called once per use, never declared: two uses of one query call it twice, so it is listed once. Two
  // different items whose composables share a name still meet.
  const composables = new Set<string>()
  const composable = (name: string, by: string) => {
    if (composables.has(by)) return
    composables.add(by)
    names.push({ name, by })
  }
  for (const use of page.uses?.state ?? []) {
    names.push(...declaredBy(use.as, 'state'))
    const state = mod.state.find(entry => entry.id === use.state)
    if (state) composable(stateComposableOf(module, state.name), `the name the state ${state.name} generates`)
  }
  for (const use of page.uses?.queries ?? []) {
    names.push(...declaredBy(use.as, 'query'))
    const query = mod.queries.find(entry => entry.id === use.query)
    if (query) composable(composableOf(query.name), `the name the query ${query.name} generates`)
  }
  for (const use of page.uses?.apis ?? []) {
    names.push(...declaredBy(use.as, 'api'))
    const source = model.datasources.find(entry => entry.id === use.datasource)
    if (source) composable(apiComposableName(source.name, use.query), `the name the query ${use.query} of the API ${source.name} generates`)
  }
  for (const use of page.uses?.actions ?? []) {
    names.push(...declaredBy(use.as, 'action'))
    const action = mod.actions.find(entry => entry.id === use.action)
    if (action) composable(composableOf(action.name), `the name the action ${action.name} generates`)
  }
  for (const use of page.uses?.computed ?? []) names.push(...declaredBy(use.as, 'computed'))
  names.push(...nodeNames(page))
  return names
}

/** The names the page's script declares for its nodes: the handler of each interaction (`on<Node><Event>`) and the counter of each List that loads more (`shown<Node>`). */
export const nodeNames = (page: PageFile): Declared => {
  const names: Declared = []
  walk(page.root, (node) => {
    for (const interaction of node.interactions ?? []) names.push({ name: handlerName(node.id, interaction.on), by: `the handler of ${node.id}'s ${interaction.on}` })
    if (node.type === 'List' && loadMoreSize(node.props?.loadMore) !== undefined) names.push({ name: loadMoreCounter(node.id), by: `the counter of ${node.id}` })
  })
  return names
}

/**
 * Why the page's script can't declare `added` next to what it has: a name it uses itself, one Vue or Nuxt provides, or one declared
 * twice. Without `added`, the same for what it has. Undefined when it can.
 */
export const pageNamesProblem = (model: Model, page: PageFile, added: Declared = []): string | undefined => {
  const seen = new Map<string, string>()
  const have = declaredNames(model, page)
  // With names to add, only they are looked at: what the page has is not theirs to refuse for.
  if (added.length) for (const { name, by } of have) seen.set(name, by)
  for (const { name, by } of added.length ? added : have) {
    if (RESERVED.includes(name)) return `${by === `"${name}"` ? `"${name}"` : `${by} would be "${name}", which`} is a name the page's script uses itself: pick another`
    // Only the name a page gives a use shadows what Vue and Nuxt provide; what the page derives from it (`createError`) the script never calls.
    const auto = by === `"${name}"` ? autoImportedNameProblem(name) : undefined
    if (auto) return auto
    const other = seen.get(name)
    if (other) return `The page's script would declare "${name}" twice: as ${other} and as ${by}`
    seen.set(name, by)
  }
  return undefined
}

// ── The arguments of an API use ──────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A value that is computed rather than written: an object with a `$…` key or `not`. */
const isExpr = (value: unknown): value is Record<string, Value> => isObject(value) && Object.keys(value).some(key => key.startsWith('$') || key === 'not')

/** Whether a literal is a value of a parameter's type (a whole number for an integer, text for text…). */
const literalFits = (type: ApiQuery['params'][number]['type'], value: Value): boolean =>
  type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' : type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string'

/** What a state field is in TypeScript, as far as a parameter cares: dates, ids and image addresses are text. */
const KIND_OF_FIELD: Record<StateFile['fields'][number]['type'], 'text' | 'integer' | 'number' | 'boolean'> = {
  text: 'text', image: 'text', uuid: 'text', date: 'text', datetime: 'text', integer: 'integer', number: 'number', boolean: 'boolean',
  email: 'text', url: 'text', phone: 'text', color: 'text', select: 'text', money: 'number', percent: 'number'
}

/** Whether a value of kind `have` is accepted by a parameter of type `want`: a whole number is a number, nothing else converts. */
const kindFits = (want: ApiQuery['params'][number]['type'], have: 'text' | 'integer' | 'number' | 'boolean'): boolean =>
  want === have || (want === 'number' && have === 'integer')

export interface ApiArgsOptions {
  /** With the page, the values the arguments read (`$bind`, `$template`) are checked too: what they name, and that their type fits. */
  page?: PageFile
  /** The states of the page's module: what the page's `uses.state` names. */
  states?: StateFile[]
  /** The name this use is (or will be) under, so an argument can't read its own answer. */
  as?: string
  /** Every required parameter must be given (default). */
  complete?: boolean
}

/**
 * Why `args` can't be the arguments of `query` (of the API source `source`) on a page, or undefined when the generated call compiles:
 * only the query's own parameters, each literal of the parameter's type, a route parameter for text, integer or number (a route
 * value is text: the generated call converts it to a number, and one that isn't a number is refused by the use-case), every required one present
 * (`complete`) and, with `page`, each value it reads one the page has and the generated TypeScript accepts. A value bound to a state field
 * has the field's type, which is undefined when the field has neither a default nor a requirement and null when it is nullable: a
 * `fallback` covers both. The answer of an API query is undefined until it loads, and a use reading another (or itself) could loop:
 * an argument can't read one, for now.
 */
export const apiArgsProblem = (source: DataSourceFile, query: ApiQuery, args: Record<string, Value | null> | undefined, options: ApiArgsOptions = {}): string | undefined => {
  const label = `The query "${query.name}" of the API "${source.name}"`
  for (const name of Object.keys(args ?? {})) {
    if (!query.params.some(param => param.name === name)) return `${label} has no parameter "${name}" (${query.params.map(param => param.name).join(', ') || 'none'})`
  }
  for (const param of query.params) {
    const value = args?.[param.name]
    if (value === undefined || value === null) {
      if (options.complete !== false && apiParamRequired(param)) return `${label} needs "${param.name}"`
      continue
    }
    const wrong = (detail: string) => `${label} takes "${param.name}" as ${param.type}, but ${detail}`
    if (!isExpr(value)) {
      if (!literalFits(param.type, value)) return wrong(`the page passes ${JSON.stringify(value)}`)
      continue
    }
    if ('$route' in value && param.type === 'boolean') return wrong(`the page passes ${JSON.stringify(value)}`)
    if (typeof value.$template === 'string' && param.type !== 'text') return wrong(`the page passes text built from ${JSON.stringify(value.$template)}`)
    if ('not' in value && param.type !== 'boolean') return wrong('the page passes a true-or-false value')
    if (!options.page) continue
    const problem = boundProblem(options.page, options.states ?? [], options.as, label, param, value)
    if (problem) return problem
  }
  return undefined
}

/** The roots (`first` of `first.id`) a value reads, in the order it reads them. */
const rootsOf = (value: Value): string[] => {
  const roots: string[] = []
  mapPaths(value, (path) => {
    roots.push(rootOf(path))
    return undefined
  })
  return roots
}

/** What an expression argument reads, against the page: a name it has, not this use's own answer, not another API answer, and for a `$bind` of a state field a type that fits. */
const boundProblem = (page: PageFile, states: StateFile[], as: string | undefined, label: string, param: ApiQuery['params'][number], value: Record<string, Value>): string | undefined => {
  for (const root of rootsOf(value)) {
    const reads = `${label}: "${param.name}" reads "${root}"`
    if (root === as) return `${reads}, the answer of this very use: pick a value it doesn't depend on`
    if (page.uses?.apis?.some(use => use.as === root)) return `${reads}, the answer of another API query, which is undefined until it loads: pass a literal, a route parameter or a field of a state for now`
    if (page.uses?.state?.some(use => use.as === root)) continue
    if (aliasesOf(page).includes(root) || root === 'site') return `${reads}, which can't fill an API parameter: pass a literal, a route parameter or a field of a state`
    return `${label}: "${param.name}" reads "${root}", which doesn't refer to anything this page uses`
  }
  if (typeof value.$bind !== 'string') return undefined
  const path = value.$bind
  const use = page.uses?.state?.find(entry => entry.as === rootOf(path))
  const state = use && states.find(entry => entry.id === use.state)
  if (!use || !state) return undefined
  const members = path.split('.').slice(1)
  const field = members.length === 1 ? state.fields.find(entry => entry.name === members[0]) : undefined
  if (!field) return `${label}: "${param.name}" reads "${path}", which isn't a field of the state "${use.as}" (${state.fields.map(entry => entry.name).join(', ')})`
  const fallback = value.fallback
  if (fallback !== undefined && fallback !== null) {
    if (isExpr(fallback) || !literalFits(param.type, fallback)) return `${label} takes "${param.name}" as ${param.type}, but its fallback ${JSON.stringify(fallback)} isn't`
  }
  if (!kindFits(param.type, KIND_OF_FIELD[field.type])) return `${label} takes "${param.name}" as ${param.type}, but "${path}" is ${field.type}`
  if (fallback !== undefined && fallback !== null) return undefined
  if (field.nullable) return `${label}: "${param.name}" reads "${path}", which can be null: give it a fallback ({ "$bind": "${path}", "fallback": … })`
  if (stateFieldEmpty(field) && apiParamRequired(param)) return `${label}: "${param.name}" is required but "${path}" can be empty: give the state field a default, or the value a fallback ({ "$bind": "${path}", "fallback": … })`
  return undefined
}

/** A state field that is undefined until something sets it: no default, and not required (a required one has its default). */
const stateFieldEmpty = (field: StateFile['fields'][number]): boolean => field.default === undefined && !field.required

/**
 * Whether a state field can fill `param` as a plain `{ "$bind": "<state>.<field>" }`, with no fallback: its type fits the parameter, it
 * is never null, and it is never undefined for a required parameter. What `apiArgsProblem` accepts for such a value, so the editor
 * offers only fields the module takes.
 */
export const apiParamAcceptsStateField = (param: ApiQuery['params'][number], field: StateFile['fields'][number]): boolean =>
  kindFits(param.type, KIND_OF_FIELD[field.type]) && !field.nullable && !(stateFieldEmpty(field) && apiParamRequired(param))

// ── What a List repeats over ─────────────────────────────────────────────

/**
 * Why a List can't repeat over `items` (its `items` value) on `page`, or undefined: it repeats only over the whole answer of an API
 * query that answers a list. One record (`first`) and a field of an answer (`first.tags`, `products.tags`) are refused; what is not an
 * API answer is the generator's and the scope's to judge.
 */
export const apiItemsProblem = (model: Model, page: PageFile, items: Value | undefined): string | undefined => {
  if (!isObject(items) || typeof items.$bind !== 'string') return undefined
  const [root, ...members] = items.$bind.split('.')
  const use = page.uses?.apis?.find(entry => entry.as === root)
  if (!use) return undefined
  if (members.length) return `"${items.$bind}" is a field of an API answer: a List repeats over the whole answer of a query that answers a list`
  const found = apiQueryOf(model.datasources, use)
  if (found && !found.query.result.many) return `"${root}" is one record, not a list: the query "${found.query.name}" of the API "${found.source.name}" answers one. A List repeats over a query that answers a list`
  return undefined
}
