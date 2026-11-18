import { z } from 'zod'
import { ArtifactIdSchema, CamelNameSchema, CONDITION_OPS, LocalIdSchema, ModuleNameSchema, ParamSchema, ValueSchema } from '../model/schemas.ts'
import type { EntityFile, ModelNode, PageFile, QueryFile, Value } from '../model/schemas.ts'
import { mapNodePaths, mapPaths, rootOf } from './bindings.ts'
import { camel, defineEdit, fail, kebab, uniqueName } from './core.ts'
import type { Draft } from './core.ts'
import { entityById, fits, isExpression, keyType, repositoryOf } from './entities.ts'
import { pascal } from '../generate/text.ts'
import { loadMoreSize } from '../render/rules.ts'
import { callableName, checkCallableFree, checkQueryName, composableOf, isUnusable, stateComposableOf } from './naming.ts'
import { PageRef } from './pages.ts'
import { autoImportedNameProblem } from './reserved-names.ts'
import { walk } from './tree.ts'
import { describeUses, usesOf as artifactUsesOf } from './usage.ts'

/**
 * Queries and what a page uses (P5, mapping §4). A List's source is a query the page uses
 * (`uses.queries`); the editor creates one for a list (`query_create_for_list`, `q_<page>_<as>`),
 * edits its sort, filter and limit (`query_update`: in place when one page use reads it,
 * a copy `q_<page>_<as>` for this use when several do, Q5) and edits the page's uses
 * (`page_use_add`, `page_use_update`, `page_use_remove`: queries with their arguments, and
 * the actions its forms run).
 */

const QueryRef = ArtifactIdSchema.describe('A query id, e.g. "q_featured_posts"')
const Alias = CamelNameSchema.describe('The name the page binds the use by, e.g. "featured"')
const Order = z.object({ field: CamelNameSchema, direction: z.enum(['asc', 'desc']) })
const Condition = z.object({ op: z.enum(CONDITION_OPS), field: CamelNameSchema, value: ValueSchema })

/** Names the generated page script declares itself: a use can't take them. */
export const RESERVED = ['site', 'layout', 'route', 'form', 'props', 'toast', 'set', 'execute']

const spaced = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const moduleOfPage = (draft: Draft, page: PageFile) => {
  const entry = Object.entries(draft.model.modules).find(([, mod]) => mod.pages.includes(page))!
  return { name: entry[0], mod: entry[1] }
}

/** Every alias a page already uses. */
export const aliasesOf = (page: PageFile): string[] => [
  ...page.uses?.state ?? [], ...page.uses?.queries ?? [], ...page.uses?.actions ?? [], ...page.uses?.computed ?? []
].map(use => use.as)

export type UseKind = 'state' | 'query' | 'action' | 'computed'
type Declared = Array<{ name: string, by: string }>

/**
 * The names the generated page script declares for a use `as` of `kind` (generate/ui.ts, `pageFile`): the name itself, and what the
 * page derives from it: a state's setter `set<As>`, a query's loading flag `<as>Loading`, an action's `<as>Pending` and `<as>Error`.
 */
const declaredBy = (as: string, kind: UseKind): Declared => {
  const derived = kind === 'state' ? [[`set${pascal(as)}`, 'setter']] : kind === 'query' ? [[`${as}Loading`, 'loading flag']] : kind === 'action' ? [[`${as}Pending`, 'pending flag'], [`${as}Error`, 'error']] : []
  return [{ name: as, by: `"${as}"` }, ...derived.map(([name, what]) => ({ name: name!, by: `the ${what} of "${as}"` }))]
}

/**
 * Every name the page's script declares today: its uses and what they derive, the composables it calls, the handler of each
 * interaction (`on<Node><Event>`) and the counter of each List that loads more (`shown<Node>`).
 */
