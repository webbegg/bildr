import { z } from 'zod'
import { API_PATH, API_PATH_HINT, API_PATH_MAX, apiUrlProblem } from '../data/apiSource'
import { PAGE_SIZE_MAX, PAGING_PARAM, PAGING_PARAM_HINT } from '../data/paging'
import { ENDPOINT_METHODS, endpointPathProblem } from '../data/remote'
import { customColorNames, defaultTheme, ThemeSchema } from '../design/theme'
import { isStyleTokenKey, styleTokenProblem } from '../design/tokens'
import { ENV_NAME, ENV_NAME_HINT, ENV_REF, envRefs } from '../env/variables'
import { getComponent, INSTANCE_TYPE, isContainerType, PAGE_ROOT_TYPE, SLOT_FILL_TYPE } from './components'
import type { PropDef, PropKind, PropValue } from './components'

/**
 * The bildr app document: Project → Page[] → Node tree. It is the single
 * source of truth that the editor, the agent, and the published runtime
 * all read.
 */

export interface DocNode {
  id: string
  type: string
  /** A layer name set by the user; without one the layers derive it (`layerName`). */
  name?: string
  /** Locked on the canvas (it and its descendants): not selectable or movable there, still from the layers. */
  locked?: boolean
  props: Record<string, PropValue>
  style: Record<string, string>
  children: DocNode[]
}

export const NODE_NAME_MAX = 100

export const IdSchema = z.string().regex(/^[\w-]{1,64}$/, 'Invalid id')
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits, and dashes').max(64)
export const PropValueSchema = z.union([z.string().max(5000), z.number(), z.boolean()])

export const NodeSchema: z.ZodType<DocNode> = z.lazy(() => z.object({
  id: IdSchema,
  type: z.string(),
  // Both optional: nodes saved before layer names and locks have neither.
  name: z.string().trim().min(1).max(NODE_NAME_MAX).optional(),
  locked: z.boolean().optional(),
  props: z.record(z.string(), PropValueSchema),
  // Design tokens (key → value from `shared/design/tokens`), checked in nodeTreeProblems.
  style: z.record(z.string(), z.string()),
  children: z.array(NodeSchema)
}))

/**
 * A page may use a layout (`layoutId`): the layout's tree renders around the
 * page, its root's children (bar SlotFills) fill the layout's `children`
 * slot, and SlotFill children of the root fill its named slots.
 * `layoutValues` holds the page's value per layout variable id.
 */
export const PageSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  slug: SlugSchema,
  root: NodeSchema,
  // Pages saved before layouts existed have none.
  layoutId: IdSchema.optional(),
  layoutValues: z.record(IdSchema, PropValueSchema).optional()
})

export const PROPERTY_KINDS = ['text', 'textarea', 'number', 'boolean', 'select', 'link', 'image', 'icon', 'collection', 'field', 'slot'] as const satisfies readonly (PropKind | 'slot')[]
export const PropertyKindSchema = z.enum(PROPERTY_KINDS)

/** Instance prop keys that are not property ids. */
export const RESERVED_INSTANCE_KEYS = ['component', 'variant'] as const

/**
 * Which node prop a property drives. A slot property binds the node (`prop`
 * is `children`). With `target: 'style'`, `prop` is a style key instead
 * (`bg`, `md:p`): the property's value sets that design token.
 */
export const PropertyBindingSchema = z.object({
  nodeId: IdSchema,
  prop: z.string().min(1).max(64),
  // Bindings saved before style bindings drive props.
  target: z.literal('style').optional().describe('"style": prop names a style key (e.g. bg, md:p) of the node instead of a prop')
})

/** Whether a binding drives a style key rather than a prop. */
export function isStyleBinding(binding: { target?: 'style' }): boolean {
  return binding.target === 'style'
}

export const PROPERTY_DESCRIPTION_MAX = 500
export const PROPERTY_PLACEHOLDER_MAX = 200

/**
 * A component property or layout variable. `description` (a tooltip for
 * whoever sets it), `optional` (instances or pages may leave it empty) and
 * `placeholder` (the hint of an empty text field) only describe it to the
 * editor; properties saved before them have none.
 */
export const PropertyDefSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  kind: PropertyKindSchema,
  default: PropValueSchema.optional(),
  description: z.string().max(PROPERTY_DESCRIPTION_MAX).optional(),
  optional: z.boolean().optional(),
  placeholder: z.string().max(PROPERTY_PLACEHOLDER_MAX).optional(),
  bindings: z.array(PropertyBindingSchema).default(() => [])
})

/**
 * Sparse overrides per node id: absence means the value of the primary
 * variant. `unset` lists style keys removed in the variant: they render as
 * absent even where the primary sets them (never also in `style`).
 */
export const VariantSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  overrides: z.record(IdSchema, z.object({
    props: z.record(z.string(), PropValueSchema).optional(),
    style: z.record(z.string(), z.string()).optional(),
    // Overrides saved before removed tokens have none.
    unset: z.array(z.string()).optional()
  }))
})

