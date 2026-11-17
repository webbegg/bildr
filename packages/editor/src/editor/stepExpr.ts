import type { FieldType } from '../shared/dataModel.ts'
import { isObject } from '../model.ts'

/**
 * The values the steps of an action take (S10, D10c): a step as the model stores it (`Step`), a stored value as the picker shows
 * it (`Expr`), a literal typed by the type of the field it is for, and the names a value reads. Pure, with no model to look in
 * (`stepScope.ts` says what is in scope, `stepRepos.ts` what a step may call): the step editor (`stepDraft.ts` and the Steps tab)
 * is built on them.
 *
 * The expressions an action's steps take are the ones the use-case generator compiles (`generate/actions.ts`): `{ $input }` (a
 * field of the body, or a route parameter: both are the use-case's input), `{ $var }` (a name a `load` step gave, and a path
 * into its row) and `{ $now }`, besides plain values and the `if`/`then`/`else` the form does not edit (it keeps it as it is).
 */

export type Step = Record<string, unknown> & { kind: string }

/** A value as an object to read keys of, or an empty one when it is not an object (a step the form is filling in has parts that are not there yet). */
export const record = (value: unknown): Record<string, unknown> => isObject(value) ? value : {}

/** The object with `patch` over it: a key whose value is `undefined` is left out, as a form leaves a part that is not there. */
export function patched<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...base, ...patch }
  for (const key of Object.keys(patch)) if (patch[key] === undefined) Reflect.deleteProperty(next, key)
  return next as T
}

/** A stored value as the picker shows it. `computed` is any expression the form does not edit; it is kept as it is. */
export type Expr
  = | { kind: 'none' }
    | { kind: 'input', path: string }
    | { kind: 'var', path: string }
    | { kind: 'now' }
    | { kind: 'empty' }
    | { kind: 'literal', value: string | number | boolean }
    | { kind: 'computed', value: unknown }

export function exprOf(value: unknown): Expr {
  if (value === undefined) return { kind: 'none' }
  if (value === null) return { kind: 'empty' }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return { kind: 'literal', value }
  if (isObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1 && typeof value.$input === 'string') return { kind: 'input', path: value.$input }
    if (keys.length === 1 && typeof value.$var === 'string') return { kind: 'var', path: value.$var }
    if (keys.length === 1 && value.$now === true) return { kind: 'now' }
  }
  return { kind: 'computed', value }
}

/**
 * A literal typed in a box of a field of `type`: a number for a number field, true or false for a toggle, else the text. Text
 * that is not what the type needs stays text, so the editor can name the problem (`literalProblem`) instead of losing it.
 */
export function literalOf(type: FieldType | undefined, text: string): string | number | boolean {
  const typed = text.trim()
  if (type === 'integer') return /^[+-]?\d+$/.test(typed) ? Number(typed) : text
  if (type === 'number') return typed !== '' && Number.isFinite(Number(typed)) ? Number(typed) : text
  if (type === 'boolean') return typed === 'true' ? true : typed === 'false' ? false : text
  return text
}

/** What a new literal of `type` starts as. */
export const defaultLiteral = (type: FieldType | undefined): string | number | boolean =>
  type === 'integer' || type === 'number' ? 0 : type === 'boolean' ? false : ''

/** Why a literal is not a value of `type` (what it should be), or undefined. */
export function literalProblem(type: FieldType | undefined, value: string | number | boolean): string | undefined {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value) ? undefined : 'a whole number'
  if (type === 'number') return typeof value === 'number' ? undefined : 'a number'
  if (type === 'boolean') return typeof value === 'boolean' ? undefined : 'true or false'
  return typeof value === 'string' ? undefined : 'text'
}

/** The first names of the `key` expressions (`$var`, `$input`) a value tree mentions, in the order they are met: `post.title` is `post`. */
function rootsOf(value: unknown, key: '$var' | '$input'): string[] {
  if (Array.isArray(value)) return value.flatMap(item => rootsOf(item, key))
  if (!isObject(value)) return []
  const own = value[key]
  return [...typeof own === 'string' ? [own.split('.')[0]!] : [], ...Object.entries(value).filter(([name]) => name !== key).flatMap(([, item]) => rootsOf(item, key))]
}
export const varRoots = (value: unknown): string[] => rootsOf(value, '$var')
export const inputRoots = (value: unknown): string[] => rootsOf(value, '$input')

/** The value with every `{ $var }` that reads row `from` (or a field of it) reading `to` instead: `post.title` becomes `row.title`. Anything else is kept as it is. */
export function renameVar(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) return value.map(item => renameVar(item, from, to))
  if (!isObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === '$var' && typeof item === 'string') {
      const [root, ...path] = item.split('.')
      return [key, root === from ? [to, ...path].join('.') : item]
    }
    return [key, renameVar(item, from, to)]
  }))
}