const declaredNames = (draft: Draft, page: PageFile): Declared => {
  const { name: module, mod } = moduleOfPage(draft, page)
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
    if (state) composable(stateComposableOf(module, state.name), `the composable of the state ${state.name}`)
  }
  for (const use of page.uses?.queries ?? []) {
    names.push(...declaredBy(use.as, 'query'))
    const query = mod.queries.find(entry => entry.id === use.query)
    if (query) composable(composableOf(query.name), `the composable of the query ${query.name}`)
  }
  for (const use of page.uses?.actions ?? []) {
    names.push(...declaredBy(use.as, 'action'))
    const action = mod.actions.find(entry => entry.id === use.action)
    if (action) composable(composableOf(action.name), `the composable of the action ${action.name}`)
  }
  for (const use of page.uses?.computed ?? []) names.push(...declaredBy(use.as, 'computed'))
  walk(page.root, (node) => {
    const id = pascal(node.id.replace(/^n_/, ''))
    for (const interaction of node.interactions ?? []) names.push({ name: `on${id}${pascal(interaction.on)}`, by: `the handler of ${node.id}'s ${interaction.on}` })
    if (node.type === 'List' && loadMoreSize(node.props?.loadMore) !== undefined) names.push({ name: `shown${id}`, by: `the counter of ${node.id}` })
  })
  return names
}

/**
 * Why the page's script can't declare `added` next to what it has: a name it uses itself, one Vue or Nuxt provides, or one declared
 * twice. Without `added`, the same for what it has. Undefined when it can.
 */
export const pageNameProblem = (draft: Draft, page: PageFile, added: Declared = []): string | undefined => {
  const seen = new Map<string, string>()
  const have = declaredNames(draft, page)
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

/** Why a page can't use `as` as the name of a use of `kind`, together with the names it derives, or undefined when it can. */
const aliasProblem = (draft: Draft, page: PageFile, as: string, kind: UseKind): string | undefined =>
  aliasesOf(page).includes(as) ? `The page already uses the name "${as}"` : pageNameProblem(draft, page, declaredBy(as, kind))

export const checkAlias = (draft: Draft, page: PageFile, as: string, kind: UseKind) => {
  const problem = aliasProblem(draft, page, as, kind)
  if (problem) fail('invalid', problem)
}

/** `base`, or `base2`, `base3`…: the first name of a use of `kind` the page can declare, with the names it derives. */
export const freeAlias = (draft: Draft, page: PageFile, base: string, kind: UseKind): string => {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}${n}`
    if (!aliasProblem(draft, page, candidate, kind)) return candidate
  }
}

/** The field names a query condition or ordering may name: the entity's, its key and its timestamps. */
const fieldNames = (entity: EntityFile): string[] => [...new Set(['id', ...entity.fields.map(field => field.name), ...(entity.timestamps ? ['createdAt', 'updatedAt'] : [])])]

const entityOf = (draft: Draft, id: string): EntityFile =>
  Object.values(draft.model.modules).flatMap(mod => mod.entities).find(entity => entity.id === id) ?? fail('not_found', `No entity "${id}"`)

export const findQuery = (draft: Draft, id: string): { query: QueryFile, module: string } => {
  for (const [module, mod] of Object.entries(draft.model.modules)) {
    const query = mod.queries.find(entry => entry.id === id)
    if (query) return { query, module }
  }
  return fail('not_found', `No query "${id}"`)
}

/** The page uses (anywhere in the model) that read query `id`. */
const usesOf = (draft: Draft, id: string): Array<{ page: PageFile, as: string }> =>
  draft.pages().flatMap(page => (page.uses?.queries ?? []).filter(use => use.query === id).map(use => ({ page, as: use.as })))

/**
 * Makes the page use action `actionId` (under its name, or the first free one) unless it already does, and returns the
 * name. A Form's `action` prop is set in the same edit as this use, so a refused edit leaves neither. An action that
 * isn't in the page's module gets no use: the model refuses the prop itself.
 */
export const useAction = (draft: Draft, page: PageFile, actionId: string): string | undefined => {
  const existing = page.uses?.actions?.find(use => use.action === actionId)
  if (existing) return existing.as
  const action = moduleOfPage(draft, page).mod.actions.find(entry => entry.id === actionId)
  if (!action) return undefined
  const as = freeAlias(draft, page, action.name, 'action')
  const uses = page.uses ??= {}
  ;(uses.actions ??= []).push({ as, action: actionId })
  return as
}

const checkParam = (query: QueryFile, value: Value | null | undefined, where: string) => {
  if (isObject(value) && typeof value.$param === 'string' && !query.params.some(param => param.name === value.$param)) fail('invalid', `${where}: the query has no parameter "${value.$param}"`)
}

// ── Editing a query ──────────────────────────────────────────────────────

const NUMERIC = ['integer', 'number']

/** What a query condition or ordering may name has this type: the entity's key, a timestamp, or the field's own. */
const typeOfField = (entity: EntityFile, name: string): string | undefined =>
  name === 'id' ? keyType(entity) : (name === 'createdAt' || name === 'updatedAt') && entity.timestamps ? 'datetime' : entity.fields.find(field => field.name === name)?.type

const checkParams = (params: QueryFile['params']) => {
  const seen = new Set<string>()
  for (const param of params) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(param.name) || isUnusable(param.name)) fail('invalid', `"${param.name}" can't be a parameter name: use camelCase, like "limit"`)
    if (seen.has(param.name)) fail('invalid', `Two parameters are named "${param.name}"`)
    seen.add(param.name)
    if (param.default !== undefined && !fits(param.type, param.default, false)) fail('invalid', `parameter ${param.name}: its default ${JSON.stringify(param.default)} doesn't fit ${param.type}`)
  }
}