/** Why `key` is not a style key (a variant's removed token), e.g. `Unknown style token "x"`; undefined when it is one. */
export function styleKeyProblem(key: string): string | undefined {
  return isStyleTokenKey(key) ? undefined : styleTokenProblem(key, '')
}

/** The primary variant is the `root` tree itself; `variants` holds the others. */
export const ComponentDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  root: NodeSchema,
  properties: z.array(PropertyDefSchema).default(() => []),
  variants: z.array(VariantSchema).default(() => [])
})

/** The id of the layout slot that takes the page's content. */
export const CHILDREN_SLOT = 'children'

/** A layout slot binds one container node of the layout; that node's children are the default content. */
export const LayoutSlotSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  nodeId: IdSchema
})

/**
 * A page frame shared by pages: a tree with a `Page` root, exactly one
 * `children` slot for the page content, optional named slots, and variables
 * (properties that are not slots) that pages set and the tree reads with
 * `{{ layout.NAME }}` or through bindings. Node ids are their own namespace.
 */
export const LayoutSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  root: NodeSchema,
  slots: z.array(LayoutSlotSchema).default(() => []),
  variables: z.array(PropertyDefSchema).default(() => [])
})

export const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'image'] as const
export type FieldType = typeof FIELD_TYPES[number]

export const FieldTypeSchema = z.enum(FIELD_TYPES)
export const FieldKeySchema = z.string()
  .regex(/^[a-z][a-zA-Z0-9_]*$/, 'Field keys start with a lowercase letter, then letters, digits or _ (e.g. price, servedFrom)')
  .max(64)
  .refine(key => key !== 'id', 'The field key "id" is reserved')

/** A dot path into an API item, e.g. `origin.name`. */
export const ApiPathSchema = z.string().max(API_PATH_MAX).regex(API_PATH, API_PATH_HINT)

export const FieldSchema = z.object({
  key: FieldKeySchema,
  label: z.string().trim().min(1).max(100),
  type: FieldTypeSchema,
  // API collections only: where the value is in each item (defaults to the key).
  path: ApiPathSchema.optional()
})

/**
 * A stored API URL may hold `{{ env.NAME }}` refs, resolved on the server at
 * request time, where the full URL and SSRF checks run on the result. Here,
 * the URL is checked with each ref as a placeholder when that still parses
 * (a ref in the path or query), and the ref names must be valid.
 */
export function storedApiUrlProblem(url: string): string | undefined {
  const names = envRefs(url)
  if (!names.length) return apiUrlProblem(url)
  const bad = names.find(name => !ENV_NAME.test(name))
  if (bad) return `"${bad}" is not a variable name: ${ENV_NAME_HINT}`
  const placeholder = url.replace(ENV_REF, 'x')
  return URL.canParse(placeholder) ? apiUrlProblem(placeholder) : undefined
}

export const ApiUrlSchema = z.string().superRefine((url, ctx) => {
  const problem = storedApiUrlProblem(url)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

export const API_HEADERS_MAX = 10
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
/** Headers that belong to the connection, not to the API. */
const RESERVED_HEADERS = ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-connection']

/** Also checked on the resolved value, since a variable may hold anything. */
export function headerValueProblem(value: string): string | undefined {
  return /[\r\n\0]/.test(value) ? 'Header values cannot contain line breaks' : undefined
}

export const ApiHeaderSchema = z.object({
  name: z.string().max(100).regex(HEADER_NAME, 'Header names use letters, digits and - (e.g. Authorization)')
    .refine(name => !RESERVED_HEADERS.includes(name.toLowerCase()), { error: issue => `The header "${issue.input as string}" cannot be set` }),
  value: z.string().max(4096).superRefine((value, ctx) => {
    const problem = headerValueProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
})

export const ApiHeadersSchema = z.array(ApiHeaderSchema).max(API_HEADERS_MAX).superRefine((headers, ctx) => {
  const names = new Set<string>()
  headers.forEach((header, i) => {
    const name = header.name.toLowerCase()
    if (names.has(name)) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: `The header "${header.name}" is set twice` })
    names.add(name)
  })
})

export type ApiHeader = z.infer<typeof ApiHeaderSchema>

export const ItemsPathSchema = z.union([z.literal(''), ApiPathSchema])

export const EndpointPathSchema = z.string().superRefine((path, ctx) => {
  const problem = endpointPathProblem(path)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

const PagingParamSchema = z.string().max(64).regex(PAGING_PARAM, PAGING_PARAM_HINT)
const PageSizeSchema = z.number().int().min(1).max(PAGE_SIZE_MAX)
const PagingTotal = { totalPath: ApiPathSchema.optional() }

/**
 * How a list splits its items over requests: numbered pages (`start` is the
 * first page's number), offsets, a cursor read at `cursorPath`, or a full
 * next-page URL at `nextPath` (the Link header's `rel="next"` without one).
 * `totalPath` is where the total item count is, when the API gives one.
 */
export const PagingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), param: PagingParamSchema.default('page'), start: z.union([z.literal(0), z.literal(1)]).default(1), sizeParam: PagingParamSchema.optional(), size: PageSizeSchema.optional(), ...PagingTotal }),
  z.object({ type: z.literal('offset'), param: PagingParamSchema.default('offset'), sizeParam: PagingParamSchema.default('limit'), size: PageSizeSchema, ...PagingTotal }),
  z.object({ type: z.literal('cursor'), param: PagingParamSchema, cursorPath: ApiPathSchema, ...PagingTotal }),
  z.object({ type: z.literal('next'), nextPath: ApiPathSchema.optional(), ...PagingTotal })
]).superRefine((paging, ctx) => {
  if ('sizeParam' in paging && paging.sizeParam === paging.param) ctx.addIssue({ code: 'custom', path: ['sizeParam'], message: 'The page and size parameters must differ' })
  if (paging.type === 'page' && paging.sizeParam && !paging.size) ctx.addIssue({ code: 'custom', path: ['size'], message: 'Set the page size sent in the size parameter' })
})

