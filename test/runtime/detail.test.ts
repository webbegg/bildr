import { describe, expect, it } from 'vitest'
import { createPage } from '#shared/document/factory'
import type { Collection, Page } from '#shared/document/schema'
import { resolveBindings } from '#shared/runtime/bindings'
import { detailKeyField, detailLink, detailPath, detailTitle, keyMatches, parseDetailLink, resolvePageRoute } from '#shared/runtime/detail'
import { resolveLink } from '#shared/runtime/render'

const withSlug: Pick<Collection, 'slug' | 'fields'> = { slug: 'posts', fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'slug', label: 'Slug', type: 'text' }] }
const withoutSlug: Pick<Collection, 'slug' | 'fields'> = { slug: 'users', fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'slug', label: 'Slug', type: 'number' }] }

const home = createPage('Home', 'home')
const about = createPage('About', 'about')
const post: Page = { ...createPage('Post', 'post'), collection: { slug: 'posts' } }
const pages = [home, about, post]

describe('detailKeyField', () => {
  it('uses the chosen field, else a text field named slug, else the record id', () => {
    expect(detailKeyField(withSlug, 'title')).toBe('title')
    expect(detailKeyField(withSlug)).toBe('slug')
    expect(detailKeyField(withoutSlug)).toBe('id')
    expect(detailKeyField(undefined)).toBe('id')
  })
})

describe('keyMatches', () => {
  const record = { id: '7', createdAt: '', updatedAt: '', values: { slug: 'hello', n: 3, empty: null } }
  it('compares the key with the record id or the field value as text', () => {
    expect(keyMatches(record, 'id', '7')).toBe(true)
    expect(keyMatches(record, 'slug', 'hello')).toBe(true)
    expect(keyMatches(record, 'slug', 'Hello')).toBe(false)
    expect(keyMatches(record, 'n', '3')).toBe(true)
    expect(keyMatches(record, 'empty', '')).toBe(false)
    expect(keyMatches(record, 'missing', 'x')).toBe(false)
  })
})

describe('resolvePageRoute', () => {
  it('finds plain pages without a key, the first page by default', () => {
    expect(resolvePageRoute(pages, undefined, undefined)).toEqual({ page: home })
    expect(resolvePageRoute(pages, 'about', undefined)).toEqual({ page: about })
  })

  it('finds a detail page only with a key', () => {
    expect(resolvePageRoute(pages, 'post', 'hello')).toEqual({ page: post, key: 'hello' })
    expect(resolvePageRoute(pages, 'post', undefined)).toBeUndefined()
    expect(resolvePageRoute(pages, 'post', '')).toBeUndefined()
  })

  it('refuses a key on a plain page and unknown pages', () => {
    expect(resolvePageRoute(pages, 'about', 'x')).toBeUndefined()
    expect(resolvePageRoute(pages, 'nope', undefined)).toBeUndefined()
    expect(resolvePageRoute([post], undefined, undefined)).toBeUndefined()
  })
})

describe('detail links', () => {
  it('builds <page>/{{ item.<key> }}, which resolves per record under the base', () => {
    expect(detailLink('post', 'slug')).toBe('post/{{ item.slug }}')
    const resolved = resolveBindings(detailLink('post', 'slug'), { item: { slug: 'hello-world' } })
    expect(resolveLink(resolved, '/p/blog')).toEqual({ to: '/p/blog/post/hello-world', external: false })
  })

  it('keeps working on the template, where the binding stays as written', () => {
    expect(resolveLink(detailLink('post', 'id'), '/p/blog')).toEqual({ to: '/p/blog/post/{{ item.id }}', external: false })
  })

  it('reads a stored link back as a detail link of a detail page', () => {
    expect(parseDetailLink('post/{{ item.slug }}', pages)).toEqual({ page: post, field: 'slug' })
    expect(parseDetailLink('/post/{{item.id}}', pages)).toEqual({ page: post, field: 'id' })
    expect(parseDetailLink('about/{{ item.slug }}', pages)).toBeUndefined()
    expect(parseDetailLink('post', pages)).toBeUndefined()
    expect(parseDetailLink('https://x.dev/post/{{ item.slug }}', pages)).toBeUndefined()
    expect(parseDetailLink('post/{{ item.slug }}/more', pages)).toBeUndefined()
  })

  it('shows a detail page path with its key field', () => {
    expect(detailPath(post, [withSlug])).toBe('/post/:slug')
    expect(detailPath({ ...post, collection: { slug: 'posts', field: 'title' } }, [withSlug])).toBe('/post/:title')
    expect(detailPath({ ...post, collection: { slug: 'users' } }, [withoutSlug])).toBe('/post/:id')
    expect(detailPath(about, [withSlug])).toBe('/about')
  })
})

describe('detailTitle', () => {
  it('is the title field, else the name field, else the key', () => {
    expect(detailTitle({ title: 'Hello', name: 'N' }, 'hello')).toBe('Hello')
    expect(detailTitle({ title: '', name: 'Ada' }, 'ada')).toBe('Ada')
    expect(detailTitle({ title: null }, 'k-1')).toBe('k-1')
    expect(detailTitle(null, 'k-1')).toBe('k-1')
  })
})
