import { z } from 'zod'
import { getComponent, isContainerType, isStyleKey, PAGE_ROOT_TYPE } from './components'
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
// No braces, semicolons, or angle brackets: style values stay single declarations.
export const StyleValueSchema = z.string().max(200).regex(/^[^;{}<>]*$/, 'Invalid CSS value')

export const NodeSchema: z.ZodType<DocNode> = z.lazy(() => z.object({
  id: IdSchema,
  type: z.string(),
  props: z.record(z.string(), PropValueSchema),
  style: z.record(z.string(), StyleValueSchema),
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

/**
 * Structural rules zod cannot express: known component types, children only
 * under containers, and ids unique across `seen`. Returns human-readable
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
    for (const key of Object.keys(n.style)) {
      if (!isStyleKey(key)) problems.push(`Unsupported style property "${key}"`)
    }
    n.children.forEach(child => visit(child, false))
  }
  visit(node, isRoot)
  return problems
}

/** Returns a problem message when `value` does not fit the prop definition. */
export function propValueProblem(def: PropDef, value: PropValue): string | undefined {
  switch (def.kind) {
    case 'number':
      return typeof value === 'number' ? undefined : `"${def.name}" must be a number`
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `"${def.name}" must be a boolean`
    case 'select':
      return def.options?.includes(String(value)) ? undefined : `"${def.name}" must be one of ${def.options?.join(', ')}`
    default:
      return typeof value === 'string' ? undefined : `"${def.name}" must be a string`
  }
}