export type Paging = z.infer<typeof PagingSchema>

const EndpointBase = { method: z.enum(ENDPOINT_METHODS), path: EndpointPathSchema }
/** Reads are cached and may run from a published app, so they never write. */
const ReadMethodSchema = z.literal('GET', { error: 'List and Get endpoints use GET' })
/** `itemsPath`: where the items array is in the response (the root by default); `paging`: one request when left out. */
export const ListEndpointSchema = z.object({ ...EndpointBase, method: ReadMethodSchema, itemsPath: ItemsPathSchema.optional(), paging: PagingSchema.optional() })
/** `itemPath`: where the item is in the response (the root by default). */
export const ItemEndpointSchema = z.object({ ...EndpointBase, itemPath: ItemsPathSchema.optional() })
export const GetEndpointSchema = ItemEndpointSchema.extend({ method: ReadMethodSchema })

export const ConnectionEndpointsSchema = z.object({
  list: ListEndpointSchema.optional(),
  get: GetEndpointSchema.optional(),
  create: ItemEndpointSchema.optional(),
  update: ItemEndpointSchema.optional(),
  delete: ItemEndpointSchema.optional()
})

/**
 * A remote API that connection collections read and write through: an
 * absolute http(s) base URL and headers sent with every request, both may
 * use `{{ env.NAME }}` (secrets included), resolved only on the server.
 * Requests go only to the resolved base URL's origin.
 */
export const ConnectionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  baseUrl: ApiUrlSchema,
  headers: ApiHeadersSchema.default(() => [])
})

/**
 * Where a collection's records come from: bildr's record store, a JSON
 * endpoint read live (read-only; `itemsPath` is the dot path of the items
 * array, `''` for a root array), or a connection's endpoints, one per
 * operation (`idPath` is where the record id is in an item, default `id`).
 * The URL and `headers` values may use `{{ env.NAME }}`, public or secret,
 * resolved only on the server.
 */
export const CollectionSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('internal') }),
  z.object({
    type: z.literal('api'),
    url: ApiUrlSchema,
    itemsPath: z.union([z.literal(''), ApiPathSchema]),
    headers: ApiHeadersSchema.optional(),
    paging: PagingSchema.optional()
  }),
  z.object({
    type: z.literal('connection'),
    connectionId: IdSchema,
    idPath: ApiPathSchema.optional(),
    endpoints: ConnectionEndpointsSchema
  })
])

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Documents saved before List and Get endpoints were GET-only read them as
 * GET, as the server sends them; input is checked strictly
 * by `CollectionSourceSchema` before it reaches a document.
 */
function readsWithGet(source: unknown): unknown {
  if (!isPlainObject(source) || source.type !== 'connection' || !isPlainObject(source.endpoints)) return source
  const endpoints = { ...source.endpoints }
  for (const op of ['list', 'get']) {
    const endpoint = endpoints[op]
    if (isPlainObject(endpoint) && (ENDPOINT_METHODS as readonly unknown[]).includes(endpoint.method)) endpoints[op] = { ...endpoint, method: 'GET' }
  }
  return { ...source, endpoints }
}

/**
 * A collection's schema lives in the document (undoable, published); its
 * records do not (see `shared/data/records`). Changing a field's type or
 * removing a field never rewrites records: readers ignore unknown keys and
 * read stored values that no longer fit the type as null.
 */
export const CollectionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  slug: SlugSchema,
  fields: z.array(FieldSchema),
  // Collections saved before API sources existed are internal.
  source: z.preprocess(readsWithGet, CollectionSourceSchema).default(() => ({ type: 'internal' as const })),
  publicRead: z.boolean().default(false),
  publicCreate: z.boolean().default(false)
}).superRefine((collection, ctx) => {
  const keys = new Set<string>()
  collection.fields.forEach((field, i) => {
    if (keys.has(field.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: `Field "${field.key}" already exists in "${collection.name}"` })
    keys.add(field.key)
  })
})

