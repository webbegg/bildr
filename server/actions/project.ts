import { z } from 'zod'
import { STYLE_TOKENS, variantsOf } from '#shared/design/tokens'
import { COMPONENTS } from '#shared/document/components'
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

export const projectRename = defineAction({
  name: 'project_rename',
  description: 'Rename a project. Only the name changes: the slug stays, so published URLs (/p/<project-slug>) do not change. Not undoable: project metadata is outside the node undo history (history_undo does not revert it).',
  input: z.object({ projectId: IdSchema, name: z.string().trim().min(1).max(100).describe('New project name, 1–100 characters after trimming') }),
  run: async ({ projectId, name }, ctx) => {
    const project = await ctx.services.rename(ctx, projectId, name)
    return { name: project.name, slug: project.slug, version: project.version }
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
  description: 'List the components that can be inserted, with their props (name, kind, default, options), whether they accept children, and default style; plus the design tokens a node style can use (key, label, group, allowed values, and the breakpoints whose prefix it takes, e.g. md:cols).',
  input: z.object({}),
  readOnly: true,
  run: async () => ({
    components: COMPONENTS,
    tokens: STYLE_TOKENS.map(token => ({
      key: token.key,
      label: token.label,
      group: token.group,
      values: token.values,
      breakpoints: variantsOf(token).filter(b => b !== undefined)
    }))
  })
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

export const projectPublish = defineAction({
  name: 'project_publish',
  description: 'Publish the current draft. The published app is served at the returned url (/p/<project-slug>/<page-slug>) and stays unchanged until the next publish.',
  input: z.object({ projectId: IdSchema }),
  run: async ({ projectId }, { services }) => {
    const { project, publishedAt } = await services.publish(projectId)
    return { url: `/p/${project.slug}`, version: project.version, publishedAt }
  }
})

export const projectPublishedInfo = defineAction({
  name: 'project_published_info',
  description: 'When and which version of the project was last published (null if never).',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    const project = await services.loadProject(projectId)
    const snapshot = await services.getPublished(project.slug)
    return snapshot ? { url: `/p/${project.slug}`, version: snapshot.project.version, publishedAt: snapshot.publishedAt } : null
  }
})

export function assertFound<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new ActionError('not_found', message)
  return value
}
