import { z } from 'zod'
import { IdSchema } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'
import { pageOutline } from '#shared/runtime/render'
import { defineAction } from './define'
import { assertFound } from './project'

/**
 * Editor context, after agent-native's `application_state`: the editor
 * reports what the human is looking at, the agent reads it and can steer the
 * editor with a one-shot navigate event.
 */

interface StoredContext {
  pageId: string
  selectedId: string | null
  updatedAt: string
}

const contextKey = (projectId: string) => `editor-context:${projectId}`

export const editorSetContext = defineAction({
  name: 'editor_set_context',
  description: 'Record the page and node the editor currently shows. Called by the editor UI.',
  input: z.object({ projectId: IdSchema, pageId: IdSchema, selectedId: IdSchema.nullable() }),
  uiOnly: true,
  run: async ({ projectId, pageId, selectedId }, { services }) => {
    await services.loadProject(projectId)
    const context: StoredContext = { pageId, selectedId, updatedAt: new Date().toISOString() }
    await services.storage.setItem(contextKey(projectId), context)
    return context
  }
})

export const editorGetContext = defineAction({
  name: 'editor_get_context',
  description: 'What the human sees in the editor: the current page (id, name, slug), the selected node (id, type, props) and a text outline of the page. Null when no editor has the project open yet.',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    const project = await services.loadProject(projectId)
    const context = await services.storage.getItem<StoredContext>(contextKey(projectId))
    if (!context) return null
    const page = project.pages.find(p => p.id === context.pageId)
    const node = page && context.selectedId ? findNode(page.root, context.selectedId) : undefined
    return {
      ...context,
      page: page ? { id: page.id, name: page.name, slug: page.slug } : null,
      selected: node ? { id: node.id, type: node.type, props: node.props } : null,
      outline: page ? pageOutline(page) : null
    }
  }
})

export const editorNavigate = defineAction({
  name: 'editor_navigate',
  description: 'Show a page in the open editors of the project, optionally selecting a node on it. Does not change the document.',
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema,
    nodeId: IdSchema.optional().describe('Node to select on that page')
  }),
  run: async ({ projectId, pageId, nodeId }, ctx) => {
    const project = await ctx.services.loadProject(projectId)
    const page = assertFound(project.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    if (nodeId) assertFound(findNode(page.root, nodeId), `Node "${nodeId}" not found on page "${page.name}"`)
    ctx.navigate(projectId, pageId, nodeId ?? null)
    return { pageId, nodeId: nodeId ?? null }
  }
})
