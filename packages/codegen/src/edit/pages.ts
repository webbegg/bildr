import { z } from 'zod'
import { ArtifactIdSchema, ModuleNameSchema, PageFileSchema } from '../model/schemas.ts'
import type { PageFile } from '../model/schemas.ts'
import { defineEdit, fail, kebab } from './core.ts'
import type { Draft } from './core.ts'
import { walk } from './tree.ts'

/** Page files: create (mints `pg_<snake>`), rename or re-path, delete (refused while something links to the page). */

export const PageRef = ArtifactIdSchema.describe('A page id, e.g. "pg_index"')
const PathSchema = PageFileSchema.shape.path.describe('The route, e.g. "/about" or "/posts/:slug"')

/** Whether `value` holds an object with `page: id` anywhere (a link's `to`, a navigate step's `to`). */
const targets = (value: unknown, id: string): boolean => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => targets(item, id))
  return (value as Record<string, unknown>).page === id || Object.values(value).some(item => targets(item, id))
}

/** The nodes (as `file (nodeId)`) whose props or interactions link or navigate to page `id`. */
export const pageTargets = (draft: Draft, id: string): string[] => draft.trees().flatMap((tree) => {
  const found: string[] = []
  walk(tree.root, (node) => {
    if (targets(node.props, id) || targets(node.interactions, id)) found.push(`${tree.file} (${node.id})`)
  })
  return found
})

const routeName = (name: string): string => {
  const value = kebab(name)
  if (!/^[a-z][a-z0-9-]*$/.test(value)) fail('invalid', `"${name}" can't be a page name: use letters first, like "about"`)
  return value
}

const checkPath = (draft: Draft, path: string, except?: string) => {
  const other = draft.pages().find(page => page.path === path && page.id !== except)
  if (other) fail('invalid', `A page already has the path "${path}": ${other.id}`)
}

const checkName = (draft: Draft, module: string, name: string, except?: string) => {
  if (draft.module(module).pages.some(page => page.name === name && page.id !== except)) fail('invalid', `A page is already named "${name}" in module "${module}"`)
}

export const pageCreate = defineEdit({
  input: z.object({
    name: z.string().min(1).max(100).describe('The page name; kebab-cased into its route name, e.g. "About us" → "about-us"'),
    path: PathSchema.optional().describe('The route; defaults to "/<name>"'),
    module: ModuleNameSchema.optional().describe('The module it belongs to; defaults to the project\'s defaultModule'),
    layout: ArtifactIdSchema.optional().describe('A layout id it renders in, e.g. "lay_main"')
  }),
  apply: (draft, { name: given, path, module = draft.model.project.defaultModule, layout }) => {
    const name = routeName(given)
    const mod = draft.module(module)
    checkName(draft, module, name)
    const route = path ?? `/${name}`
    checkPath(draft, route)
    if (layout) draft.layout(layout)
    const id = draft.mint('pg', name)
    const page: PageFile = { id, name, path: route, ...(layout ? { layout } : {}), root: { id: draft.nodeId('Page'), type: 'Page', style: { gap: '4' } } }
    mod.pages.push(page)
    const filePath = draft.place(id, `.bildr/modules/${module}/pages`, name)
    return { pageId: id, filePath, nodeId: page.root.id }
  }
})

export const pageUpdate = defineEdit({
  input: z.object({
    page: PageRef,
    name: z.string().min(1).max(100).optional().describe('A new name (kebab-cased); its file keeps its path'),
    path: PathSchema.optional()
  }),
  apply: (draft, { page: id, name, path }) => {
    const { page, module } = draft.page(id)
    if (name !== undefined) {
      const value = routeName(name)
      checkName(draft, module, value, id)
      page.name = value
    }
    if (path !== undefined) {
      checkPath(draft, path, id)
      page.path = path
    }
    return {}
  }
})

export const pageDelete = defineEdit({
  input: z.object({ page: PageRef }),
  apply: (draft, { page: id }) => {
    const { page, module } = draft.page(id)
    const users = pageTargets(draft, id)
    if (users.length) {
      const many = users.length !== 1
      fail('forbidden', `Page "${page.name}" is the target of ${users.length} link${many ? 's' : ''} or navigate step${many ? 's' : ''}: ${users.join(', ')}. Change them first`)
    }
    if (draft.pages().length === 1) fail('forbidden', 'A project needs at least one page')
    const pages = draft.module(module).pages
    pages.splice(pages.indexOf(page), 1)
    return {}
  }
})
