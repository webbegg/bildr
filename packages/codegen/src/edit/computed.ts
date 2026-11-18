import { z } from 'zod'
import { CamelNameSchema, ValueSchema } from '../model/schemas.ts'
import type { PageFile, Value } from '../model/schemas.ts'
import { mapPaths, rootOf } from './bindings.ts'
import { defineEdit, fail, isObject } from './core.ts'
import type { Draft } from './core.ts'
import { checkExpression, computedType, describeKind, eitherTyped, shapeOf, typeOfValue } from './expressions.ts'
import type { ExpressionContext, ExpressionKind, Shape } from './expressions.ts'
import { recheckInteractions } from './interactions.ts'
import { PageRef } from './pages.ts'
import { checkAlias } from './queries.ts'
import { computedUsesOf, describeUses } from './usage.ts'

/**
 * Computed values (B1, S4): `page_computed_set` writes "if <condition> then <a> else <b>" as `uses.computed[as]`, which the page
 * script declares as `const <as> = computed(() => if ? then : else)` and nodes bind by name (a List's `items`: "Show drafts" shows
 * every post, otherwise the featured ones). `page_computed_remove` takes one away while nothing binds it.
 *
 * The condition has to read something (a binding, or `not` of one): a fixed `true` or `false` is the same branch always, and the
 * generated `computed(() => true ? …)` fails the app's lint (no-constant-condition) and typecheck (TS2872). A value that is already
 * bound keeps its kind: what reads it (a List's items, `heading.title`, a typed step) needs the same, so a replacement gives the same
 * shape (a list of the same collection, a row of it, or a plain value), and every step that reads it is checked again.
 */

const Alias = CamelNameSchema.describe('The name the page binds the computed value by, e.g. "posts"')

type Computed = { as: string, if?: Value, then?: Value, else?: Value }

const computedOf = (page: PageFile): Computed[] => (page.uses?.computed ?? []) as Computed[]

/** The names a computed value reads (the first word of each bound path). */
const rootsOf = (entry: Computed): string[] => {
  const roots: string[] = []
  mapPaths([entry.if, entry.then, entry.else], (path) => {
    roots.push(rootOf(path))
    return undefined
  })
  return roots
}

/** The way from `entry` back to computed value `target` through the others (the names it passes), or undefined when it doesn't read it. */
const wayTo = (entries: Computed[], entry: Computed, target: string, seen = new Set<string>()): string[] | undefined => {
  for (const root of rootsOf(entry)) {
    if (root === target) return [root]
    const next = entries.find(item => item.as === root)
    if (!next || seen.has(root)) continue
    seen.add(root)
    const way = wayTo(entries, next, target, seen)
    if (way) return [root, ...way]
  }
  return undefined
}

/** Whether a condition reads something the page has: a binding, or `not` of one. */
const readsSomething = (value: Value | undefined): boolean =>
  isObject(value) && (typeof value.$bind === 'string' || ('not' in value && readsSomething(value.not)))

const describeShape = (draft: Draft, shape: Shape): string => describeKind(draft, shape.kind, shape.kind === 'value' ? undefined : shape.entity)

export const pageComputedSet = defineEdit({
  input: z.object({
    page: PageRef,
    as: Alias,
    if: ValueSchema.describe('The condition: true or false, a binding like { "$bind": "preferences.showDrafts" }, or { "not": … } of one'),
    then: ValueSchema.describe('What the value is when the condition holds: a binding like { "$bind": "all" } (a query or computed value the page uses), a { "$template": … } or a literal'),
    else: ValueSchema.describe('What it is otherwise; the same kind of value as then (both lists of one collection, both one row of it, or both plain values)')
  }),
  apply: (draft, { page: pageId, as, if: condition, then, else: otherwise }) => {
    const { page } = draft.page(pageId)
    const entries = computedOf(page)
    const index = entries.findIndex(entry => entry.as === as)
    if (index === -1) checkAlias(draft, page, as, 'computed')
    const context = (allow: ExpressionKind[], subject: string): ExpressionContext => ({
      draft, file: page.id, kind: 'page', exclude: new Set([as]), allow: new Set(allow), subject: `the computed value ${as} (${subject})`
    })
    const condit = { ...context(['bind', 'not'], 'if'), scalar: true }
    const branch = context(['bind', 'template'], 'then and else')
    if (!readsSomething(condition)) fail('invalid', `if: the condition has to read something the page has, like { "$bind": "preferences.showDrafts" } or { "not": … } of one: ${JSON.stringify(condition)} is the same every time, so there is nothing to switch on`)
    checkExpression(condit, condition, 'if')
    checkExpression(branch, then, 'then')
    checkExpression(branch, otherwise, 'else')
    const shape = { then: shapeOf(branch, then, 'then'), else: shapeOf(branch, otherwise, 'else') }
    const same = shape.then.kind === shape.else.kind && (shape.then.kind === 'value' || (shape.else.kind !== 'value' && shape.then.entity === shape.else.entity))
    if (!same) fail('invalid', `then is ${describeShape(draft, shape.then)} but else is ${describeShape(draft, shape.else)}: both have to be the same kind of value, so a List can take either`)
    const entry: Computed = { as, if: condition, then, else: otherwise }
    // A value that reads itself, even through the others, never settles.
    const others = entries.filter(item => item.as !== as)
    const way = wayTo([...others, entry], entry, as)
    if (way) fail('invalid', `The computed value ${as} would read itself${way.length > 1 ? ` through ${way.slice(0, -1).join(', ')}` : ''}`)
    if (index === -1) {
      ;((page.uses ??= {}).computed ??= []).push(entry)
      return { as }
    }
    // What binds the value needs the kind it has: a List's items a list of the same collection, `<as>.title` a row with that field.
    const readers = computedUsesOf(draft.model, pageId, as)
    const had = computedType(context([], 'before'), as)
    const has = eitherTyped(typeOfValue(branch, then), typeOfValue(branch, otherwise))
    if (readers.length && had && has && (had.shape !== has.shape || had.entity !== has.entity)) {
      const was = describeKind(draft, had.shape, had.entity)
      fail('invalid', `${as} is ${was} and the page reads it (${describeUses(readers)}), but then and else give ${describeKind(draft, has.shape, has.entity)}: keep it ${was}, or change what reads it first`)
    }
    page.uses!.computed![index] = entry
    recheckInteractions(draft, page)
    return { as }
  }
})

export const pageComputedRemove = defineEdit({
  input: z.object({ page: PageRef, as: Alias }),
  apply: (draft, { page: pageId, as }) => {
    const { page } = draft.page(pageId)
    const entry = computedOf(page).find(item => item.as === as) ?? fail('not_found', `Page "${page.name}" has no computed value "${as}"`)
    const readers = computedUsesOf(draft.model, pageId, as)
    if (readers.length) fail('invalid', `The page still binds "${as}": ${describeUses(readers)}. Change what reads it first`)
    const uses = page.uses!
    uses.computed = uses.computed!.filter(item => item !== entry)
    if (!uses.computed.length) delete uses.computed
    if (!Object.keys(uses).length) delete page.uses
    return {}
  }
})
