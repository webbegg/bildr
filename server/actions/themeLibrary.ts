import { z } from 'zod'
import { copyName, libraryNameProblem, THEME_LIBRARY_MAX, ThemeNameSchema } from '#shared/design/library'
import type { LibraryTheme } from '#shared/design/library'
import { ThemeSchema } from '#shared/design/theme'
import { newId } from '#shared/document/factory'
import { IdSchema } from '#shared/document/schema'
import { createThemeStore } from '../utils/themeStore'
import { ActionError, defineAction } from './define'
import type { ActionContext } from './define'

/**
 * The theme library: named themes shared by every project, stored outside
 * them (`themes:<id>`). Library changes are not undoable and never change a
 * project; `theme_apply` copies a stored theme into one, as one undo step.
 */

const LIBRARY_HINT = `The library holds at most ${THEME_LIBRARY_MAX} themes; names are unique ignoring case. Not undoable.`

const store = (ctx: ActionContext) => createThemeStore(ctx.services.storage)

function find(themes: LibraryTheme[], themeId: string): LibraryTheme {
  const found = themes.find(t => t.id === themeId)
  if (!found) throw new ActionError('not_found', `Theme "${themeId}" not found`)
  return found
}

function assertName(name: string, themes: LibraryTheme[], selfId?: string): void {
  const problem = libraryNameProblem(name, themes, selfId)
  if (problem) throw new ActionError('invalid', problem)
}

function assertRoom(themes: LibraryTheme[]): void {
  if (themes.length >= THEME_LIBRARY_MAX) throw new ActionError('invalid', `The theme library is full (${THEME_LIBRARY_MAX} themes). Delete one first.`)
}

/** Adds a theme under `name` (checked) to the library. */
async function add(ctx: ActionContext, themes: LibraryTheme[], name: string, theme: unknown): Promise<LibraryTheme> {
  assertName(name, themes)
  assertRoom(themes)
  const at = new Date().toISOString()
  const entry = { id: newId('theme'), name: name.trim(), theme: ThemeSchema.parse(theme), createdAt: at, updatedAt: at }
  await store(ctx).save(entry)
  return entry
}

export const themeLibraryList = defineAction({
  name: 'theme_library_list',
  description: 'List the theme library: the saved themes every project can apply, each { id, name, theme, createdAt, updatedAt }, oldest first.',
  input: z.object({}),
  readOnly: true,
  run: async (_input, ctx) => ({ themes: await store(ctx).list() })
})

export const themeLibrarySave = defineAction({
  name: 'theme_library_save',
  description: `Save a project's current theme to the theme library under a new name, returning the stored theme. ${LIBRARY_HINT}`,
  input: z.object({ name: ThemeNameSchema, projectId: IdSchema }),
  run: async ({ name, projectId }, ctx) => {
    const project = await ctx.services.loadProject(projectId)
    const themes = store(ctx)
    return themes.transaction(async () => add(ctx, await themes.list(), name, project.theme))
  }
})

export const themeLibraryUpdate = defineAction({
  name: 'theme_library_update',
  description: `Update a library theme: with projectId, replace it with that project's current theme; with name, rename it; or both. Projects that applied it keep their copy. ${LIBRARY_HINT}`,
  input: z.object({
    themeId: IdSchema,
    projectId: IdSchema.optional().describe('The project whose current theme replaces the stored one'),
    name: ThemeNameSchema.optional()
  }).refine(input => input.projectId !== undefined || input.name !== undefined, 'Give projectId, name or both'),
  run: async ({ themeId, projectId, name }, ctx) => {
    const project = projectId ? await ctx.services.loadProject(projectId) : undefined
    const themes = store(ctx)
    return themes.transaction(async () => {
      const all = await themes.list()
      const entry = { ...find(all, themeId) }
      if (name !== undefined) {
        assertName(name, all, themeId)
        entry.name = name.trim()
      }
      if (project) entry.theme = ThemeSchema.parse(project.theme)
      entry.updatedAt = new Date().toISOString()
      await themes.save(entry)
      return entry
    })
  }
})

export const themeLibraryDuplicate = defineAction({
  name: 'theme_library_duplicate',
  description: `Copy a library theme, by default as "<name> copy" (numbered when taken), returning the copy. ${LIBRARY_HINT}`,
  input: z.object({ themeId: IdSchema, name: ThemeNameSchema.optional() }),
  run: async ({ themeId, name }, ctx) => {
    const themes = store(ctx)
    return themes.transaction(async () => {
      const all = await themes.list()
      const source = find(all, themeId)
      return add(ctx, all, name ?? copyName(source.name, all), source.theme)
    })
  }
})

export const themeLibraryDelete = defineAction({
  name: 'theme_library_delete',
  description: 'Delete a library theme. Projects that applied it keep their copy. Not undoable.',
  input: z.object({ themeId: IdSchema }),
  run: async ({ themeId }, ctx) => {
    const themes = store(ctx)
    return themes.transaction(async () => {
      find(await themes.list(), themeId)
      await themes.remove(themeId)
      return { themeId }
    })
  }
})

export const themeApply = defineAction({
  name: 'theme_apply',
  description: 'Apply a library theme to a project: its colours, font, radius and spacing density replace the project theme, as a copy (later library changes do not follow). One undoable step, "Apply theme <name>".',
  input: z.object({ projectId: IdSchema, themeId: IdSchema }),
  run: async ({ projectId, themeId }, ctx) => {
    const entry = find(await store(ctx).list(), themeId)
    const project = await ctx.services.mutate(ctx, projectId, `Apply theme ${entry.name}`, [{ op: 'setTheme', theme: entry.theme }])
    return { version: project.version, theme: project.theme }
  }
})
