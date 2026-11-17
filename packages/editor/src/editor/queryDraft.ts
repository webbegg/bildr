import type { QueryFile, Value } from '@bildr/codegen/model'
import { isObject } from '../model.ts'
import type { FieldType } from '../shared/dataModel.ts'
import { sameJson } from './draftJson.ts'
import type { QueryField, QueryResultKind } from '../shared/dataArtifacts.ts'

/**
 * The Query Definition form's draft (S10): a query as the form holds it (text in every box, a choice for what a value is) and
 * what saving it asks of the module. `changesOf` is the `query_update` input of only what the draft changed (an unchanged part is
 * not sent, so a refusal of one never blocks another), or the problems a box has that make it unsendable (a number that is not
 * one). The module checks the rest: a field the collection has, a value that fits its type, a parameter that exists.
 */

export type Op = NonNullable<QueryFile['where']>['op']
export const OPS: Array<{ value: Op, label: string }> = [
  { value: 'eq', label: 'is' },
  { value: 'ne', label: 'is not' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'in', label: 'is one of' },
  { value: 'like', label: 'matches' }
]

export interface DraftParam {
  name: string
  type: FieldType
  /** The default as typed (`''`: none); a toggle's is `true` or `false`. */
  default: string
  /** Carried through: a reactive parameter stays one. */
  reactive?: boolean
}

export interface DraftWhere {
  field: string
  op: Op
  /** What the value is: a literal typed in `value`, a parameter of the query (`param`), or an expression the form does not edit (`expression`, kept as it is). */
  kind: 'value' | 'param' | 'expression'
  value: string
  param: string
  /** The value as it is in the file (typed `unknown`: it is any model value, which a form's reactive state need not walk). */
  expression?: unknown
}

export interface DraftLimit {
  kind: 'none' | 'number' | 'param' | 'expression'
  number: string
  param: string
  expression?: unknown
}

export interface QueryDraft {
  label: string
  description: string
  result: QueryResultKind
  params: DraftParam[]
  where: DraftWhere | null
  orderBy: Array<{ field: string, direction: 'asc' | 'desc' }>
  limit: DraftLimit
}

const isParam = (value: unknown): value is { $param: string } => isObject(value) && typeof value.$param === 'string'

/** A literal as the form shows it: text, a list as comma-separated text. */
const textOf = (value: unknown): string => Array.isArray(value) ? value.map(item => String(item ?? '')).join(', ') : value === null || value === undefined ? '' : String(value)

/** The draft of a query as it is now. */
export function draftOf(query: QueryFile): QueryDraft {
  const where = query.where
  const limit = query.limit
  return {
    label: query.label,
    description: query.description ?? '',
    result: query.result,
    params: query.params.map(param => ({ name: param.name, type: param.type as FieldType, default: textOf(param.default), ...param.reactive ? { reactive: true } : {} })),
    where: where
      ? {
          field: where.field,
          op: where.op,
          kind: isParam(where.value) ? 'param' : isObject(where.value) ? 'expression' : 'value',
          value: isObject(where.value) ? '' : textOf(where.value),
          param: isParam(where.value) ? where.value.$param : '',
          ...isObject(where.value) && !isParam(where.value) ? { expression: where.value } : {}
        }
      : null,
    orderBy: (query.orderBy ?? []).map(order => ({ field: order.field, direction: order.direction })),
    limit: limit === undefined || limit === null
      ? { kind: 'none', number: '', param: '' }
      : isParam(limit)
        ? { kind: 'param', number: '', param: limit.$param }
        : isObject(limit) ? { kind: 'expression', number: '', param: '', expression: limit } : { kind: 'number', number: String(limit), param: '' }
  }
}

/** A typed value of `type`, or what is wrong with the text. */
export function valueOfText(type: FieldType | undefined, text: string): { value: Value } | { problem: string } {
  const typed = text.trim()
  if (type === 'integer') return /^[+-]?\d+$/.test(typed) ? { value: Number(typed) } : { problem: 'a whole number' }
  if (type === 'number') return typed !== '' && Number.isFinite(Number(typed)) ? { value: Number(typed) } : { problem: 'a number' }
  if (type === 'boolean') return typed === 'true' || typed === 'false' ? { value: typed === 'true' } : { problem: 'true or false' }
  return { value: text }
}