/**
 * A condition's field and value against the entity: the field exists and a parameter it names is the query's; unless
 * `lenient`, a literal fits the field's type and a parameter has it. (The canvas's list filter sends a list's items as text,
 * so its edits, which name the page use they are for, keep the looser check they always had.)
 */
const checkCondition = (query: QueryFile, entity: EntityFile, where: NonNullable<QueryFile['where']>, lenient: boolean) => {
  const type = typeOfField(entity, where.field) ?? fail('invalid', `where: ${entity.name} has no field "${where.field}" (${fieldNames(entity).join(', ')})`)
  const value = where.value
  checkParam(query, value, 'where')
  if (lenient) return
  if (isObject(value) && typeof value.$param === 'string') {
    const param = query.params.find(entry => entry.name === value.$param)!
    if (param.type !== type && !(NUMERIC.includes(param.type) && NUMERIC.includes(type))) fail('invalid', `where: the parameter "${param.name}" is ${param.type} but ${where.field} is ${type}`)
  } else if (!isExpression(value)) {
    const values = where.op === 'in' && Array.isArray(value) ? value : [value]
    const bad = values.findIndex(item => !fits(type as never, item as Value, true))
    if (bad !== -1) fail('invalid', `where: ${JSON.stringify(values[bad])} doesn't fit ${where.field} (${type})`)
  }
}

// The name is checked in the edit, so a bad one is a refusal of the model (422), not of the input shape.
const AllowedParam = ParamSchema.omit({ from: true, name: true }).extend({ name: z.string().min(1).max(60) })

