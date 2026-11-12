import { describe, expect, it } from 'vitest'
import { createCollection, createNode, createPage } from '#shared/document/factory'
import type { Collection, DocNode, Page } from '#shared/document/schema'
import { detailCommands, detailLinkItems, detailPageSteps, itemScope, itemVariables, keyFieldItems } from '#shared/editor/detailPages'

const posts: Collection = createCollection('Posts', 'posts', [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'slug', label: 'Slug', type: 'text' },
  { key: 'body', label: 'Body', type: 'text' },
  { key: 'views', label: 'Views', type: 'number' }
])
const users: Collection = createCollection('Users', 'users', [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' }
])
const tags: Collection = createCollection('Tags', 'tags', [{ key: 'count', label: 'Count', type: 'number' }])
const collections = [posts, users, tags]

function list(collection: string, children: DocNode[] = []): DocNode {
  return { ...createNode('List', { collection }), children }
}

const link = createNode('Link')
const userLink = createNode('Link')
const loose = createNode('Text')
const home: Page = createPage('Home', 'home')
home.root.children = [list('posts', [link]), list('users', [userLink]), loose]
const post: Page = { ...createPage('Post', 'post'), collection: { slug: 'posts' } }
const inPost = createNode('Text')
const usersInPost = createNode('Text')
post.root.children = [inPost, list('users', [usersInPost])]
const person: Page = { ...createPage('Person', 'person'), collection: { slug: 'users', field: 'email' } }
const project = { pages: [home, post, person], collections }

describe('itemScope', () => {
  it('is the collection of the nearest List around the node', () => {
    expect(itemScope(project, home, link.id)?.slug).toBe('posts')
    expect(itemScope(project, home, userLink.id)?.slug).toBe('users')
  })

  it('is the page collection on a detail page outside Lists, and a List inside it wins', () => {
    expect(itemScope(project, post, inPost.id)?.slug).toBe('posts')
    expect(itemScope(project, post, post.root.id)?.slug).toBe('posts')
    expect(itemScope(project, post, usersInPost.id)?.slug).toBe('users')
  })

  it('is undefined outside Lists on a plain page, or without a node', () => {
    expect(itemScope(project, home, loose.id)).toBeUndefined()
    expect(itemScope(project, home, null)).toBeUndefined()
  })
})

describe('detailLinkItems', () => {
  it('offers each detail page, enabled only where its collection is the item', () => {
    expect(detailLinkItems(project, posts)).toEqual([
      { label: 'Detail: Post', value: 'post/{{ item.slug }}', disabled: false, description: '/post/:slug' },
      { label: 'Detail: Person', value: 'person/{{ item.email }}', disabled: true, description: 'Put this inside a List of Users, or on Person' }
    ])
  })

  it('disables every entry without an item', () => {
    expect(detailLinkItems(project, undefined).map(i => i.disabled)).toEqual([true, true])
  })
})

describe('itemVariables', () => {
  it('lists the fields as item refs, then id, createdAt and updatedAt', () => {
    expect(itemVariables(users)).toEqual([
      { name: 'item.name', label: 'Name', ref: '{{ item.name }}' },
      { name: 'item.email', label: 'Email', ref: '{{ item.email }}' },
      { name: 'item.id', label: 'Record id', ref: '{{ item.id }}' },
      { name: 'item.createdAt', label: 'Created', ref: '{{ item.createdAt }}' },
      { name: 'item.updatedAt', label: 'Updated', ref: '{{ item.updatedAt }}' }
    ])
  })
})

describe('keyFieldItems', () => {
  it('lists the text fields, then Record id', () => {
    expect(keyFieldItems(users)).toEqual([
      { label: 'Name (name)', value: 'name' },
      { label: 'Email (email)', value: 'email' },
      { label: 'Record id', value: 'id' }
    ])
    expect(keyFieldItems(tags)).toEqual([{ label: 'Record id', value: 'id' }])
  })

  it('disables Record id when a text slug field is the default key (a page key can only name a text field)', () => {
    expect(keyFieldItems(posts).at(-1)).toEqual({ label: 'Record id', value: 'id', disabled: true, description: 'Only without a text field named slug' })
  })
})

describe('detailPageSteps', () => {
  it('adds a page bound to the collection with a Heading on the title and a Text on the body', () => {
    expect(detailPageSteps(posts, [home])).toEqual({
      page: { name: 'Posts', slug: 'posts', collection: { slug: 'posts' } },
      nodes: [
        { type: 'Heading', props: { text: '{{ item.title }}' } },
        { type: 'Text', props: { text: '{{ item.body }}' } }
      ]
    })
  })

  it('binds the Heading to name, else the key, and leaves the Text out without another text field', () => {
    expect(detailPageSteps(users, []).nodes).toEqual([
      { type: 'Heading', props: { text: '{{ item.name }}' } },
      { type: 'Text', props: { text: '{{ item.email }}' } }
    ])
    expect(detailPageSteps(tags, []).nodes).toEqual([{ type: 'Heading', props: { text: '{{ item.id }}' } }])
  })

  it('gives the page a name and slug no page has', () => {
    const taken = [{ ...createPage('Posts', 'posts') }]
    expect(detailPageSteps(posts, taken).page).toMatchObject({ name: 'Posts 2', slug: 'posts-2' })
  })
})

describe('detailCommands', () => {
  it('offers "Create detail page for" each collection and "Set page collection ›" each choice but the current one', () => {
    const commands = detailCommands(collections, { pageCollection: 'posts', onPage: true }, { create: () => {}, setCollection: () => {} })
    expect(commands.map(c => c.label)).toEqual([
      'Create detail page for Posts',
      'Create detail page for Users',
      'Create detail page for Tags',
      'Set page collection › None',
      'Set page collection › Posts',
      'Set page collection › Users',
      'Set page collection › Tags'
    ])
    expect(commands.map(c => c.enabled(undefined))).toEqual([true, true, true, true, false, true, true])
  })

  it('disables Set page collection away from a page', () => {
    const commands = detailCommands(collections, { pageCollection: undefined, onPage: false }, { create: () => {}, setCollection: () => {} })
    expect(commands.filter(c => c.label.startsWith('Set')).every(c => !c.enabled(undefined))).toBe(true)
  })
})
