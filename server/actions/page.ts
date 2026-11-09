import { z } from 'zod'
import { createPage, slugify } from '#shared/document/factory'
import { IdSchema, SlugSchema } from '#shared/document/schema'
import { defineAction } from './define'

export const pageAdd = defineAction({
  name: 'page_add',
  description: 'Add an empty page. The slug defaults to a slug of the name; it is the page URL segment.',
  input: z.object({
    projectId: IdSchema,
    name: z.string().min(1).max(100),
    slug: SlugSchema.optional(),
    index: z.number().int().nonnegative().optional().describe('Position in the page list; defaults to the end')
  }),
  run: async ({ projectId, name, slug, index }, ctx) => {
    const page = createPage(name, slug ?? slugify(name))
    const project = await ctx.services.mutate(ctx, projectId, 'Add page', [
      { op: 'addPage', index: index ?? Number.MAX_SAFE_INTEGER, page }
    ])
    return { version: project.version, pageId: page.id, slug: page.slug }
  }
})

export const pageRename = defineAction({
  name: 'page_rename',
  description: 'Change a page name and/or slug.',
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema,
    name: z.string().min(1).max(100).optional(),
    slug: SlugSchema.optional()
  }),
  run: async ({ projectId, pageId, name, slug }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Rename page', [{ op: 'updatePage', pageId, name, slug }])
    return { version: project.version }
  }
})

export const pageDelete = defineAction({
  name: 'page_delete',
  description: 'Delete a page and everything on it. The last page cannot be deleted.',
  input: z.object({ projectId: IdSchema, pageId: IdSchema }),
  run: async ({ projectId, pageId }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Delete page', [{ op: 'removePage', pageId }])
    return { version: project.version }
  }
})