export const CONNECTIONS_MAX = 50

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  slug: SlugSchema,
  version: z.number().int().nonnegative(),
  pages: z.array(PageSchema).min(1),
  // Projects saved before themes existed get the default one.
  theme: ThemeSchema.default(defaultTheme),
  // Projects saved before collections existed have none.
  collections: z.array(CollectionSchema).default(() => []),
  // Projects saved before connections existed have none.
  connections: z.array(ConnectionSchema).max(CONNECTIONS_MAX).default(() => []),
  // Projects saved before components existed have none.
  components: z.array(ComponentDefinitionSchema).default(() => []),
  // Projects saved before layouts existed have none.
  layouts: z.array(LayoutSchema).default(() => []),
  createdAt: z.string(),
  updatedAt: z.string()
}).superRefine((project, ctx) => {
  // Colour style keys take the theme's own colour names too.
  const colors = customColorNames(project.theme)
  for (const { path, message } of componentProblems(project.components, colors)) {
    ctx.addIssue({ code: 'custom', path: ['components', ...path], message })
  }
  for (const { path, message } of layoutProblems(project.layouts, project.components, colors)) {
    ctx.addIssue({ code: 'custom', path: ['layouts', ...path], message })
  }
  const connectionIds = new Set<string>()
  project.connections.forEach((connection, i) => {
    if (connectionIds.has(connection.id)) ctx.addIssue({ code: 'custom', path: ['connections', i, 'id'], message: `Duplicate connection id "${connection.id}"` })
    connectionIds.add(connection.id)
  })
  project.collections.forEach((collection, i) => {
    if (collection.source.type === 'connection' && !connectionIds.has(collection.source.connectionId)) {
      ctx.addIssue({ code: 'custom', path: ['collections', i, 'source'], message: `Collection "${collection.name}" uses the missing connection "${collection.source.connectionId}"` })
    }
  })
  const collectionSlugs = new Set<string>()
  const collectionIds = new Set<string>()
  project.collections.forEach((collection, i) => {
    if (collectionSlugs.has(collection.slug)) ctx.addIssue({ code: 'custom', path: ['collections', i, 'slug'], message: `Duplicate collection slug "${collection.slug}"` })
    if (collectionIds.has(collection.id)) ctx.addIssue({ code: 'custom', path: ['collections', i, 'id'], message: `Duplicate collection id "${collection.id}"` })
    collectionSlugs.add(collection.slug)
    collectionIds.add(collection.id)
  })
  const slugs = new Set<string>()
  const ids = new Set<string>()
  project.pages.forEach((page, i) => {
    if (slugs.has(page.slug)) ctx.addIssue({ code: 'custom', path: ['pages', i, 'slug'], message: `Duplicate page slug "${page.slug}"` })
    slugs.add(page.slug)
    if (page.root.type !== PAGE_ROOT_TYPE) ctx.addIssue({ code: 'custom', path: ['pages', i, 'root'], message: 'Page root must be a Page node' })
    const layout = page.layoutId === undefined ? undefined : project.layouts.find(l => l.id === page.layoutId)
    for (const problem of [...nodeTreeProblems(page.root, ids, true, colors), ...instanceProblems(page.root, project.components, layout !== undefined, colors)]) {
      ctx.addIssue({ code: 'custom', path: ['pages', i, 'root'], message: problem })
    }
    for (const { path, message } of pageLayoutProblems(page, layout, colors)) {
      ctx.addIssue({ code: 'custom', path: ['pages', i, ...path], message })
    }
  })
})

export type PropertyDef = z.infer<typeof PropertyDefSchema>
export type PropertyBinding = z.infer<typeof PropertyBindingSchema>
export type Variant = z.infer<typeof VariantSchema>
/** What a variant overrides on one node: props, style tokens and removed tokens (`unset`). */
export type VariantOverride = Variant['overrides'][string]
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>
export type LayoutSlot = z.infer<typeof LayoutSlotSchema>
export type Layout = z.infer<typeof LayoutSchema>
export type Page = z.infer<typeof PageSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Field = z.infer<typeof FieldSchema>
export type Collection = z.infer<typeof CollectionSchema>
export type CollectionSource = z.infer<typeof CollectionSourceSchema>
export type Connection = z.infer<typeof ConnectionSchema>
export type ConnectionEndpoints = z.infer<typeof ConnectionEndpointsSchema>
export type ConnectionSource = Extract<CollectionSource, { type: 'connection' }>

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'slug' | 'version' | 'updatedAt'>

/** What `/p/:slug` serves: a frozen copy of the project taken at publish time. */
export interface PublishedSnapshot {
  project: Project
  publishedAt: string
  /** The PUBLIC project variables at publish time (secrets never leave the server); missing in older snapshots. */
  env?: Record<string, string>
}

