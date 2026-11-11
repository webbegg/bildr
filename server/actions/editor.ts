import { z } from 'zod'
import { IdSchema } from '#shared/document/schema'
import type { DocNode, Project } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'
import { navigateEventId } from '#shared/editor/navigate'
import { pageOutline } from '#shared/runtime/render'
import { ActionError, defineAction } from './define'
import { assertFound } from './project'
import type { Services } from './services'

/**
 * Editor context, after agent-native's `application_state`: the editor
 * reports what the human is looking at, the agent reads it and can steer the
 * editor with a one-shot navigate event.
 */

interface StoredContext {
  pageId: string
  selectedId: string | null
  /** The component, layout and variant the editor has open on top of the page; null (or absent, from older editors) for none. */
  componentId?: string | null
  layoutId?: string | null
  variantId?: string | null
  updatedAt: string
}

const contextKey = (projectId: string) => `editor-context:${projectId}`

export const editorSetContext = defineAction({
  name: 'editor_set_context',
  description: 'Record the page and node the editor currently shows, and the component (with its variant) or layout open on top of the page, whose tree the selection is then in. Called by the editor UI.',
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema,
    selectedId: IdSchema.nullable(),
    componentId: IdSchema.nullable().optional(),
    layoutId: IdSchema.nullable().optional(),
    variantId: IdSchema.nullable().optional()
  }),
  uiOnly: true,
  run: async ({ projectId, pageId, selectedId, componentId = null, layoutId = null, variantId = null }, { services }) => {
    await services.loadProject(projectId)
    const context: StoredContext = { pageId, selectedId, componentId, layoutId, variantId, updatedAt: new Date().toISOString() }
    await services.storage.setItem(contextKey(projectId), context)
    return context
  }
})

/** The tree the editor shows: the open component's definition or layout, else the page. */
function shownTree(project: Project, context: StoredContext): DocNode | undefined {
  if (context.componentId) return project.components.find(c => c.id === context.componentId)?.root
  if (context.layoutId) return project.layouts.find(l => l.id === context.layoutId)?.root
  return project.pages.find(p => p.id === context.pageId)?.root
}

export const editorGetContext = defineAction({
  name: 'editor_get_context',
  description: 'What the human sees in the editor: the current page (id, name, slug), the component (and variant) or layout open on top of it, if any, the selected node (id, type, props; in the open component or layout when there is one) and a text outline of the page. Null when no editor has the project open yet.',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    const project = await services.loadProject(projectId)
    const context = await services.storage.getItem<StoredContext>(contextKey(projectId))
    if (!context) return null
    const page = project.pages.find(p => p.id === context.pageId)
    const component = project.components.find(c => c.id === context.componentId)
    const variant = component?.variants.find(v => v.id === context.variantId)
    const layout = project.layouts.find(l => l.id === context.layoutId)
    const tree = shownTree(project, context)
    const node = tree && context.selectedId ? findNode(tree, context.selectedId) : undefined
    return {
      ...context,
      page: page ? { id: page.id, name: page.name, slug: page.slug } : null,
      component: component ? { id: component.id, name: component.name } : null,
      variant: variant ? { id: variant.id, name: variant.name } : null,
      layout: layout ? { id: layout.id, name: layout.name } : null,
      selected: node ? { id: node.id, type: node.type, props: node.props } : null,
      outline: page ? pageOutline(page) : null
    }
  }
})

export const editorNavigate = defineAction({
  name: 'editor_navigate',
  description: 'Steer the open editors of the project: show a page (pageId), optionally selecting a node on it (nodeId), or open a component (componentId, optionally on one of its variants with variantId) or a layout (layoutId) in its own view, on top of pageId or, without one, the page the editor is on. Does not change the document.',
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema.optional().describe('Page to show; with componentId or layoutId, the page to return to (defaults to the one the editor is on)'),
    nodeId: IdSchema.optional().describe('Node to select on that page'),
    componentId: IdSchema.optional().describe('Component to open in the component view, from project_get components'),
    variantId: IdSchema.optional().describe('With componentId: the variant to show and edit'),
    layoutId: IdSchema.optional().describe('Layout to open in the layout view, from project_get layouts')
  }),
  run: async ({ projectId, pageId: givenPage, nodeId, componentId, variantId, layoutId }, ctx) => {
    if (!givenPage && !componentId && !layoutId) throw new ActionError('invalid', 'Give pageId, componentId or layoutId')
    if (componentId && layoutId) throw new ActionError('invalid', 'Give componentId or layoutId, not both')
    if (variantId && !componentId) throw new ActionError('invalid', 'variantId needs componentId')
    if (nodeId && (componentId || layoutId)) throw new ActionError('invalid', 'nodeId selects a node on pageId; leave it out with componentId or layoutId')
    const project = await ctx.services.loadProject(projectId)
    if (componentId) {
      const def = assertFound(project.components.find(c => c.id === componentId), `Component "${componentId}" not found`)
      if (variantId) assertFound(def.variants.find(v => v.id === variantId), `Variant "${variantId}" not found in component "${def.name}"`)
    }
    if (layoutId) assertFound(project.layouts.find(l => l.id === layoutId), `Layout "${layoutId}" not found`)
    const pageId = givenPage ?? await editorPage(ctx.services, project)
    const page = assertFound(project.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    if (nodeId) assertFound(findNode(page.root, nodeId), `Node "${nodeId}" not found on page "${page.name}"`)
    const target = { pageId, nodeId: nodeId ?? null, componentId: componentId ?? null, layoutId: layoutId ?? null, variantId: variantId ?? null }
    ctx.navigate(projectId, pageId, navigateEventId(target))
    return target
  }
})

/** The page the editor last reported, while it exists; else the first page. */
async function editorPage(services: Services, project: Project): Promise<string> {
  const context = await services.storage.getItem<StoredContext>(contextKey(project.id))
  return project.pages.find(p => p.id === context?.pageId)?.id ?? project.pages[0]!.id
}
