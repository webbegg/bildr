// Covers V4/E3 (P2a): the render props the generator refuses are model problems.
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from './fixture'

interface RawNode {
  id: string
  type?: string
  props?: Record<string, unknown>
  children?: RawNode[]
}
interface RawPage { root: RawNode }

const IDX = '.bildr/modules/blog/pages/index.json'
const NEW = '.bildr/modules/blog/pages/new-post.json'
const find = (node: RawNode, id: string): RawNode | undefined =>
  node.id === id ? node : (node.children ?? []).map(child => find(child, id)).find(Boolean)
const problems = (edit: (index: RawPage, newPost: RawPage) => void) => {
  const files = fixtureModelFiles()
  const index = JSON.parse(files[IDX]!) as RawPage
  const newPost = JSON.parse(files[NEW]!) as RawPage
  edit(index, newPost)
  files[IDX] = JSON.stringify(index)
  files[NEW] = JSON.stringify(newPost)
  const result = loadModel(files)
  return result.ok ? [] : result.problems.map(problem => problem.message)
}
const add = (node: RawNode) => (index: RawPage) => {
  index.root.children!.push(node)
}

describe('loadModel reports render props the generator refuses', () => {
  it.each(['script', 'iframe', 'style'])('a container tag "%s"', (tag) => {
    expect(problems(add({ id: 'n_x', type: 'Container', props: { tag } }))).toContainEqual(expect.stringMatching(/tag must be one of/))
  })
  it('a non-string href', () => {
    expect(problems(add({ id: 'n_x', type: 'Link', props: { href: { $bind: 'site.name' }, text: 'x' } }))).toContainEqual(expect.stringMatching(/href/))
    expect(problems(add({ id: 'n_x', type: 'Link', props: { href: 42, text: 'x' } }))).toContainEqual(expect.stringMatching(/props\.href: href must be a URL$/))
  })
  it('accepts a single-slash relative href and refuses // or /\\', () => {
    expect(problems(add({ id: 'n_x', type: 'Link', props: { href: '/about', text: 'x' } }))).toEqual([])
    for (const href of ['//evil.com', '/\\evil.com']) expect(problems(add({ id: 'n_x', type: 'Link', props: { href, text: 'x' } })), href).toContainEqual(expect.stringMatching(/href/))
  })
  it('an Image without src', () => {
    expect(problems(add({ id: 'n_x', type: 'Image', props: { alt: 'x' } }))).toContainEqual(expect.stringMatching(/src/))
  })
  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'vbscript:x'])('an Image src "%s"', (src) => {
    expect(problems(add({ id: 'n_x', type: 'Image', props: { src, alt: 'x' } }))).toContainEqual(expect.stringMatching(/src/))
  })
  it('accepts an http(s) or relative Image src', () => {
    expect(problems(add({ id: 'n_x', type: 'Image', props: { src: '/uploads/a.png', alt: 'x' } }))).toEqual([])
    expect(problems(add({ id: 'n_x', type: 'Image', props: { src: 'https://x.test/a.png', alt: 'x' } }))).toEqual([])
  })
  it.each([0, -1, 2.5, 501, '6', true])('a List loadMore of %j', (loadMore) => {
    expect(problems(add({ id: 'n_x', type: 'List', props: { items: { $bind: 'all' }, as: 'p', loadMore } }))).toContainEqual(expect.stringMatching(/loadMore must be a whole number from 1 to 500/))
  })
  it('accepts a List loadMore page size', () => {
    expect(problems(add({ id: 'n_x', type: 'List', props: { items: { $bind: 'all' }, as: 'p', loadMore: 6 } }))).toEqual([])
  })
  it('an inputType on a multiline input', () => {
    expect(problems((_index, newPost) => {
      find(newPost.root, 'n_body')!.props!.inputType = 'email'
    })).toContainEqual(expect.stringMatching(/multiline input has no inputType/))
  })
})