/**
 * Structural rules zod cannot express: known component types, children only
 * under containers, props and style tokens from the registries, and ids
 * unique across `seen`. Returns human-readable
 * problems; empty means valid. `seen` collects every id visited.
 * `colors` are the project theme's own colour names (`customColorNames`),
 * which colour keys accept next to tokens and hex values.
 */
export function nodeTreeProblems(node: DocNode, seen: Set<string>, isRoot = false, colors: readonly string[] = []): string[] {
  const problems: string[] = []
  const visit = (n: DocNode, root: boolean) => {
    if (seen.has(n.id)) problems.push(`Duplicate node id "${n.id}"`)
    seen.add(n.id)
    if (root ? n.type !== PAGE_ROOT_TYPE : !getComponent(n.type)) {
      problems.push(`Unknown component type "${n.type}"`)
    }
    if (n.children.length && !isContainerType(n.type)) problems.push(`"${n.type}" cannot have children`)
    const def = getComponent(n.type)
    // Instance and SlotFill props depend on the project's definitions: see instanceProblems.
    const dynamicProps = n.type === INSTANCE_TYPE || n.type === SLOT_FILL_TYPE
    for (const [name, value] of dynamicProps ? [] : Object.entries(n.props)) {
      const propDef = def?.props.find(p => p.name === name)
      const problem = propDef ? propValueProblem(propDef, value) : `"${n.type}" has no prop "${name}"`
      if (problem) problems.push(problem)
    }
    for (const [key, value] of Object.entries(n.style)) {
      const problem = styleTokenProblem(key, value, colors)
      if (problem) problems.push(problem)
    }
    n.children.forEach(child => visit(child, false))
  }
  visit(node, isRoot)
  return problems
}

export const ICON_NAME = /^i-lucide-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Returns a problem message when `value` does not fit the prop definition. */
export function propValueProblem(def: PropDef, value: PropValue): string | undefined {
  switch (def.kind) {
    case 'number':
      return typeof value === 'number' ? undefined : `"${def.name}" must be a number`
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `"${def.name}" must be a boolean`
    case 'select':
      return def.options?.includes(String(value)) ? undefined : `"${def.name}" must be one of ${def.options?.join(', ')}`
    case 'icon':
      return value === '' || (typeof value === 'string' && ICON_NAME.test(value))
        ? undefined
        : `"${def.name}" must be an i-lucide-* icon name, e.g. i-lucide-coffee`
    case 'collection':
      return value === '' || (typeof value === 'string' && SlugSchema.safeParse(value).success)
        ? undefined
        : `"${def.name}" must be a collection slug, e.g. menu`
    case 'field':
      return value === '' || (typeof value === 'string' && FieldKeySchema.safeParse(value).success)
        ? undefined
        : `"${def.name}" must be a field key, e.g. email`
    default:
      return typeof value === 'string' ? undefined : `"${def.name}" must be a string`
  }
}

/** A located problem inside the `components` list. */
interface ComponentProblem { path: (string | number)[], message: string }

function nodeIndex(root: DocNode): Map<string, DocNode> {
  const nodes = new Map<string, DocNode>()
  const visit = (node: DocNode) => {
    nodes.set(node.id, node)
    node.children.forEach(visit)
  }
  visit(root)
  return nodes
}

/**
 * The problem with a value for a property, judged against every prop it is
 * bound to (so a `select` property inherits the options of its targets).
 * An unbound property only has its kind to go by; `select` then accepts any
 * string. Slot properties take no value. A style binding takes a string
 * that is a value of its style key (`colors` being the theme's own colour
 * names).
 */
function propertyValueProblem(property: PropertyDef, value: PropValue, nodes: Map<string, DocNode>, colors: readonly string[]): string | undefined {
  if (property.kind === 'slot') return `"${property.id}" is a slot and takes no value`
  const styleKeys = property.bindings.filter(isStyleBinding).map(b => b.prop).filter(isStyleTokenKey)
  for (const key of styleKeys) {
    if (typeof value !== 'string') return `"${property.id}" must be a string`
    const problem = styleTokenProblem(key, value, colors)
    if (problem) return problem
  }
  const bound = property.bindings.filter(b => !isStyleBinding(b)).flatMap((binding) => {
    const node = nodes.get(binding.nodeId)
    const propDef = node && getComponent(node.type)?.props.find(p => p.name === binding.prop)
    return propDef ? [propDef] : []
  })
  if (!bound.length && styleKeys.length) return undefined
  if (!bound.length) return propValueProblem({ name: property.id, label: property.name, kind: property.kind === 'select' ? 'text' : property.kind, default: '' }, value)
  for (const propDef of bound) {
    const problem = propValueProblem({ ...propDef, name: property.id }, value)
    if (problem) return problem
  }
}

