import type { ActionFile, Model } from '@bildr/codegen/model'
import { queryFields } from '../shared/dataArtifacts.ts'
import { entityById, repositoryEntity } from '../shared/dataModel.ts'
import type { FieldType } from '../shared/dataModel.ts'

/**
 * What the steps of an action may read and call (S10, D10c): the values an expression can take (`Expr`, the picker's model of
 * a stored value), what is in scope at each step (`scopeAt`) and the repositories a step may name (`repositoriesOf`). Pure reads
 * of the model, like `shared/dataArtifacts.ts`: the step editor (`stepDraft.ts` and the Steps tab) is built on them.
 *
 * The expressions an action's steps take are the ones the use-case generator compiles (`generate/actions.ts`): `{ $input }` (a
 * field of the body, or a route parameter: both are the use-case's input), `{ $var }` (a name a `load` step gave, and a path
 * into its row) and `{ $now }`, besides plain values and the `if`/`then`/`else` the form does not edit (it keeps it as it is).
 */

export type Step = Record<string, unknown> & { kind: string }

/** A stored value as the picker shows it. `computed` is any expression the form does not edit; it is kept as it is. */
export type Expr
  = | { kind: 'none' }
    | { kind: 'input', path: string }
    | { kind: 'var', path: string }
    | { kind: 'now' }
    | { kind: 'empty' }
    | { kind: 'literal', value: string | number | boolean }
    | { kind: 'computed', value: unknown }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

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

/** The stored value of an expression: undefined for none (the key is left out). */
export function valueOfExpr(expr: Expr): unknown {
  switch (expr.kind) {
    case 'none': return undefined
    case 'input': return { $input: expr.path }
    case 'var': return { $var: expr.path }
    case 'now': return { $now: true }
    case 'empty': return null
    case 'literal': return expr.value
    case 'computed': return expr.value
  }
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

// ── What is in scope at a step ───────────────────────────────────────────

/** A value a step can read: its path (`slug`, `post.title`), its type when it is a field, and `row` (the entity's id) for a variable that holds a row. */
export interface ScopeEntry {
  path: string
  type?: FieldType
  row?: string
}

export interface StepScope {
  /** The fields of the body and the route parameters: `{ $input }`. */
  input: ScopeEntry[]
  /** The names the steps before it gave, each with the fields of its row: `{ $var }`. */
  vars: ScopeEntry[]
}

/**
 * What step `index` of `steps` can read. A variable is the name a `load` step gave (`as`): only steps after it have it, so the
 * step itself and the ones before it never do. (A `repository` step is the last step and gives no name.)
 */
export function scopeAt(model: Model, action: Pick<ActionFile, 'input'>, steps: readonly Step[], index: number): StepScope {
  const input: ScopeEntry[] = []
  const entity = action.input.entity ? entityById(model, action.input.entity) : undefined
  if (entity) {
    const picked = action.input.pick
    for (const field of queryFields(model, entity.id)) {
      if (picked ? picked.includes(field.name) : field.name !== 'createdAt' && field.name !== 'updatedAt') input.push({ path: field.name, type: field.type })
    }
  }
  for (const param of action.input.params ?? []) input.push({ path: param.name, type: param.type })

  const vars: ScopeEntry[] = []
  for (const step of steps.slice(0, index)) {
    if (step.kind !== 'load' || typeof step.as !== 'string' || step.as === '') continue
    const row = typeof step.repository === 'string' ? repositoryEntity(model, step.repository) : undefined
    vars.push({ path: step.as, row: row ?? '' })
    if (row) for (const field of queryFields(model, row)) vars.push({ path: `${step.as}.${field.name}`, type: field.type })
  }
  return { input, vars }
}

// ── What a step may call ─────────────────────────────────────────────────

export type WriteOp = 'create' | 'update' | 'delete'

/** A way to find one row: `get` by the key, or a finder by one of the entity's fields. `arg` names the one argument it takes. */
export interface Lookup {
  op: string
  label: string
  arg: string
  type: FieldType
}

/** A repository of the action's module, as its steps may use it: by the collection it stores. */
export interface RepoInfo {
  id: string
  entity: string
  name: string
  /** The type of the key the repository's rows have. */
  key: FieldType
  writes: WriteOp[]
  lookups: Lookup[]
  /** The fields a write sets: the entity's own, not the key. */
  fields: Array<{ name: string, type: FieldType }>
}

const WRITES: WriteOp[] = ['create', 'update', 'delete']
const spaced = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
const pascal = (name: string) => name.split(/[-_\s]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')

/**
 * The repositories the action's steps may name (a use-case reads those of its own module), with the operations each has:
 * the ones the generator writes (`create`, `update`, `delete`) and the ways to find one row (`get`, and a finder by each field
 * the repository lists, `findBy<Field>`). `list` takes a page, which a step cannot give, so it is not offered.
 */
export function repositoriesOf(model: Model, actionId: string): RepoInfo[] {
  const owner = Object.values(model.modules).find(mod => mod.actions.some(action => action.id === actionId))
  if (!owner) return []
  return owner.repositories.flatMap((repository): RepoInfo[] => {
    const entity = entityById(model, repository.entity)
    if (!entity) return []
    const key: FieldType = entity.idStrategy === 'uuid' ? 'uuid' : entity.fields.find(field => field.name === 'id')?.type ?? 'text'
    const finders = (repository.finders ?? []).flatMap((finder) => {
      const field = entity.fields.find(entry => entry.id === finder.by)
      return field ? [{ op: `findBy${pascal(field.name)}`, label: `Find by ${spaced(field.name)}`, arg: field.name, type: field.type }] : []
    })
    return [{
      id: repository.id,
      entity: entity.id,
      name: entity.name,
      key,
      writes: WRITES.filter(op => repository.operations.includes(op)),
      lookups: [...repository.operations.includes('get') ? [{ op: 'get', label: 'Get by id', arg: 'id', type: key }] : [], ...finders],
      fields: entity.fields.filter(field => field.name !== 'id').map(field => ({ name: field.name, type: field.type }))
    }]
  })
}
