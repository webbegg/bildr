import { z } from 'zod'
import { newDetailPage } from '#shared/document/detailPages'
import { createPage, slugify } from '#shared/document/factory'
import { IdSchema, PageCollectionSchema, SlugSchema } from '#shared/document/schema'
import type { Project } from '#shared/document/schema'
import { detailPath, pageKeyField } from '#shared/runtime/detail'
import { ActionError, defineAction } from './define'
import { assertFound } from './project'

const CollectionInput = PageCollectionSchema.extend({
  slug: SlugSchema.describe('The collection slug, from project_get collections'),
  field: PageCollectionSchema.shape.field.describe('The URL key: a text field of the collection, or "id" for the record id; without one, a text field named slug, else the record id')
})

const DETAIL_HINT = 'With collection, the page is a detail page: a template rendered once per record of that collection at /<page>/<key>, where {{ item.<field> }} bindings anywhere on the page (its layout and component property values included) read the record; a List\'s own item still wins inside the List. Link to it from a List of the collection with to: "<page>/{{ item.<key field> }}".'

export const pageAdd = defineAction({
  name: 'page_add',
  description: `Add an empty page. The slug defaults to a slug of the name; it is the page URL segment. ${DETAIL_HINT}`,
  input: z.object({
    projectId: IdSchema,
    name: z.string().min(1).max(100),
    slug: SlugSchema.optional(),
    index: z.number().int().nonnegative().optional().describe('Position in the page list; defaults to the end'),
    collection: CollectionInput.optional().describe('Make it a detail page of this collection')
  }),
  run: async ({ projectId, name, slug, index, collection }, ctx) => {
    const page = { ...createPage(name, slug ?? slugify(name)), ...(collection ? { collection } : {}) }
    const project = await ctx.services.mutate(ctx, projectId, 'Add page', [
      { op: 'addPage', index: index ?? Number.MAX_SAFE_INTEGER, page }
    ])
    return { version: project.version, pageId: page.id, slug: page.slug }
  }
})

export const pageCreateDetail = defineAction({
  name: 'page_create_detail',
  description: `Add a detail page of a collection with its content, in one undo step: the page, bound to the collection with its default URL key, holds a Heading bound to the record's title (the title or name text field, else the URL key) and a Text bound to its body (body, content, description, text, summary or excerpt, else another text field; left out without one). The name defaults to the collection name and the slug to a slug of the name, each one no page has. ${DETAIL_HINT} Returns the pageId, slug, nodeIds (the Heading, then the Text), keyField and path, e.g. /posts/:slug.`,
  input: z.object({
    projectId: IdSchema,
    collection: z.string().min(1).max(64).describe('Collection id or slug, from project_get collections'),
    name: z.string().min(1).max(100).optional(),
    slug: SlugSchema.optional(),
    index: z.number().int().nonnegative().optional().describe('Position in the page list; defaults to the end')
  }),
  run: async ({ projectId, collection: ref, name, slug, index }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const collection = current.collections.find(c => c.id === ref) ?? current.collections.find(c => c.slug === ref)
    if (!collection) throw new ActionError('not_found', `Collection "${ref}" not found`)
    const page = newDetailPage(collection, current.pages, { name, slug })
    const project = await ctx.services.mutate(ctx, projectId, 'Create detail page', [
      { op: 'addPage', index: index ?? Number.MAX_SAFE_INTEGER, page }
    ])
    return { version: project.version, pageId: page.id, slug: page.slug, nodeIds: page.root.children.map(n => n.id), ...pageDetail(project, page.id) }
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

/** What a page's collection is now: the reference, its URL key field and its path pattern (e.g. `/blog/:slug`). */
function pageDetail(project: Project, pageId: string) {
  const page = assertFound(project.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
  return { collection: page.collection ?? null, keyField: pageKeyField(page, project.collections) ?? null, path: detailPath(page, project.collections) }
}

export const pageSetCollection = defineAction({
  name: 'page_set_collection',
  description: `Make a page a detail page of a collection ({ slug, field? }), or a plain page again with null. ${DETAIL_HINT} The published app reads the record from the public endpoint, so the collection needs publicRead there. Renaming the collection slug updates the page; deleting the collection makes it a plain page; removing the key field (or changing it from text) falls back to the default key, each in the same undo step. One undo step. Returns the collection, its URL key field and the page path, e.g. /blog/:slug.`,
  input: z.object({
    projectId: IdSchema,
    pageId: IdSchema,
    collection: CollectionInput.nullable()
  }),
  run: async ({ projectId, pageId, collection }, ctx) => {
    const current = await ctx.services.loadProject(projectId)
    const page = assertFound(current.pages.find(p => p.id === pageId), `Page "${pageId}" not found`)
    if (JSON.stringify(page.collection ?? null) === JSON.stringify(collection)) return { version: current.version, ...pageDetail(current, pageId) }
    const project = await ctx.services.mutate(ctx, projectId, collection ? 'Set page collection' : 'Remove page collection', [{ op: 'updatePage', pageId, collection }])
    return { version: project.version, ...pageDetail(project, pageId) }
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