/** Structural rules for the `components` list; node rules come from `nodeTreeProblems`. */
export function componentProblems(components: ComponentDefinition[], colors: readonly string[] = []): ComponentProblem[] {
  const problems: ComponentProblem[] = []
  const add = (path: (string | number)[], message: string) => problems.push({ path, message })
  const ids = new Set<string>()
  components.forEach((def, i) => {
    if (ids.has(def.id)) add([i, 'id'], `Duplicate component id "${def.id}"`)
    ids.add(def.id)
    for (const message of [...nodeTreeProblems(def.root, new Set(), false, colors), ...instanceProblems(def.root, components, false, colors)]) add([i, 'root'], message)
    const nodes = nodeIndex(def.root)

    const propertyIds = new Set<string>()
    def.properties.forEach((property, p) => {
      const at = [i, 'properties', p]
      if (propertyIds.has(property.id)) add([...at, 'id'], `Duplicate property id "${property.id}" in "${def.name}"`)
      propertyIds.add(property.id)
      if ((RESERVED_INSTANCE_KEYS as readonly string[]).includes(property.id)) add([...at, 'id'], `Property id "${property.id}" is reserved`)
      if (property.kind === 'slot' && property.bindings.length !== 1) add([...at, 'bindings'], `Slot "${property.name}" must bind exactly one container node`)
      for (const problem of propertyProblems(property, nodes, 'Property', colors)) add([...at, ...problem.path], problem.message)
    })
    const slots = def.properties.flatMap((property, p) => {
      const nodeId = property.kind === 'slot' ? property.bindings[0]?.nodeId : undefined
      return nodeId === undefined ? [] : [{ p, name: property.name, nodeId }]
    })
    for (const { index, message } of slotPlacementProblems(slots, nodes, def.name)) add([i, 'properties', slots[index]!.p, 'bindings', 0], message)

    const variantIds = new Set<string>()
    def.variants.forEach((variant, v) => {
      if (variantIds.has(variant.id)) add([i, 'variants', v, 'id'], `Duplicate variant id "${variant.id}" in "${def.name}"`)
      variantIds.add(variant.id)
      for (const [nodeId, override] of Object.entries(variant.overrides)) {
        const at = [i, 'variants', v, 'overrides', nodeId]
        const node = nodes.get(nodeId)
        if (!node) {
          add(at, `Variant "${variant.name}" overrides the missing node "${nodeId}"`)
          continue
        }
        const defn = getComponent(node.type)
        for (const [name, value] of Object.entries(override.props ?? {})) {
          const propDef = defn?.props.find(p => p.name === name)
          const message = propDef ? propValueProblem(propDef, value) : `"${node.type}" has no prop "${name}"`
          if (message) add([...at, 'props', name], message)
        }
        for (const [key, value] of Object.entries(override.style ?? {})) {
          const message = styleTokenProblem(key, value, colors)
          if (message) add([...at, 'style', key], message)
        }
        const removed = new Set<string>()
        override.unset?.forEach((key, u) => {
          const message = styleKeyProblem(key)
            ?? (removed.has(key) ? `Variant "${variant.name}" removes "${key}" twice on "${nodeId}"` : undefined)
            ?? (override.style && key in override.style ? `Variant "${variant.name}" both overrides and removes "${key}" on "${nodeId}"` : undefined)
          if (message) add([...at, 'unset', u], message)
          removed.add(key)
        })
      }
    })
  })
  for (const [i, def] of components.entries()) {
    if (reachesItself(def, components)) add([i, 'root'], `Component "${def.name}" contains itself (cycle)`)
  }
  return problems
}

/** Default and binding rules shared by component properties and layout variables (`noun` names them in messages). */
function propertyProblems(property: PropertyDef, nodes: Map<string, DocNode>, noun: 'Property' | 'Variable', colors: readonly string[]): ComponentProblem[] {
  const problems: ComponentProblem[] = []
  if (property.default !== undefined) {
    const message = propertyValueProblem(property, property.default, nodes, colors)
    if (message) problems.push({ path: ['default'], message })
  }
  property.bindings.forEach((binding, b) => {
    const add = (message: string) => problems.push({ path: ['bindings', b], message })
    const node = nodes.get(binding.nodeId)
    if (!node) return add(`${noun} "${property.name}" is bound to the missing node "${binding.nodeId}"`)
    if (property.kind === 'slot') {
      if (isStyleBinding(binding)) add(`Slot "${property.name}" must bind a node's children, not a style`)
      else if (!isContainerType(node.type) || node.type === INSTANCE_TYPE) add(`Slot "${property.name}" must bind a container node, not "${node.type}"`)
      return
    }
    if (isStyleBinding(binding)) {
      if (!isStyleTokenKey(binding.prop)) add(`${noun} "${property.name}" is bound to the unknown style token "${binding.prop}"`)
      else if (property.kind !== 'text' && property.kind !== 'select') add(`${noun} "${property.name}" (kind ${property.kind}) cannot drive style "${binding.prop}": use a text or select property`)
      return
    }
    const propDef = getComponent(node.type)?.props.find(p => p.name === binding.prop)
    if (!propDef) add(`"${node.type}" has no prop "${binding.prop}"`)
    else if (propDef.kind !== property.kind) add(`${noun} "${property.name}" (kind ${property.kind}) cannot drive "${binding.prop}" (kind ${propDef.kind})`)
  })
  return problems
}

