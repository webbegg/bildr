import { z } from 'zod'
import { defaultTheme, ThemeSchema } from '../design/theme'
import { styleTokenProblem } from '../design/tokens'
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

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  slug: SlugSchema,
  version: z.number().int().nonnegative(),
  pages: z.array(PageSchema).min(1),
  // Projects saved before themes existed get the default one.
  theme: ThemeSchema.default(defaultTheme),
  createdAt: z.string(),
  updatedAt: z.string()
}).superRefine((project, ctx) => {
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

export type ProjectSummary = Pick<Project, 'id' | 'name' | 'slug' | 'version' | 'updatedAt'>

/** What `/p/:slug` serves: a frozen copy of the project taken at publish time. */
export interface PublishedSnapshot {
  project: Project
  publishedAt: string
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
    default:
      return typeof value === 'string' ? undefined : `"${def.name}" must be a string`
  }
}