export const queryUpdate = defineEdit({
  input: z.object({
    query: QueryRef,
    page: PageRef.optional().describe('With as: the page use this edit is for. A query several uses read is copied for this use (q_<page>_<as>), so the others keep theirs; without them the query is edited in place'),
    as: Alias.optional(),
    inPlace: z.boolean().optional().describe('true: edit the query itself, never a copy (what the Data workspace does); refused together with page and as'),
    label: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional().describe('What the query returns, in words (the composable\'s doc comment); null removes it'),
    result: z.enum(['one', 'many']).optional().describe('one row or many; refused while a page reads the query, since it changes what the page binds'),
    params: z.array(AllowedParam).max(20).optional().describe('The whole list of parameters ({ name, type, default?, reactive? }); refused while the query, or a page\'s arguments, still use one it drops'),
    where: Condition.nullable().optional().describe('The condition rows must meet ({ op, field, value }, a value is a literal or { "$param": name }); null removes it'),
    orderBy: z.array(Order).nullable().optional().describe('The ordering, most significant first; null or [] removes it'),
    limit: ValueSchema.nullable().optional().describe('At most this many rows: a whole number or { "$param": name }; null removes the limit')
  }),
  apply: (draft, { query: id, page: pageId, as, inPlace, label, description, result, params, where, orderBy, limit }) => {
    if ((pageId === undefined) !== (as === undefined)) fail('invalid', 'page and as go together: they name the use the edit is for')
    if (inPlace && pageId !== undefined) fail('invalid', 'inPlace edits the query itself: page and as name a use to copy it for, so leave them out')
    const found = findQuery(draft, id)
    const { module } = found
    let { query } = found
    let forked = false
    if (pageId !== undefined && as !== undefined) {
      const { page } = draft.page(pageId)
      const use = page.uses?.queries?.find(entry => entry.as === as)
      if (!use || use.query !== id) fail('invalid', `Page "${page.name}" doesn't use ${id} as "${as}"`)
      if (usesOf(draft, id).length > 1) {
        const mod = draft.module(module)
        const copy: QueryFile = structuredClone(query)
        copy.id = draft.mint('q', `${page.name} ${as}`)
        copy.name = uniqueName(camel(`${page.name} ${as}`), mod.queries.map(entry => entry.name))
        copy.label = sentence(spaced(copy.name))
        mod.queries.push(copy)
        draft.place(copy.id, `.bildr/modules/${module}/queries`, kebab(copy.name))
        use!.query = copy.id
        query = copy
        forked = true
      }
    }
    const entity = entityOf(draft, query.from)
    const known = fieldNames(entity)
    const check = (field: string, what: string) => {
      if (!known.includes(field)) fail('invalid', `${what}: ${entity.name} has no field "${field}" (${known.join(', ')})`)
    }
    if (label !== undefined) query.label = label
    if (description !== undefined) {
      if (description === null) delete query.description
      else query.description = description
    }
    if (result !== undefined && result !== query.result) {
      const readers = artifactUsesOf(draft.model, query.id).filter(use => use.via === 'uses')
      if (readers.length) fail('invalid', `The query ${query.name} (${query.id}) is read by ${readers.map(use => `${use.kind} "${use.name}" (${use.id}) as "${use.as}"`).join(', ')}: changing it to ${result} changes what they bind. Change them first`)
      query.result = result
    }
    if (params !== undefined) {
      checkParams(params)
      query.params = params.map(param => ({ ...param }))
    }
    if (where !== undefined) {
      if (where === null) delete query.where
      else {
        checkCondition(query, entity, where, pageId !== undefined)
        query.where = where
      }
    }
    if (orderBy !== undefined) {
      if (!orderBy?.length) delete query.orderBy
      else {
        orderBy.forEach(order => check(order.field, 'orderBy'))
        query.orderBy = orderBy
      }
    }
    if (limit !== undefined) {
      if (limit === null) delete query.limit
      else if (typeof limit === 'number') {
        if (!Number.isInteger(limit) || limit < 0) fail('invalid', 'limit is a whole number of rows, 0 or more')
        query.limit = limit
      } else if (isObject(limit) && typeof limit.$param === 'string') {
        checkParam(query, limit, 'limit')
        query.limit = limit
      } else fail('invalid', 'limit is a whole number or { "$param": name }')
    }
    // A parameter a limit reads is a number of rows, whichever edit made it so.
    const limitParam = isObject(query.limit) && typeof query.limit.$param === 'string' ? query.params.find(param => param.name === (query.limit as { $param: string }).$param) : undefined
    if ((params !== undefined || limit !== undefined) && limitParam && !NUMERIC.includes(limitParam.type)) fail('invalid', `limit: the parameter "${limitParam.name}" is ${limitParam.type}, but a limit is a number of rows (integer or number)`)
    if (params !== undefined) {
      // What the query reads, and the arguments pages give, must still be parameters, of a type that fits where they are used.
      if (query.where) {
        checkParam(query, query.where.value, 'where')
        if (pageId === undefined) checkCondition(query, entity, query.where, false)
      }
      checkParam(query, query.limit, 'limit')
      for (const page of draft.pages()) {
        for (const use of (page.uses?.queries ?? []).filter(entry => entry.query === query.id)) {
          for (const [name, value] of Object.entries(use.args ?? {})) {
            const param = query.params.find(entry => entry.name === name)
            if (!param || value === null) continue
            const text = !NUMERIC.includes(param.type) && param.type !== 'boolean'
            const route = isObject(value) && '$route' in value
            const literal = !isExpression(value)
            if ((literal && !fits(param.type, value, true)) || (route && !text)) fail('invalid', `The query ${query.name} (${query.id}) takes "${name}" as ${param.type}, but page "${page.name}" (${page.id}) passes ${JSON.stringify(value)} as "${use.as}": change it first`)
          }
        }
      }
      const names = new Set(query.params.map(param => param.name))
      const passing = draft.pages().flatMap(page => (page.uses?.queries ?? [])
        .filter(use => use.query === query.id && Object.keys(use.args ?? {}).some(name => !names.has(name)))
        .map(use => `page "${page.name}" (${page.id}) passes it as "${use.as}"`))
      if (passing.length) fail('invalid', `The query ${query.name} (${query.id}) would no longer take every argument it is given, but ${passing.join(', ')}: change them first`)
    }
    return { queryId: query.id, forked }
  }
})