export interface QueryChanges {
  /** The `query_update` input, without the `query` and `inPlace` the caller adds; empty when nothing changed. */
  input: Record<string, unknown>
  /** What stops the draft from being sent, for each box that has such a problem. */
  problems: string[]
}

/** The parts of a query that the form edits (its name, id and collection are not in the draft). */
const editable = (query: QueryFile) => ({
  label: query.label,
  description: query.description ?? null,
  result: query.result,
  params: query.params,
  where: query.where ?? null,
  orderBy: query.orderBy ?? [],
  limit: query.limit ?? null
})

/**
 * Whether the query as it is stored now differs, in a part the form edits, from the query the draft started from (`base`: the query
 * as it was when the draft was opened or last saved). A rename is not one: the name is not in the draft.
 */
export const changedOutside = (base: QueryFile, query: QueryFile): boolean => !sameJson(editable(base), editable(query))

/**
 * The draft after the user chose to keep their edits over a query that changed under them: each part of the form the user did
 * not touch (it still reads as `base` has it) shows the stored query's, and each part they touched stays, so that, saved against
 * the stored query as the new base, only the touched parts are sent.
 */
export function rebaseDraft(draft: QueryDraft, base: QueryFile, query: QueryFile): QueryDraft {
  const before = draftOf(base)
  const now = draftOf(query)
  const part = <K extends keyof QueryDraft>(key: K): QueryDraft[K] => sameJson(draft[key], before[key]) ? now[key] : draft[key]
  return { label: part('label'), description: part('description'), result: part('result'), params: part('params'), where: part('where'), orderBy: part('orderBy'), limit: part('limit') }
}

/**
 * What saving `draft` asks of the module: only the parts that changed from `base`, or the problems that stop it. `base` is the
 * query the draft started from (when it was opened or last saved), not the query as stored now: a part changed outside the form
 * that the user did not touch is not theirs to send (the form's copy of it is stale).
 *
 * A part the user did not touch is sent as it is stored, never converted back from its text: a literal that does not
 * survive the text (a null on a number field, a mistyped value, a field the collection no longer has) would otherwise count as a
 * change, or block the save of a label. "Touched" is compared with `draftOf(base)`, the text the form opened with.
 */
export function changesOf(draft: QueryDraft, base: QueryFile, fields: readonly QueryField[]): QueryChanges {
  const input: Record<string, unknown> = {}
  const problems: string[] = []
  const typeOf = (name: string) => fields.find(field => field.name === name)?.type
  const opened = draftOf(base)

  if (draft.label !== base.label) {
    if (draft.label.trim() === '') problems.push('Add a label')
    else input.label = draft.label
  }
  if (draft.description !== (base.description ?? '')) input.description = draft.description === '' ? null : draft.description
  if (draft.result !== base.result) input.result = draft.result

  const params = draft.params.map((param) => {
    const at = opened.params.findIndex(original => sameJson(original, param))
    if (at >= 0) return base.params[at]!
    const converted = param.default === '' ? undefined : valueOfText(param.type, param.default)
    if (converted && 'problem' in converted) problems.push(`Parameter ${param.name || '(unnamed)'}: its default is ${converted.problem}`)
    return { name: param.name, type: param.type, ...converted && 'value' in converted ? { default: converted.value } : {}, ...param.reactive ? { reactive: true } : {} }
  })
  if (!sameJson(draft.params, opened.params)) input.params = params

  if (!sameJson(draft.where, opened.where)) {
    let where: QueryFile['where'] | null = null
    if (draft.where) {
      const { field, op } = draft.where
      const before = opened.where
      let value: Value | undefined
      if (draft.where.kind === 'param') value = { $param: draft.where.param }
      else if (draft.where.kind === 'expression') value = draft.where.expression as Value
      else if (before && base.where && before.kind === 'value' && before.field === field && before.value === draft.where.value && (before.op === 'in') === (op === 'in')) {
        // Only the operator changed: the literal keeps its stored form.
        value = base.where.value
      } else {
        const type = typeOf(field)
        const items = op === 'in' ? draft.where.value.split(',').map(item => item.trim()).filter(item => item !== '') : [draft.where.value]
        const converted = items.map(item => valueOfText(op === 'like' ? 'text' : type, item))
        const bad = converted.find(item => 'problem' in item)
        if (bad && 'problem' in bad) problems.push(`Condition: the value of ${field} is ${bad.problem}`)
        else value = op === 'in' ? converted.map(item => (item as { value: Value }).value) : (converted[0] as { value: Value }).value
      }
      if (value !== undefined) where = { op, field, value }
    }
    if (!sameJson(where, base.where ?? null)) input.where = where
  }

  if (!sameJson(draft.orderBy, base.orderBy ?? [])) input.orderBy = draft.orderBy

  if (!sameJson(draft.limit, opened.limit)) {
    let limit: Value | null = null
    if (draft.limit.kind === 'param') limit = { $param: draft.limit.param }
    else if (draft.limit.kind === 'expression') limit = draft.limit.expression as Value ?? null
    else if (draft.limit.kind === 'number') {
      const converted = valueOfText('integer', draft.limit.number)
      if ('problem' in converted) problems.push('Limit: enter a whole number')
      else limit = converted.value
    }
    if (!sameJson(limit, base.limit ?? null)) input.limit = limit
  }

  return { input, problems }
}