/**
 * Structural rules for the `layouts` list: a Page root with valid nodes and
 * instances, distinct slots bound to container nodes with exactly one
 * `children` slot, and variables checked like component properties (but
 * never slots).
 */
export function layoutProblems(layouts: Layout[], components: ComponentDefinition[], colors: readonly string[] = []): ComponentProblem[] {
  const problems: ComponentProblem[] = []
  const add = (path: (string | number)[], message: string) => problems.push({ path, message })
  const ids = new Set<string>()
  layouts.forEach((layout, i) => {
    if (ids.has(layout.id)) add([i, 'id'], `Duplicate layout id "${layout.id}"`)
    ids.add(layout.id)
    if (layout.root.type !== PAGE_ROOT_TYPE) add([i, 'root'], 'Layout root must be a Page node')
    for (const message of [...nodeTreeProblems(layout.root, new Set(), true, colors), ...instanceProblems(layout.root, components, false, colors)]) add([i, 'root'], message)
    const nodes = nodeIndex(layout.root)

    if (layout.slots.filter(s => s.id === CHILDREN_SLOT).length !== 1) add([i, 'slots'], `Layout "${layout.name}" must have exactly one children slot`)
    const slotIds = new Set<string>()
    layout.slots.forEach((slot, s) => {
      const at = [i, 'slots', s]
      if (slotIds.has(slot.id) && slot.id !== CHILDREN_SLOT) add([...at, 'id'], `Duplicate slot id "${slot.id}" in "${layout.name}"`)
      slotIds.add(slot.id)
      const node = nodes.get(slot.nodeId)
      if (!node) add([...at, 'nodeId'], `Slot "${slot.name}" is bound to the missing node "${slot.nodeId}"`)
      else if (!isContainerType(node.type) || node.type === INSTANCE_TYPE || node.type === SLOT_FILL_TYPE) add([...at, 'nodeId'], `Slot "${slot.name}" must bind a container node, not "${node.type}"`)
    })
    for (const { index, message } of slotPlacementProblems(layout.slots, nodes, layout.name)) add([i, 'slots', index, 'nodeId'], message)

    const variableIds = new Set<string>()
    layout.variables.forEach((variable, v) => {
      const at = [i, 'variables', v]
      if (variableIds.has(variable.id)) add([...at, 'id'], `Duplicate variable id "${variable.id}" in "${layout.name}"`)
      variableIds.add(variable.id)
      if (variable.kind === 'slot') {
        add([...at, 'kind'], `Variable "${variable.name}" of layout "${layout.name}" cannot be a slot`)
        return
      }
      for (const problem of propertyProblems(variable, nodes, 'Variable', colors)) add([...at, ...problem.path], problem.message)
    })
  })
  return problems
}

/**
 * A slot's content replaces its node's children, so a second slot on that
 * node or below it would never show. Shared by layout slots and component
 * slot properties; `index` is the slot's position in `slots`, `owner` the
 * layout or component name.
 */
function slotPlacementProblems(slots: { name: string, nodeId: string }[], nodes: Map<string, DocNode>, owner: string): { index: number, message: string }[] {
  const problems: { index: number, message: string }[] = []
  const slotNodes = new Map<string, { name: string }>()
  slots.forEach((slot, index) => {
    const same = slotNodes.get(slot.nodeId)
    if (same) problems.push({ index, message: `Slots "${same.name}" and "${slot.name}" of "${owner}" are bound to the same node "${slot.nodeId}"` })
    slotNodes.set(slot.nodeId, slot)
  })
  slots.forEach((slot, index) => {
    const outer = slots.find(other => other.nodeId !== slot.nodeId && contains(nodes.get(other.nodeId), slot.nodeId))
    if (outer) problems.push({ index, message: `Slot "${slot.name}" of "${owner}" is inside slot "${outer.name}"` })
  })
  return problems
}

/** Whether `id` is a descendant of `node`. */
function contains(node: DocNode | undefined, id: string): boolean {
  return !!node && node.children.some(child => child.id === id || contains(child, id))
}

/**
 * Rules for a page's use of a layout (`layout` is the one `layoutId` names,
 * if it exists): the layout exists, values fit the variables, and the
 * root's SlotFills fill distinct named slots. Without a layout a page has
 * no values; its SlotFills are refused by `instanceProblems`.
 */
