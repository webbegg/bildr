import { z } from 'zod'
import { ArtifactIdSchema, CamelNameSchema, CONDITION_OPS, LocalIdSchema, ModuleNameSchema, ParamSchema, ValueSchema } from '../model/schemas.ts'
import type { ApiQuery, DataSourceFile, EntityFile, ModelNode, PageFile, QueryFile, Value } from '../model/schemas.ts'
import { apiQueryOf } from './api-uses.ts'
import { mapNodePaths, mapPaths, rootOf } from './bindings.ts'
import { camel, defineEdit, fail, isObject, kebab, uniqueName } from './core.ts'
import type { Draft } from './core.ts'
import { datasourceById } from './datasources.ts'
import { basicTypeOf } from '../model/field-types.ts'
import { entityById, fits, fitsField, isExpression, keyType, repositoryOf } from './entities.ts'
import { apiComposableName, composableOf } from '../generate/names.ts'
import { callableName, checkCallableFree, checkQueryName, isUnusable, sentence, spaced } from './naming.ts'
import { aliasesOf, apiArgsProblem, declaredBy, moduleOfPageIn, nodeNames, pageNamesProblem, RESERVED } from './page-uses.ts'
import type { ApiArgsOptions, Declared, UseKind } from './page-uses.ts'
import { PageRef } from './pages.ts'
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

export { RESERVED }

export const moduleOfPage = (draft: Draft, page: PageFile) => moduleOfPageIn(draft.model, page)

/** A page use that `page_use_add` or a step makes: the state or the action, with the name the page uses it under. What `addedUses` and `droppedUses` list. */
export type UseRef = { as: string, state: string } | { as: string, action: string }

/** The names the page's script declares for its nodes (the handlers and the load-more counters), for the editor to leave out when it offers a name. */
export const pageNodeNames = (page: PageFile): string[] => nodeNames(page).map(entry => entry.name)

/**
 * Why the page's script can't declare `added` next to what it has: a name it uses itself, one Vue or Nuxt provides, or one declared
 * twice. Without `added`, the same for what it has. Undefined when it can.
 */
export const pageNameProblem = (draft: Draft, page: PageFile, added: Declared = []): string | undefined => pageNamesProblem(draft.model, page, added)

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

export const findQuery = (draft: Draft, id: string): { query: QueryFile, module: string } => {
  for (const [module, mod] of Object.entries(draft.model.modules)) {
    const query = mod.queries.find(entry => entry.id === id)
    if (query) return { query, module }
  }
  return fail('not_found', `No query "${id}"`)
}

/** The page uses (anywhere in the model) that read query `id`: a page and the name it reads it under. (`usesOf` of usage.ts is everything that mentions an artifact.) */
const readersOfQuery = (draft: Draft, id: string): Array<{ page: PageFile, as: string }> =>
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

