import { kebab as fileName, pascal } from '../generate/text.ts'
import { composableOf, stateComposableOf } from '../generate/names.ts'
import { camel, fail } from './core.ts'
import type { Draft } from './core.ts'
import { actionNameProblem, queryNameProblem } from './generated-names.ts'
import { autoImportedNameProblem, composableProblem } from './reserved-names.ts'

/**
 * Names of queries, actions and states (D10a, B1). Each becomes code: a query the composable `use<Name>`, an action the use-case
 * `<name>`, its composable `use<Name>`, its route and its test, a state the composable `use<Module><Name>` and its collection file.
 * So a name is camelCase, not a reserved word, and free among a module's queries AND actions (ignoring case: their files and
 * composables share a folder), and a state's does not meet any of them. Also the two text helpers the editor's labels share.
 */

const NAME = /^[a-z][A-Za-z0-9]*$/

/** Words an identifier can't be (strict-mode names included: modules are strict), plus the names the generated use-case files already import. */
const UNUSABLE = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public',
  'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'async',
  'eval', 'arguments', 'undefined', 'NaN', 'Infinity',
  'ok', 'err', 'now'
])

/** Whether `name` is a word code can't declare (or one the generated files already import). */
export const isUnusable = (name: string): boolean => UNUSABLE.has(name)

/** `blogPosts` → `blog posts`. */
export const spaced = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()

/** `blog posts` → `Blog posts`. */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export type CallableKind = 'query' | 'action'

/** `given` as a camelCase name: kept when it already is one, else camelCased ("Post list" → "postList"). Refused when it can't be a name. */
export const callableName = (given: string, kind: CallableKind): string => {
  const name = NAME.test(given) ? given : camel(given)
  if (!NAME.test(name)) fail('invalid', `"${given}" can't be ${kind === 'query' ? 'a query' : 'an action'} name: start with a letter, like "${kind === 'query' ? 'featuredPosts' : 'publishPost'}"`)
  if (isUnusable(name)) fail('invalid', `"${name}" is a reserved word: pick another ${kind} name`)
  return name
}

/** Refuses `name` unless it is free in `module` (other than for artifact `self`, when renaming). */
export const checkCallableFree = (draft: Draft, module: string, name: string, self?: string): void => {
  const mod = draft.module(module)
  const taken = [
    ...mod.queries.map(query => ({ kind: 'query', id: query.id, name: query.name })),
    ...mod.actions.map(action => ({ kind: 'action', id: action.id, name: action.name }))
  ].find(entry => entry.id !== self && entry.name.toLowerCase() === name.toLowerCase())
  if (taken) fail('invalid', `Module "${module}" already has the ${taken.kind} ${taken.name} (${taken.id})`)
  // The composition root names each exposed list's use-case list<Plural>.
  const list = mod.entities.find(entity => `list${pascal(entity.plural)}`.toLowerCase() === name.toLowerCase())
  if (list) fail('invalid', `"${name}" is the name of the generated list use-case of ${list.name}: pick another`)
  // A state's composable sits in the same folder: use<Module><State>.
  const state = mod.state.find(entry => stateComposableOf(module, entry.name).toLowerCase() === composableOf(name).toLowerCase())
  if (state) fail('invalid', `The name "${name}" clashes with the state ${state.name} (${state.id}), which the app also names ${composableOf(name)}: pick another`)
}

/** Refuses an action name the module's generated code already declares (its composition root, adapters, error factories…). */
export const checkActionName = (draft: Draft, module: string, name: string): void => {
  const problem = actionNameProblem(draft.model, module, name)
  if (problem) fail('invalid', problem)
}

/** Refuses a query name whose composable (use<Name>) the app already has or the generated composables already import. */
export const checkQueryName = (name: string): void => {
  const problem = queryNameProblem(name)
  if (problem) fail('invalid', problem)
}

export { composableOf }

// ── State (B1) ───────────────────────────────────────────────────────────

export { stateComposableOf }

/**
 * What the generated composable of a state declares in its own scope (generate/client.ts, stateComposableFile): the `data` it reads,
 * the `set` it returns, the `computed` and `useLiveQuery` it imports, the `patch` the setter takes, the `q` of the live query and the
 * `draft` of the update, and the state's own name as the variable that holds the row. (The type, schema and collection it imports are
 * named from the module and state, in PascalCase or ending in `Collection`: a camelCase state name never meets them.)
 */
const STATE_LOCALS = ['data', 'set', 'computed', 'useLiveQuery', 'patch', 'q', 'draft']

/** `given` as a state's camelCase name, or a refusal when it can't be one. */
export const stateName = (given: string): string => {
  const name = NAME.test(given) ? given : camel(given)
  if (!NAME.test(name)) fail('invalid', `"${given}" can't be a state name: start with a letter, like "preferences"`)
  if (isUnusable(name)) fail('invalid', `"${name}" is a reserved word: pick another state name`)
  if (STATE_LOCALS.includes(name)) fail('invalid', `"${name}" is a name the generated code of every state already uses: pick another name`)
  const auto = autoImportedNameProblem(name)
  if (auto) fail('invalid', auto)
  return name
}

/**
 * Refuses a state name that is taken in `module` (ignoring case, other than by state `self`, when renaming), or whose generated files
 * would meet another's: its composable use<Module><Name> next to the queries' and actions' (and one Nuxt provides), and its collection
 * file `data/<name>.collection.ts` next to a collection's.
 */
export const checkStateFree = (draft: Draft, module: string, name: string, self?: string): void => {
  const mod = draft.module(module)
  const taken = mod.state.find(state => state.id !== self && state.name.toLowerCase() === name.toLowerCase())
  if (taken) fail('invalid', `Module "${module}" already has the state ${taken.name} (${taken.id})`)
  const composable = stateComposableOf(module, name)
  const callable = [...mod.queries.map(query => ({ kind: 'query', id: query.id, name: query.name })), ...mod.actions.map(action => ({ kind: 'action', id: action.id, name: action.name }))]
    .find(entry => composableOf(entry.name).toLowerCase() === composable.toLowerCase())
  if (callable) fail('invalid', `The name "${name}" clashes with the ${callable.kind} ${callable.name} (${callable.id}), which the app also names ${composable}: pick another`)
  const problem = composableProblem(composable, name)
  if (problem) fail('invalid', problem)
  const collection = mod.entities.find(entity => fileName(entity.plural) === fileName(name))
  if (collection) fail('invalid', `The name "${name}" is already taken by the collection ${collection.name}: pick another`)
}