export function pageLayoutProblems(page: Page, layout: Layout | undefined, colors: readonly string[] = []): ComponentProblem[] {
  const problems: ComponentProblem[] = []
  const values = Object.entries(page.layoutValues ?? {})
  if (page.layoutId === undefined) {
    if (values.length) problems.push({ path: ['layoutValues'], message: `Page "${page.name}" has layout values but no layout` })
    return problems
  }
  if (!layout) return [{ path: ['layoutId'], message: `Page "${page.name}" uses the unknown layout "${page.layoutId}"` }]
  const nodes = nodeIndex(layout.root)
  for (const [key, value] of values) {
    const variable = layout.variables.find(v => v.id === key && v.kind !== 'slot')
    const problem = variable ? propertyValueProblem(variable, value, nodes, colors) : `Layout "${layout.name}" has no variable "${key}"`
    if (problem) problems.push({ path: ['layoutValues', key], message: `Page "${page.name}": ${problem}` })
  }
  const filled = new Set<string>()
  for (const child of page.root.children) {
    if (child.type !== SLOT_FILL_TYPE) continue
    const slot = String(child.props.slot)
    const at = { path: ['root'], message: '' }
    if (slot === CHILDREN_SLOT) problems.push({ ...at, message: `The children slot of layout "${layout.name}" takes the page content, not a SlotFill` })
    else if (!layout.slots.some(s => s.id === slot)) problems.push({ ...at, message: `Layout "${layout.name}" has no slot "${slot}"` })
    else if (filled.has(slot)) problems.push({ ...at, message: `Slot "${slot}" of page "${page.name}" is filled more than once` })
    filled.add(slot)
  }
  return problems
}

function usedComponentIds(root: DocNode): string[] {
  const used: string[] = []
  const visit = (node: DocNode) => {
    if (node.type === INSTANCE_TYPE && typeof node.props.component === 'string') used.push(node.props.component)
    node.children.forEach(visit)
  }
  visit(root)
  return used
}

/** Whether `start` contains an instance of itself, directly or through other definitions. */
function reachesItself(start: ComponentDefinition, components: ComponentDefinition[]): boolean {
  const byId = new Map(components.map(c => [c.id, c]))
  const visited = new Set<string>()
  const stack = usedComponentIds(start.root)
  while (stack.length) {
    const id = stack.pop()!
    if (id === start.id) return true
    if (visited.has(id)) continue
    visited.add(id)
    const next = byId.get(id)
    if (next) stack.push(...usedComponentIds(next.root))
  }
  return false
}

/**
 * Rules for Instance and SlotFill nodes, which need the project's
 * definitions: the referenced component and variant exist, values fit the
 * property kinds, children are SlotFills for distinct existing slots.
 * With `layoutFills`, the root's own SlotFill children are allowed: they
 * fill its page's layout slots (see `pageLayoutProblems`).
 */
export function instanceProblems(root: DocNode, components: ComponentDefinition[], layoutFills = false, colors: readonly string[] = []): string[] {
  const problems: string[] = []
  const byId = new Map(components.map(c => [c.id, c]))
  const visit = (node: DocNode, parent?: DocNode) => {
    const fillsLayout = layoutFills && parent === root
    if (node.type === SLOT_FILL_TYPE && parent?.type !== INSTANCE_TYPE && !fillsLayout) problems.push(`SlotFill "${node.id}" must be directly under an Instance`)
    if (node.type === INSTANCE_TYPE) problems.push(...instanceNodeProblems(node, byId, colors))
    node.children.forEach(child => visit(child, node))
  }
  visit(root)
  return problems
}

function instanceNodeProblems(node: DocNode, byId: Map<string, ComponentDefinition>, colors: readonly string[]): string[] {
  const problems: string[] = []
  const def = byId.get(String(node.props.component))
  if (!def) return [`Instance "${node.id}" uses the unknown component "${String(node.props.component)}"`]
  const variant = node.props.variant
  if (variant !== undefined && variant !== '' && !def.variants.some(v => v.id === variant)) problems.push(`Instance "${node.id}" uses the unknown variant "${String(variant)}"`)
  const nodes = nodeIndex(def.root)
  for (const [key, value] of Object.entries(node.props)) {
    if ((RESERVED_INSTANCE_KEYS as readonly string[]).includes(key)) continue
    const property = def.properties.find(p => p.id === key && p.kind !== 'slot')
    const problem = property ? propertyValueProblem(property, value, nodes, colors) : `"${def.name}" has no property "${key}"`
    if (problem) problems.push(`Instance "${node.id}": ${problem}`)
  }
  const filled = new Set<string>()
  for (const child of node.children) {
    if (child.type !== SLOT_FILL_TYPE) {
      problems.push(`Instance "${node.id}" can only contain SlotFill nodes, not "${child.type}"`)
      continue
    }
    const slot = String(child.props.slot)
    if (!def.properties.some(p => p.id === slot && p.kind === 'slot')) problems.push(`"${def.name}" has no slot "${slot}"`)
    else if (filled.has(slot)) problems.push(`Slot "${slot}" of Instance "${node.id}" is filled more than once`)
    filled.add(slot)
  }
  return problems
}