/** What a query condition or ordering may name has this type: the entity's key, a timestamp, or the field's own (a select with its options). */
const fieldTypeOf = (entity: EntityFile, name: string): Pick<EntityFile['fields'][number], 'type' | 'options'> | undefined => {
  if (name === 'id') return { type: keyType(entity) }
  if ((name === 'createdAt' || name === 'updatedAt') && entity.timestamps) return { type: 'datetime' }
  return entity.fields.find(field => field.name === name)
}

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
  const field = fieldTypeOf(entity, where.field) ?? fail('invalid', `where: ${entity.name} has no field "${where.field}" (${fieldNames(entity).join(', ')})`)
  const type = field.type
  const value = where.value
  checkParam(query, value, 'where')
  if (lenient) return
  if (isObject(value) && typeof value.$param === 'string') {
    const param = query.params.find(entry => entry.name === value.$param)!
    // A parameter has a basic type: text for an email or a select, a number for money (verify B2).
    const basic = basicTypeOf(type)
    if (param.type !== basic && !(NUMERIC.includes(param.type) && NUMERIC.includes(basic))) fail('invalid', `where: the parameter "${param.name}" is ${param.type} but ${where.field} is ${type}`)
  } else if (!isExpression(value)) {
    const values = where.op === 'in' && Array.isArray(value) ? value : [value]
    const bad = values.findIndex(item => !fitsField(field, item as Value, true))
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
      if (readersOfQuery(draft, id).length > 1) {
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
    const { entity } = entityById(draft, query.from)
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
    const entity = mod.entities.find(entry => entry.id === entityId) ?? fail('invalid', `${entityById(draft, entityId).entity.name} isn't in module "${module}", where the page is: a page reads the queries of its own module`)
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
  mapPaths(page.uses?.apis?.map(use => use.args), collect)
  mapPaths(page.seo, collect)
  return roots
}

/**
 * Drops the uses of `page` of a state or an action named in `named` (ids) that nothing needs any more: no binding of the name the
 * page uses it under, and no node whose interactions set the state or run the action, or (for an action) whose props hold it (a Form).
 * What an interaction edit calls after it takes steps away. Returns what it dropped, as `addedUses` lists what a step adds.
 */
export const dropUnusedUses = (page: PageFile, named: { state: ReadonlySet<string>, action: ReadonlySet<string> }): UseRef[] => {
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
  const dropped: UseRef[] = []
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

/**
 * The API data source `id` and its query `name`: refused when it isn't an API source or has no such query. What a page use of an API
 * query (`uses.apis`) reads, and what `checkApiArgs` checks its arguments against.
 */
const apiQueryIn = (draft: Draft, id: string, name: string) => {
  const source = datasourceById(draft, id)
  if (source.kind !== 'api') fail('invalid', `"${source.name}" is not an API data source`)
  return apiQueryOf(draft.model.datasources, { datasource: id, query: name }) ?? fail('not_found', `No query "${name}" in ${source.name}`)
}

/**
 * The arguments a page gives an API query against its parameters (`apiArgsProblem`): only its own (path and query), each value of the
 * parameter's type as the generated TypeScript sees it, and with `complete` every required one present. Given the page, what a value
 * reads is checked too.
 */
export const checkApiArgs = (source: DataSourceFile, query: ApiQuery, args: Record<string, Value | null> | undefined, options: ApiArgsOptions = {}) => {
  const problem = apiArgsProblem(source, query, args, options)
  if (problem) fail('invalid', problem)
}

/** One use of a page, whatever its kind: the artifact it reads, runs or holds (`id`), the name the page uses it under, and its entry in `page.uses`. */
interface FoundUse {
  kind: 'state' | 'query' | 'api' | 'action'
  as: string
  id: string
  entry: object
}

/** The uses of a page: its states, queries and actions. */
const usesOfPage = (page: PageFile): FoundUse[] => [
  ...(page.uses?.state ?? []).map(entry => ({ kind: 'state' as const, as: entry.as, id: entry.state, entry })),
  ...(page.uses?.queries ?? []).map(entry => ({ kind: 'query' as const, as: entry.as, id: entry.query, entry })),
  ...(page.uses?.apis ?? []).map(entry => ({ kind: 'api' as const, as: entry.as, id: entry.datasource, entry })),
  ...(page.uses?.actions ?? []).map(entry => ({ kind: 'action' as const, as: entry.as, id: entry.action, entry }))
]

/** The use of the page under the name `as`, or the use of state `state`, of any of the three kinds. */
const findUse = (page: PageFile, by: { as?: string, state?: string }): FoundUse | undefined =>
  usesOfPage(page).find(use => by.state !== undefined ? use.kind === 'state' && use.id === by.state : use.as === by.as)

/** Takes `found` out of the page's uses, and leaves no empty list or `uses` behind. */
const removeUse = (page: PageFile, found: FoundUse) => {
  const uses = page.uses!
  if (found.kind === 'state') {
    uses.state = uses.state!.filter(entry => entry !== found.entry)
    if (!uses.state.length) delete uses.state
  } else if (found.kind === 'query') {
    uses.queries = uses.queries!.filter(entry => entry !== found.entry)
    if (!uses.queries.length) delete uses.queries
  } else if (found.kind === 'api') {
    uses.apis = uses.apis!.filter(entry => entry !== found.entry)
    if (!uses.apis.length) delete uses.apis
  } else {
    uses.actions = uses.actions!.filter(entry => entry !== found.entry)
    if (!uses.actions.length) delete uses.actions
  }
  if (!Object.keys(uses).length) delete page.uses
}

export const pageUseAdd = defineEdit({
  input: z.object({
    page: PageRef,
    as: Alias,
    query: QueryRef.optional().describe('A query of the page\'s module to read'),
    action: ArtifactIdSchema.optional().describe('An action of the page\'s module its forms and buttons can run'),
    state: ArtifactIdSchema.optional().describe('A state of the page\'s module its nodes can bind (as.field) and set (a Set state step); a page uses a state once'),
    api: z.object({
      datasource: ArtifactIdSchema.describe('An API data source id (kind "api"), e.g. "ds_shop"'),
      query: CamelNameSchema.describe('The name of one of its queries, e.g. "products"')
    }).optional().describe('A query of an API data source to read: it answers as <as> (a list, or one record), with <as>Loading and <as>Error'),
    args: z.record(CamelNameSchema, ValueSchema).optional().describe('With a query: its parameters\' values, e.g. { "limit": 6 } or { "slug": { "$route": "slug" } }; with an API query: its path and query parameters, the required ones included')
  }),
  apply: (draft, { page: pageId, as, query: queryId, action: actionId, state: stateId, api, args }) => {
    const given = ([['state', stateId], ['query', queryId], ['action', actionId], ['api', api]] as const).filter(([, id]) => id !== undefined)
    if (given.length !== 1) fail('invalid', 'Give one query, action, state or API query to use')
    const [kind, given0] = given[0]!
    const { page } = draft.page(pageId)
    checkAlias(draft, page, as, kind)
    if (kind === 'api') {
      const { datasource, query: name } = api!
      const { source, query } = apiQueryIn(draft, datasource, name)
      checkApiArgs(source, query, args, { page, states: moduleOfPage(draft, page).mod.state, as })
      // The page calls the query's composable, which can't share a name with anything else the script declares (unless it already calls it).
      if (!page.uses?.apis?.some(use => use.datasource === datasource && use.query === name)) {
        const problem = pageNameProblem(draft, page, [{ name: apiComposableName(source.name, name), by: `the name the query ${name} of the API ${source.name} generates` }])
        if (problem) fail('invalid', problem)
      }
      const uses = page.uses ??= {}
      ;(uses.apis ??= []).push({ as, datasource, query: name, ...(args && Object.keys(args).length ? { args } : {}) })
      return { as }
    }
    const id = given0 as string
    const { mod } = moduleOfPage(draft, page)
    if (kind !== 'query' && args) fail('invalid', `${kind === 'state' ? 'A state' : 'An action'} use takes no args`)
    const known: Array<{ id: string }> = { state: mod.state, query: mod.queries, action: mod.actions }[kind]
    if (!known.some(entry => entry.id === id)) fail('not_found', `No ${kind} "${id}" in the page's module`)
    const used = kind === 'state' ? findUse(page, { state: id }) : undefined
    if (used) fail('invalid', `The page already uses ${id} as "${used.as}"`)
    if (kind === 'query' && args) checkArgs(mod.queries.find(entry => entry.id === id)!, args)
    const uses = page.uses ??= {}
    if (kind === 'state') (uses.state ??= []).push({ as, state: id })
    else if (kind === 'query') (uses.queries ??= []).push({ as, query: id, ...(args && Object.keys(args).length ? { args } : {}) })
    else (uses.actions ??= []).push({ as, action: id })
    return { as }
  }
})

export const pageUseUpdate = defineEdit({
  input: z.object({
    page: PageRef,
    as: Alias,
    args: z.record(CamelNameSchema, ValueSchema.nullable()).describe('The query parameters to set (a value or an expression); null removes one, so its default applies (an API query\'s required parameter can\'t be removed)')
  }),
  apply: (draft, { page: pageId, as, args }) => {
    const { page } = draft.page(pageId)
    const apiUse = page.uses?.apis?.find(entry => entry.as === as)
    if (apiUse) {
      const { source, query } = apiQueryIn(draft, apiUse.datasource, apiUse.query)
      const kept: Record<string, Value> = {}
      for (const [name, value] of Object.entries({ ...apiUse.args, ...args })) if (value !== null) kept[name] = value
      checkApiArgs(source, query, { ...kept, ...args }, { page, states: moduleOfPage(draft, page).mod.state, as })
      if (Object.keys(kept).length) apiUse.args = kept
      else delete apiUse.args
      return {}
    }
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
    if (given === undefined && stateId === undefined) fail('invalid', 'Give the name the page uses (as), or the state it uses (state)')
    const found = findUse(page, { as: given, state: stateId })
    if (stateId !== undefined) {
      if (!found) fail('not_found', `Page "${page.name}" doesn't use the state "${stateId}"`)
      if (given !== undefined && found!.as !== given) fail('invalid', `Page "${page.name}" uses ${stateId} as "${found!.as}", not "${given}"`)
    }
    if (!found) fail('not_found', `Page "${page.name}" doesn't read a query, run an action or use a state as "${given}"`)
    const { kind, as, id } = found!
    if (boundRoots(page).has(as)) fail('invalid', `The page still binds "${as}": change what reads it first`)
    // What holds it besides a binding: a node that sets the state or runs the action (a Form holds its action in its props).
    if (kind === 'state' || kind === 'action') {
      const holders: string[] = []
      walk(page.root, (node) => {
        if (mentions(node.interactions, id) || (kind === 'action' && mentions(node.props, id))) holders.push(node.id)
      })
      if (holders.length) fail('invalid', `${holders.join(', ')} ${kind === 'state' ? 'set the state' : 'run the action'} ${id} through "${as}": change them first`)
    }
    removeUse(page, found!)
    return {}
  }
})