/** A list's query: `q_<page>_<as>` over an entity, used by the page as `as`; with nodeId it becomes that List's items. */
export const queryCreateForList = defineEdit({
  input: z.object({
    page: PageRef,
    entity: ArtifactIdSchema.describe('The entity whose rows the list shows'),
    as: Alias.optional().describe('The name the page binds the rows by (default: the entity\'s plural, or the first free one: "posts", "posts2"…). A name the page already uses is refused'),
    nodeId: LocalIdSchema.optional().describe('A List node of the page to bind: its items become the new rows, and its item name the entity\'s name unless it has a name of its own')
  }),
  apply: (draft, { page: pageId, entity: entityId, as: given, nodeId }) => {
    const { page } = draft.page(pageId)
    const { name: module, mod } = moduleOfPage(draft, page)
    const entity = mod.entities.find(entry => entry.id === entityId) ?? fail('invalid', `${entityOf(draft, entityId).name} isn't in module "${module}", where the page is: a page reads the queries of its own module`)
    const repository = mod.repositories.find(entry => entry.entity === entityId)
    if (!repository?.expose?.list || !repository.operations.includes('list')) fail('invalid', `${entity.name} has no list the app can read: expose its list in the collection's JSON tab, under Repository`)
    let list: ModelNode | undefined
    if (nodeId !== undefined) {
      walk(page.root, (node) => {
        if (node.id === nodeId) list = node
      })
      if (!list) fail('not_found', `Node "${nodeId}" not found in ${page.id}`)
      if (list!.type !== 'List') fail('invalid', `Node "${nodeId}" is a ${list!.type}, not a List`)
    }
    const as = given ?? freeAlias(draft, page, entity.plural, 'query')
    checkAlias(draft, page, as, 'query')
    const query: QueryFile = {
      id: draft.mint('q', `${page.name} ${as}`),
      name: uniqueName(camel(`${page.name} ${as}`), mod.queries.map(entry => entry.name)),
      label: sentence(spaced(`${page.name} ${as}`)),
      from: entityId,
      params: [],
      result: 'many'
    }
    mod.queries.push(query)
    draft.place(query.id, `.bildr/modules/${module}/queries`, kebab(query.name))
    const uses = page.uses ??= {}
    ;(uses.queries ??= []).push({ as, query: query.id })
    if (list) {
      const props: Record<string, Value> = { ...list.props, items: { $bind: as } }
      // The palette's List starts with the item name "item": the entity's name suits it better.
      if (typeof props.as !== 'string' || props.as === 'item') props.as = camel(entity.name)
      list.props = props
    }
    return { queryId: query.id, as }
  }
})

