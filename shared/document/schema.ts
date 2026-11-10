import { z } from 'zod'
import { API_PATH, API_PATH_HINT, API_PATH_MAX, apiUrlProblem } from '../data/apiSource'
import { defaultTheme, ThemeSchema } from '../design/theme'
import { styleTokenProblem } from '../design/tokens'
import { ENV_NAME, ENV_NAME_HINT, ENV_REF, envRefs } from '../env/variables'
import { getComponent, isContainerType, PAGE_ROOT_TYPE } from './components'
import type { PropDef, PropValue } from './components'

/**
 * The bildr app document: Project → Page[] → Node tree. It is the single
 * source of truth that the editor, the agent, and the published runtime
 * all read.
 */

export interface DocNode {
  id: string
  type: string
  props: Record<string, PropValue>
  style: Record<string, string>
  children: DocNode[]
}

export const IdSchema = z.string().regex(/^[\w-]{1,64}$/, 'Invalid id')
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits, and dashes').max(64)
export const PropValueSchema = z.union([z.string().max(5000), z.number(), z.boolean()])

export const NodeSchema: z.ZodType<DocNode> = z.lazy(() => z.object({
  id: IdSchema,
  type: z.string(),
  props: z.record(z.string(), PropValueSchema),
  // Design tokens (key → value from `shared/design/tokens`), checked in nodeTreeProblems.
  style: z.record(z.string(), z.string()),
  children: z.array(NodeSchema)
}))

export const PageSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  slug: SlugSchema,
  root: NodeSchema
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

/**
 * Where a collection's records come from: bildr's record store, or a JSON
 * endpoint read live (read-only; `itemsPath` is the dot path of the items
 * array, `''` for a root array). The URL and `headers` values may use
 * `{{ env.NAME }}`, public or secret, resolved only on the server.
 */
export const CollectionSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('internal') }),
  z.object({
    type: z.literal('api'),
    url: ApiUrlSchema,
    itemsPath: z.union([z.literal(''), ApiPathSchema]),
    headers: ApiHeadersSchema.optional()
  })
])

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
  source: CollectionSourceSchema.default(() => ({ type: 'internal' as const })),
  publicRead: z.boolean().default(false),
  publicCreate: z.boolean().default(false)
}).superRefine((collection, ctx) => {
  const keys = new Set<string>()
  collection.fields.forEach((field, i) => {
    if (keys.has(field.key)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: `Field "${field.key}" already exists in "${collection.name}"` })
    keys.add(field.key)
  })
})

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
  createdAt: z.string(),
  updatedAt: z.string()
}).superRefine((project, ctx) => {
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
    for (const problem of nodeTreeProblems(page.root, ids, true)) {
      ctx.addIssue({ code: 'custom', path: ['pages', i, 'root'], message: problem })
    }
  })
})

export type Page = z.infer<typeof PageSchema>
export type Project = z.infer<typeof ProjectSchema>
export type Field = z.infer<typeof FieldSchema>
export type Collection = z.infer<typeof CollectionSchema>
export type CollectionSource = z.infer<typeof CollectionSourceSchema>

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
 */
export function nodeTreeProblems(node: DocNode, seen: Set<string>, isRoot = false): string[] {
  const problems: string[] = []
  const visit = (n: DocNode, root: boolean) => {
    if (seen.has(n.id)) problems.push(`Duplicate node id "${n.id}"`)
    seen.add(n.id)
    if (root ? n.type !== PAGE_ROOT_TYPE : !getComponent(n.type)) {
      problems.push(`Unknown component type "${n.type}"`)
    }
    if (n.children.length && !isContainerType(n.type)) problems.push(`"${n.type}" cannot have children`)
    const def = getComponent(n.type)
    for (const [name, value] of Object.entries(n.props)) {
      const propDef = def?.props.find(p => p.name === name)
      const problem = propDef ? propValueProblem(propDef, value) : `"${n.type}" has no prop "${name}"`
      if (problem) problems.push(problem)
    }
    for (const [key, value] of Object.entries(n.style)) {
      const problem = styleTokenProblem(key, value)
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
