import { describe, expect, it } from 'vitest'
import { createCollection, createPage, createProject } from '#shared/document/factory'
import { applyOperations } from '#shared/document/operations'
import { ProjectSchema } from '#shared/document/schema'
import type { Project } from '#shared/document/schema'

/** A project with a Posts collection (title, slug, views) and a Post page. */
function setup(): Project {
  const project = createProject('Blog')
  project.collections.push(createCollection('Posts', 'posts', [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'slug', label: 'Slug', type: 'text' },
    { key: 'views', label: 'Views', type: 'number' }
  ]))
  project.pages.push({ ...createPage('Post', 'post'), id: 'post' })
  return ProjectSchema.parse(project)
}

const messages = (project: Project) => {
  const parsed = ProjectSchema.safeParse(project)
  return parsed.success ? [] : parsed.error.issues.map(i => i.message)
}

describe('a page bound to a collection (detail page)', () => {
  it('accepts a collection slug with or without a text key field', () => {
    const project = setup()
    project.pages[1]!.collection = { slug: 'posts' }
    expect(messages(project)).toEqual([])
    project.pages[1]!.collection = { slug: 'posts', field: 'title' }
    expect(messages(project)).toEqual([])
  })

  it('refuses a missing collection, a missing field and a field that is not text', () => {
    const project = setup()
    project.pages[1]!.collection = { slug: 'news' }
    expect(messages(project)).toEqual(['Page "Post" shows the unknown collection "news"'])
    project.pages[1]!.collection = { slug: 'posts', field: 'body' }
    expect(messages(project)).toEqual(['Page "Post": "Posts" has no field "body" for the URL key'])
    project.pages[1]!.collection = { slug: 'posts', field: 'views' }
    expect(messages(project)).toEqual(['Page "Post": the URL key "views" must be a text field, not number'])
  })

  it('reads pages saved before detail pages as plain pages', () => {
    const project = setup()
    expect(project.pages[1]).not.toHaveProperty('collection')
  })
})

describe('updatePage with a collection', () => {
  it('sets it and returns the exact inverse, which removes it again', () => {
    const project = setup()
    const before = structuredClone(project)
    const inverse = applyOperations(project, [{ op: 'updatePage', pageId: 'post', collection: { slug: 'posts', field: 'slug' } }])
    expect(project.pages[1]!.collection).toEqual({ slug: 'posts', field: 'slug' })
    expect(inverse).toEqual([{ op: 'updatePage', pageId: 'post', collection: null }])
    applyOperations(project, inverse)
    expect(project).toEqual(before)
    expect(project.pages[1]).not.toHaveProperty('collection')
  })

  it('restores the previous collection exactly, and leaves name and slug alone', () => {
    const project = setup()
    applyOperations(project, [{ op: 'updatePage', pageId: 'post', collection: { slug: 'posts' } }])
    const before = structuredClone(project)
    const inverse = applyOperations(project, [{ op: 'updatePage', pageId: 'post', collection: { slug: 'posts', field: 'title' } }])
    expect(inverse).toEqual([{ op: 'updatePage', pageId: 'post', collection: { slug: 'posts' } }])
    applyOperations(project, inverse)
    expect(project).toEqual(before)
  })

  it('refuses a collection the project does not have, leaving the project untouched', () => {
    const project = setup()
    const before = structuredClone(project)
    expect(() => applyOperations(project, [{ op: 'updatePage', pageId: 'post', collection: { slug: 'news' } }])).toThrow('Page "Post" shows the unknown collection "news"')
    expect(() => applyOperations(project, [{ op: 'updatePage', pageId: 'post', collection: { slug: 'posts', field: 'views' } }])).toThrow('must be a text field')
    expect(project).toEqual(before)
  })

  it('refuses removing a collection a page still shows, unless the same batch clears the page', () => {
    const project = setup()
    applyOperations(project, [{ op: 'updatePage', pageId: 'post', collection: { slug: 'posts' } }])
    const id = project.collections[0]!.id
    expect(() => applyOperations(project, [{ op: 'removeCollection', collectionId: id }])).toThrow('unknown collection "posts"')
    applyOperations(project, [{ op: 'updatePage', pageId: 'post', collection: null }, { op: 'removeCollection', collectionId: id }])
    expect(project.collections).toEqual([])
  })

  it('takes a collection on addPage', () => {
    const project = setup()
    const page = { ...createPage('Article', 'article'), collection: { slug: 'posts' } }
    applyOperations(project, [{ op: 'addPage', index: 9, page }])
    expect(project.pages[2]!.collection).toEqual({ slug: 'posts' })
    expect(() => applyOperations(project, [{ op: 'addPage', index: 9, page: { ...createPage('X', 'x'), collection: { slug: 'nope' } } }])).toThrow('unknown collection "nope"')
  })
})