// ── Queries of their own (D10a) ─────────────────────────────────────────────

export const queryCreate = defineEdit({
  input: z.object({
    module: ModuleNameSchema.optional().describe('The module it belongs to: the one of its entity (a module\'s queries read its own entities)'),
    entity: ArtifactIdSchema.describe('The entity whose rows it reads (ent_*); it needs an exposed list'),
    result: z.enum(['one', 'many']).describe('many: all the entity\'s rows, to be narrowed with query_update; one: the row whose id is the id parameter'),
    name: z.string().min(1).max(60).describe('camelCased, e.g. "recent posts" → "recentPosts"; unique among the module\'s queries and actions. The client composable is use<Name>; the id is q_<name>'),
    label: z.string().min(1).max(100).optional().describe('A human name; defaults to the name in words')
  }),
  apply: (draft, { module: given, entity: entityId, result, name: givenName, label }) => {
    if (given !== undefined) draft.module(given)
    const { entity, module: owner } = entityById(draft, entityId)
    const module = given ?? owner
    if (module !== owner) fail('invalid', `${entity.name} isn't in module "${module}": a module's queries read its own entities`)
    const mod = draft.module(module)
    const repository = repositoryOf(draft, entityId)
    if (!repository?.expose?.list || !repository.operations.includes('list')) fail('invalid', `${entity.name} has no list the app can read: expose its list in the collection's JSON tab, under Repository`)
    const name = callableName(givenName, 'query')
    checkCallableFree(draft, module, name)
    checkQueryName(name)
    const query: QueryFile = {
      id: draft.mint('q', name),
      name,
      label: label ?? sentence(spaced(name)),
      from: entityId,
      params: result === 'one' ? [{ name: 'id', type: keyType(entity), reactive: true }] : [],
      ...(result === 'one' ? { where: { op: 'eq' as const, field: 'id', value: { $param: 'id' } } } : {}),
      result
    }
    mod.queries.push(query)
    const filePath = draft.place(query.id, `.bildr/modules/${module}/queries`, kebab(name))
    return { queryId: query.id, filePath }
  }
})

export const queryRename = defineEdit({
  input: z.object({
    query: QueryRef,
    name: z.string().min(1).max(60).describe('The new name, camelCased; unique among the module\'s queries and actions')
  }),
  apply: (draft, { query: id, name: given }) => {
    const { query, module } = findQuery(draft, id)
    const name = callableName(given, 'query')
    checkCallableFree(draft, module, name, id)
    checkQueryName(name)
    const previousName = query.name
    // Pages hold the id and their own alias, so nothing else in the model names it: only the generated composable changes.
    query.name = name
    return { queryId: id, name, previousName, composable: composableOf(name), previousComposable: composableOf(previousName) }
  }
})

export const queryDelete = defineEdit({
  input: z.object({ query: QueryRef }),
  apply: (draft, { query: id }) => {
    const { query, module } = findQuery(draft, id)
    const uses = artifactUsesOf(draft.model, id)
    if (uses.length) fail('invalid', `Query ${query.name} (${id}) is still used: ${describeUses(uses)}. Change them first`)
    const mod = draft.module(module)
    mod.queries.splice(mod.queries.indexOf(query), 1)
    return { deleted: [id] }
  }
})

// ── What a page uses ──────────────────────────────────────────────────────

/** The names the page's own tree, computed values and SEO bind (`$bind` paths and `$template` parts), by root, a List's item names too. */
const boundRoots = (page: PageFile): Set<string> => {
  const roots = new Set<string>()
  const collect = (path: string) => {
    roots.add(rootOf(path))
    return undefined
  }
  walk(page.root, node => mapNodePaths(node, collect))
  mapPaths(page.uses?.computed, collect)
  mapPaths(page.uses?.queries?.map(use => use.args), collect)
  mapPaths(page.seo, collect)
  return roots
}