// ── The query in words ───────────────────────────────────────────────────

/** A condition in words, as the form words its operators: `cost is less than 5`, `slug is the “slug” parameter`. */
export function conditionText(where: DraftWhere): string {
  const op = OPS.find(entry => entry.value === where.op)?.label ?? where.op
  const value = where.kind === 'param' ? `the “${where.param}” parameter` : where.kind === 'expression' ? 'a computed value' : where.value.trim() || '…'
  return `${where.field} ${op} ${value}`
}

/** An ordering in words: `newest first` for a date field, else the field and its direction, most significant first. */
export function orderText(orderBy: QueryDraft['orderBy'], fields: readonly QueryField[]): string {
  return orderBy.map((order) => {
    const type = fields.find(field => field.name === order.field)?.type
    if (type === 'datetime' || type === 'date') return order.direction === 'desc' ? 'newest first' : 'oldest first'
    return `${order.field} ${order.direction === 'desc' ? 'descending' : 'ascending'}`
  }).join(', then ')
}

/** A limit in words: the number, or for a parameter its default (`limit 6`), else the parameter that sets it. */
export function limitText(limit: DraftLimit, params: readonly DraftParam[]): string {
  if (limit.kind === 'number') return limit.number.trim() ? `limit ${limit.number.trim()}` : ''
  if (limit.kind === 'expression') return 'limit from a computed value'
  if (limit.kind !== 'param') return ''
  const fallback = params.find(param => param.name === limit.param)?.default
  return fallback ? `limit ${fallback}` : `limit set by “${limit.param}”`
}

/** The query on one line, `cost is less than 5 · newest first · limit 6`: what the Results tab says above the rows. */
export function summaryOf(draft: QueryDraft, fields: readonly QueryField[]): string {
  const parts = [draft.where ? conditionText(draft.where) : '', orderText(draft.orderBy, fields), limitText(draft.limit, draft.params)].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Every row'
}

/** The draft with parameter `index` renamed, and the condition and limit that read it by the old name following it. */
export function renameParam(draft: QueryDraft, index: number, name: string): QueryDraft {
  const previous = draft.params[index]?.name
  return {
    ...draft,
    params: draft.params.map((param, at) => at === index ? { ...param, name } : param),
    where: draft.where && previous !== undefined && draft.where.kind === 'param' && draft.where.param === previous ? { ...draft.where, param: name } : draft.where,
    limit: previous !== undefined && draft.limit.kind === 'param' && draft.limit.param === previous ? { ...draft.limit, param: name } : draft.limit
  }
}
