import { pascal } from '../generate/text.ts'
import { camel, fail } from './core.ts'
import type { Draft } from './core.ts'

/**
 * Names of queries and actions (D10a). Both become code: a query the composable `use<Name>`, an
 * action the use-case `<name>`, its composable `use<Name>`, its route and its test. So a name is
 * camelCase, not a reserved word, and free among a module's queries AND actions (ignoring case:
 * their files and composables share a folder).
 */

const NAME = /^[a-z][A-Za-z0-9]*$/

/** Words an identifier can't be, plus the names the generated use-case files already import. */
const UNUSABLE = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public',
  'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'async',
  'ok', 'err', 'now'
])

/** Whether `name` is a word code can't declare (or one the generated files already import). */
export const isUnusable = (name: string): boolean => UNUSABLE.has(name)

/** `blogPosts` → `blog posts`. */
export const spaced = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
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
}

/** The client composable a query or action named `name` generates. */
export const composableOf = (name: string): string => `use${pascal(name)}`