/**
 * Drops the uses of `page` of a state or an action named in `named` (ids) that nothing needs any more: no binding of the name the
 * page uses it under, and no node whose interactions set the state or run the action, or (for an action) whose props hold it (a Form).
 * What an interaction edit calls after it takes steps away. Returns what it dropped, as `addedUses` lists what a step adds.
 */
export const dropUnusedUses = (page: PageFile, named: { state: ReadonlySet<string>, action: ReadonlySet<string> }): Array<{ as: string, state: string } | { as: string, action: string }> => {
  const uses = page.uses
  if (!uses) return []
  const bound = boundRoots(page)
  const held = (id: string, props: boolean) => {
    let found = false
    walk(page.root, (node) => {
      if (mentions(node.interactions, id) || (props && mentions(node.props, id))) found = true
    })
    return found
  }
  const dropped: Array<{ as: string, state: string } | { as: string, action: string }> = []
  for (const use of (uses.state ?? []).filter(entry => named.state.has(entry.state) && !bound.has(entry.as) && !held(entry.state, false))) {
    uses.state = uses.state!.filter(entry => entry !== use)
    dropped.push({ as: use.as, state: use.state })
  }
  for (const use of (uses.actions ?? []).filter(entry => named.action.has(entry.action) && !bound.has(entry.as) && !held(entry.action, true))) {
    uses.actions = uses.actions!.filter(entry => entry !== use)
    dropped.push({ as: use.as, action: use.action })
  }
  if (!uses.state?.length) delete uses.state
  if (!uses.actions?.length) delete uses.actions
  if (!Object.keys(uses).length) delete page.uses
  return dropped
}

const mentions = (value: unknown, id: string): boolean => typeof value === 'string' ? value === id : !!value && typeof value === 'object' && Object.values(value).some(item => mentions(item, id))

const checkArgs = (query: QueryFile, args: Record<string, Value | null>) => {
  for (const name of Object.keys(args)) if (!query.params.some(param => param.name === name)) fail('invalid', `The query ${query.id} has no parameter "${name}" (${query.params.map(param => param.name).join(', ') || 'none'})`)
}

export const pageUseAdd = defineEdit({
  input: z.object({
    page: PageRef,
    as: Alias,
    query: QueryRef.optional().describe('A query of the page\'s module to read'),
    action: ArtifactIdSchema.optional().describe('An action of the page\'s module its forms and buttons can run'),
    state: ArtifactIdSchema.optional().describe('A state of the page\'s module its nodes can bind (as.field) and set (a setState step); a page uses a state once'),
    args: z.record(CamelNameSchema, ValueSchema).optional().describe('With a query: its parameters\' values, e.g. { "limit": 6 } or { "slug": { "$route": "slug" } }')
  }),
  apply: (draft, { page: pageId, as, query: queryId, action: actionId, state: stateId, args }) => {
    if ([queryId, actionId, stateId].filter(given => given !== undefined).length !== 1) fail('invalid', 'Give one query, action or state to use')
    const { page } = draft.page(pageId)
    const { mod } = moduleOfPage(draft, page)
    checkAlias(draft, page, as, stateId !== undefined ? 'state' : queryId !== undefined ? 'query' : 'action')
    if (stateId !== undefined) {
      if (args) fail('invalid', 'A state use takes no args')
      if (!mod.state.some(entry => entry.id === stateId)) fail('not_found', `No state "${stateId}" in the page's module`)
      const used = page.uses?.state?.find(entry => entry.state === stateId)
      if (used) fail('invalid', `The page already uses ${stateId} as "${used.as}"`)
      ;((page.uses ??= {}).state ??= []).push({ as, state: stateId })
      return { as }
    }
    const uses = page.uses ??= {}
    if (queryId !== undefined) {
      const query = mod.queries.find(entry => entry.id === queryId) ?? fail('not_found', `No query "${queryId}" in the page's module`)
      if (args) checkArgs(query, args)
      ;(uses.queries ??= []).push({ as, query: queryId, ...(args && Object.keys(args).length ? { args } : {}) })
    } else {
      if (args) fail('invalid', 'An action use takes no args')
      if (!mod.actions.some(entry => entry.id === actionId)) fail('not_found', `No action "${actionId}" in the page's module`)
      ;(uses.actions ??= []).push({ as, action: actionId! })
    }
    return { as }
  }
})

