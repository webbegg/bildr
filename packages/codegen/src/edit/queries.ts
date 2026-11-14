import { z } from 'zod'
import { ArtifactIdSchema, CamelNameSchema, CONDITION_OPS, LocalIdSchema, ValueSchema } from '../model/schemas.ts'
import type { EntityFile, ModelNode, PageFile, QueryFile, Value } from '../model/schemas.ts'
import { mapNodePaths, mapPaths, rootOf } from './bindings.ts'
import { camel, defineEdit, fail, kebab, uniqueName } from './core.ts'
import type { Draft } from './core.ts'
import { PageRef } from './pages.ts'
import { walk } from './tree.ts'

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
const RESERVED = ['site', 'layout', 'route', 'form', 'props', 'toast', 'set', 'execute']

const spaced = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const moduleOfPage = (draft: Draft, page: PageFile) => {
  const entry = Object.entries(draft.model.modules).find(([, mod]) => mod.pages.includes(page))!
  return { name: entry[0], mod: entry[1] }
}

/** Every alias a page already uses. */
const aliasesOf = (page: PageFile): string[] => [
  ...page.uses?.state ?? [], ...page.uses?.queries ?? [], ...page.uses?.actions ?? [], ...page.uses?.computed ?? []
].map(use => use.as)

const checkAlias = (page: PageFile, as: string) => {
  if (RESERVED.includes(as)) fail('invalid', `"${as}" is a name the page's script uses itself: pick another`)
  if (aliasesOf(page).includes(as)) fail('invalid', `The page already uses the name "${as}"`)
}

/** The field names a query condition or ordering may name: the entity's, its key and its timestamps. */
const fieldNames = (entity: EntityFile): string[] => [...new Set(['id', ...entity.fields.map(field => field.name), ...(entity.timestamps ? ['createdAt', 'updatedAt'] : [])])]

const entityOf = (draft: Draft, id: string): EntityFile =>
  Object.values(draft.model.modules).flatMap(mod => mod.entities).find(entity => entity.id === id) ?? fail('not_found', `No entity "${id}"`)

const findQuery = (draft: Draft, id: string): { query: QueryFile, module: string } => {
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
  const as = uniqueName(action.name, [...aliasesOf(page), ...RESERVED])
  const uses = page.uses ??= {}
  ;(uses.actions ??= []).push({ as, action: actionId })
  return as
}

const checkParam = (query: QueryFile, value: Value | null | undefined, where: string) => {
  if (isObject(value) && typeof value.$param === 'string' && !query.params.some(param => param.name === value.$param)) fail('invalid', `${where}: the query has no parameter "${value.$param}"`)
}

// ── Editing a query ──────────────────────────────────────────────────────

export const queryUpdate = defineEdit({
  input: z.object({
    query: QueryRef,
    page: PageRef.optional().describe('With as: the page use this edit is for. A query several uses read is copied for this use (q_<page>_<as>), so the others keep theirs; without them the query is edited in place'),
    as: Alias.optional(),
    label: z.string().min(1).max(100).optional(),
    where: Condition.nullable().optional().describe('The condition rows must meet ({ op, field, value }, a value is a literal or { "$param": name }); null removes it'),
    orderBy: z.array(Order).nullable().optional().describe('The ordering, most significant first; null or [] removes it'),
    limit: ValueSchema.nullable().optional().describe('At most this many rows: a whole number or { "$param": name }; null removes the limit')
  }),
  apply: (draft, { query: id, page: pageId, as, label, where, orderBy, limit }) => {
    if ((pageId === undefined) !== (as === undefined)) fail('invalid', 'page and as go together: they name the use the edit is for')
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
    if (where !== undefined) {
      if (where === null) delete query.where
      else {
        check(where.field, 'where')
        checkParam(query, where.value, 'where')
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
    if (!repository?.expose?.list || !repository.operations.includes('list')) fail('invalid', `${entity.name} has no list the app can read: expose its list in the Model screen first`)
    let list: ModelNode | undefined
    if (nodeId !== undefined) {
      walk(page.root, (node) => {
        if (node.id === nodeId) list = node
      })
      if (!list) fail('not_found', `Node "${nodeId}" not found in ${page.id}`)
      if (list!.type !== 'List') fail('invalid', `Node "${nodeId}" is a ${list!.type}, not a List`)
    }
    const as = given ?? uniqueName(entity.plural, [...aliasesOf(page), ...RESERVED])
    checkAlias(page, as)
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
  mapPaths(page.seo, collect)
  return roots
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
    args: z.record(CamelNameSchema, ValueSchema).optional().describe('With a query: its parameters\' values, e.g. { "limit": 6 } or { "slug": { "$route": "slug" } }')
  }),
  apply: (draft, { page: pageId, as, query: queryId, action: actionId, args }) => {
    if ((queryId === undefined) === (actionId === undefined)) fail('invalid', 'Give a query or an action to use, not both')
    const { page } = draft.page(pageId)
    const { mod } = moduleOfPage(draft, page)
    checkAlias(page, as)
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
  input: z.object({ page: PageRef, as: Alias }),
  apply: (draft, { page: pageId, as }) => {
    const { page } = draft.page(pageId)
    const uses = page.uses
    const query = uses?.queries?.find(entry => entry.as === as)
    const action = uses?.actions?.find(entry => entry.as === as)
    if (!query && !action) fail('not_found', `Page "${page.name}" doesn't read a query or run an action as "${as}"`)
    if (boundRoots(page).has(as)) fail('invalid', `The page still binds "${as}": change what reads it first`)
    if (action) {
      const holders: string[] = []
      walk(page.root, (node) => {
        if (mentions(node.props, action.action) || mentions(node.interactions, action.action)) holders.push(node.id)
      })
      if (holders.length) fail('invalid', `${holders.join(', ')} run the action ${action.action} through "${as}": change them first`)
    }
    if (query) uses!.queries = uses!.queries!.filter(entry => entry !== query)
    if (action) uses!.actions = uses!.actions!.filter(entry => entry !== action)
    if (!uses!.queries?.length) delete uses!.queries
    if (!uses!.actions?.length) delete uses!.actions
    if (!Object.keys(uses!).length) delete page.uses
    return {}
  }
})
