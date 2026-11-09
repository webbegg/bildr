import { z } from 'zod'
import { COMPONENTS, STYLE_KEYS } from '#shared/document/components'
import { createProject } from '#shared/document/factory'
import { IdSchema } from '#shared/document/schema'
import { ActionError, defineAction } from './define'

export const projectList = defineAction({
  name: 'project_list',
  description: 'List all projects (id, name, slug, version, updatedAt), most recently edited first.',
  input: z.object({}),
  readOnly: true,
  run: async (_input, { services }) => services.projects.list()
})

export const projectCreate = defineAction({
  name: 'project_create',
  description: 'Create a new project with one empty "Home" page. Returns the full project document.',
  input: z.object({ name: z.string().min(1).max(100).describe('Project name') }),
  run: async ({ name }, ctx) => {
    const project = createProject(name)
    let n = 1
    while (await ctx.services.projects.getBySlug(project.slug)) project.slug = `${createProject(name).slug}-${++n}`
    await ctx.services.projects.save(project)
    ctx.notify(project.id, project.version)
    return project
  }
})

export const projectGet = defineAction({
  name: 'project_get',
  description: 'Get the full project document: pages, each with a root node tree of { id, type, props, style, children }.',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => services.loadProject(projectId)
})

export const componentsList = defineAction({
  name: 'components_list',
  description: 'List the components that can be inserted, with their props (name, kind, default, options), whether they accept children, and the editable style keys.',
  input: z.object({}),
  readOnly: true,
  run: async () => ({ components: COMPONENTS, styleKeys: STYLE_KEYS })
})

export const historyGet = defineAction({
  name: 'history_get',
  description: 'Labels of the next undo and redo steps (null when there is none).',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    await services.loadProject(projectId)
    return services.historyState(projectId)
  }
})

export const historyUndo = defineAction({
  name: 'history_undo',
  description: 'Undo the last change to the project (made by anyone: the editor or an agent).',
  input: z.object({ projectId: IdSchema }),
  run: async ({ projectId }, ctx) => {
    const { project, label } = await ctx.services.undo(ctx, projectId)
    return { version: project.version, label }
  }
})

export const historyRedo = defineAction({
  name: 'history_redo',
  description: 'Redo the last undone change.',
  input: z.object({ projectId: IdSchema }),
  run: async ({ projectId }, ctx) => {
    const { project, label } = await ctx.services.redo(ctx, projectId)
    return { version: project.version, label }
  }
})

export function assertFound<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new ActionError('not_found', message)
  return value
}