export const pageUseUpdate = defineEdit({
  input: z.object({
    page: PageRef,
    as: Alias,
    args: z.record(CamelNameSchema, ValueSchema.nullable()).describe('The query parameters to set (a value or an expression); null removes one, so its default applies')
  }),
  apply: (draft, { page: pageId, as, args }) => {
    const { page } = draft.page(pageId)
    const use = page.uses?.queries?.find(entry => entry.as === as) ?? fail('not_found', `Page "${page.name}" doesn't read a query as "${as}"`)
    const query = draft.module(moduleOfPage(draft, page).name).queries.find(entry => entry.id === use.query)!
    checkArgs(query, args)
    const kept: Record<string, Value> = {}
    for (const [name, value] of Object.entries({ ...use.args, ...args })) if (value !== null) kept[name] = value
    if (Object.keys(kept).length) use.args = kept
    else delete use.args
    return {}
  }
})

export const pageUseRemove = defineEdit({
  input: z.object({
    page: PageRef,
    as: Alias.optional().describe('The name the page uses it under'),
    state: ArtifactIdSchema.optional().describe('A state the page uses, instead of its name')
  }),
  apply: (draft, { page: pageId, as: given, state: stateId }) => {
    const { page } = draft.page(pageId)
    const uses = page.uses
    if (given === undefined && stateId === undefined) fail('invalid', 'Give the name the page uses (as), or the state it uses (state)')
    const state = stateId === undefined
      ? uses?.state?.find(entry => entry.as === given)
      : uses?.state?.find(entry => entry.state === stateId)
    if (stateId !== undefined) {
      if (!state) fail('not_found', `Page "${page.name}" doesn't use the state "${stateId}"`)
      if (given !== undefined && state!.as !== given) fail('invalid', `Page "${page.name}" uses ${stateId} as "${state!.as}", not "${given}"`)
    }
    const as = state?.as ?? given!
    const query = state ? undefined : uses?.queries?.find(entry => entry.as === as)
    const action = state ? undefined : uses?.actions?.find(entry => entry.as === as)
    if (!query && !action && !state) fail('not_found', `Page "${page.name}" doesn't read a query, run an action or use a state as "${as}"`)
    if (boundRoots(page).has(as)) fail('invalid', `The page still binds "${as}": change what reads it first`)
    if (state) {
      const holders: string[] = []
      walk(page.root, (node) => {
        if (mentions(node.interactions, state.state)) holders.push(node.id)
      })
      if (holders.length) fail('invalid', `${holders.join(', ')} set the state ${state.state} through "${as}": change them first`)
    }
    if (action) {
      const holders: string[] = []
      walk(page.root, (node) => {
        if (mentions(node.props, action.action) || mentions(node.interactions, action.action)) holders.push(node.id)
      })
      if (holders.length) fail('invalid', `${holders.join(', ')} run the action ${action.action} through "${as}": change them first`)
    }
    if (query) uses!.queries = uses!.queries!.filter(entry => entry !== query)
    if (action) uses!.actions = uses!.actions!.filter(entry => entry !== action)
    if (state) uses!.state = uses!.state!.filter(entry => entry !== state)
    if (!uses!.queries?.length) delete uses!.queries
    if (!uses!.actions?.length) delete uses!.actions
    if (!uses!.state?.length) delete uses!.state
    if (!Object.keys(uses!).length) delete page.uses
    return {}
  }
})
