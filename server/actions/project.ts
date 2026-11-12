import { z } from 'zod'
import { BREAKPOINT_BASES, breakpointsOf, STYLE_TOKENS, variantsOf } from '#shared/design/tokens'
import { COMPONENTS } from '#shared/document/components'
import { createProject } from '#shared/document/factory'
import { IdSchema } from '#shared/document/schema'
import type { Interaction, Transition } from '#shared/document/schema'
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
  description: 'Create a new project with one empty "Home" page. Returns the full project document. New projects are desktop-first (breakpointBase "desktop"): the base style is the Desktop one and narrower sizes override it with max-lg: (below 1024 px), max-md: (below 768) and max-sm: (below 640). base "mobile" makes a mobile-first project instead (base style for Mobile, overrides sm:, md:, lg: from 640, 768 and 1024 px up). The base cannot be changed later.',
  input: z.object({
    name: z.string().min(1).max(100).describe('Project name'),
    base: z.enum(BREAKPOINT_BASES).optional().describe('The breakpoint base: "desktop" (default; overrides max-lg:, max-md:, max-sm:) or "mobile" (overrides sm:, md:, lg:)')
  }),
  run: async ({ name, base }, ctx) => {
    const project = createProject(name, base)
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

export const projectDelete = defineAction({
  name: 'project_delete',
  description: 'Delete a project and everything that belongs to it: its pages, history, collections and their records, environment variables and the published app (/p/<project-slug> stops being served). This cannot be undone. Pass the project slug as `confirm`; any other value is refused.',
  input: z.object({
    projectId: IdSchema,
    confirm: z.string().describe('The project slug, typed to confirm the deletion')
  }),
  run: async ({ projectId, confirm }, ctx) => {
    const project = await ctx.services.deleteProject(ctx, projectId, confirm)
    return { deleted: true, projectId, slug: project.slug }
  }
})

export const projectGet = defineAction({
  name: 'project_get',
  description: 'Get the full project document: pages, each with a root node tree of { id, type, name?, locked?, props, style, children }. name is a layer name set with node_rename; locked (node_set_locked) keeps a node and its descendants from being selected or moved on the canvas. Colour style keys may hold a token, a #rgb, #rrggbb or #rrggbbaa hex, or a theme custom colour name (theme.custom). breakpointBase says which breakpoint prefixes the style keys take: "mobile" (sm:, md:, lg:, from 640, 768 and 1024 px up) or "desktop" (max-lg:, max-md:, max-sm:, below 1024, 768 and 640 px).',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => services.loadProject(projectId)
})

/** The interactions and transition of a component (its primary's) or a variant, for listings: only the ones set. */
function motion({ interactions, transition }: { interactions?: Interaction[], transition?: Transition }) {
  return { ...(interactions?.length ? { interactions } : {}), ...(transition ? { transition } : {}) }
}

export const componentsList = defineAction({
  name: 'components_list',
  description: 'List the components that can be inserted, with their props (name, kind, default, options), whether they accept children, and default style; plus the design tokens a node style can use (key, label, group, allowed values, and the breakpoints whose prefix it takes, e.g. md:cols or max-lg:cols; colour tokens list alsoAccepts: they also take a #rgb, #rrggbb or #rrggbbaa hex or a theme custom colour name). breakpointBases lists the prefixes of each base: a project takes only those of its own breakpointBase. With projectId, also breakpointBase (the project\'s) with each token\'s breakpoints limited to it, and userComponents: the project\'s own components (id, name, properties, variants with their state, interactions and transition when set, and the primary\'s interactions and the component transition), inserted as node_insert { type: "Instance", props: { component: id } }.',
  input: z.object({ projectId: IdSchema.optional().describe('Also list this project\'s own components') }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    const project = projectId === undefined ? undefined : await services.loadProject(projectId)
    return {
      components: COMPONENTS,
      ...(project === undefined
        ? {}
        : {
            breakpointBase: project.breakpointBase,
            userComponents: project.components.map(c => ({
              id: c.id,
              name: c.name,
              properties: c.properties.map(p => ({ id: p.id, name: p.name, kind: p.kind, ...(p.default === undefined ? {} : { default: p.default }) })),
              ...motion(c),
              variants: c.variants.map(v => ({ id: v.id, name: v.name, ...(v.state ? { state: v.state } : {}), ...motion(v) }))
            }))
          }),
      breakpointBases: Object.fromEntries(BREAKPOINT_BASES.map(base => [base, breakpointsOf(base)])),
      tokens: STYLE_TOKENS.map(token => ({
        key: token.key,
        label: token.label,
        group: token.group,
        values: token.values,
        breakpoints: variantsOf(token, project?.breakpointBase).filter(b => b !== undefined),
        ...(token.kind === 'color' ? { alsoAccepts: ['#rgb, #rrggbb or #rrggbbaa hex', 'a theme custom colour name (theme_get theme.custom)'] } : {})
      }))
    }
  }
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
