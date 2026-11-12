import { describe, expect, it } from 'vitest'
import { bindValue } from '../../app/composables/useRuntime'
import { createPage } from '#shared/document/factory'
import type { Page } from '#shared/document/schema'
import { resolveBindings } from '#shared/runtime/bindings'
import { detailLink, resolvePageRoute } from '#shared/runtime/detail'
import { pageOutline, resolveLink } from '#shared/runtime/render'

const published = { editable: false, env: {}, onMissingEnv: 'empty' as const }
const href = (to: string, item: Record<string, string>) => resolveLink(bindValue(to, published, item, { link: true }), '/p/site')?.to

describe('detail links encode the bound key', () => {
  it('encodes item values inside a link as one URL segment', () => {
    const link = detailLink('post', 'title')
    expect(href(link, { title: 'What is new?' })).toBe('/p/site/post/What%20is%20new%3F')
    expect(href(link, { title: 'Part #2' })).toBe('/p/site/post/Part%20%232')
    expect(href(link, { title: 'a/b' })).toBe('/p/site/post/a%2Fb')
    expect(href(link, { title: 'Tea & cake 100%' })).toBe('/p/site/post/Tea%20%26%20cake%20100%25')
    expect(href('/post/{{ item.slug }}', { slug: 'hello-world' })).toBe('/p/site/post/hello-world')
  })

  it('keeps a link that is a bound value as it is, so a record URL still links out', () => {
    expect(resolveLink(bindValue('{{ item.url }}', published, { url: 'https://x.com/a?b=1' }, { link: true }), '/p/site')).toEqual({ to: 'https://x.com/a?b=1', external: true })
    expect(resolveLink(bindValue(' {{ item.url }}', published, { url: 'https://x.com/' }, { link: true }), '/p/site')?.to).toBe('https://x.com/')
  })

  it('leaves bound values in external links as they are', () => {
    expect(bindValue('https://maps.example/{{ item.path }}', published, { path: 'es/madrid' }, { link: true })).toBe('https://maps.example/es/madrid')
    expect(bindValue('mailto:{{ item.email }}', published, { email: 'a@b.com' }, { link: true })).toBe('mailto:a@b.com')
    expect(bindValue('tel:{{ item.phone }}', published, { phone: '+34 600' }, { link: true })).toBe('tel:+34 600')
    expect(bindValue('HTTPS://x.com/search?q={{ item.q }}', published, { q: 'a b' }, { link: true })).toBe('HTTPS://x.com/search?q=a b')
  })

  it('leaves text bindings and env refs unencoded', () => {
    expect(resolveBindings('Read {{ item.title }}', { item: { title: 'What is new?' } })).toBe('Read What is new?')
    expect(resolveBindings('{{ env.BASE }}/{{ item.id }}', { item: { id: 'a b' }, env: { BASE: 'https://x.com/a b' }, link: true })).toBe('https://x.com/a b/a b')
    expect(resolveBindings('{{ env.SECTION }}/{{ item.id }}', { item: { id: 'a b' }, env: { SECTION: 'post' }, link: true })).toBe('post/a%20b')
  })

  it('decodes back to the exact key: the route param the router decodes finds the record', () => {
    const post: Page = { ...createPage('Post', 'post'), collection: { slug: 'posts', field: 'title' } }
    for (const title of ['What is new?', 'Part #2', 'a/b', '100%']) {
      const to = href(detailLink('post', 'title'), { title })!
      const segments = to.split('/')
      expect(segments).toHaveLength(5)
      expect(resolvePageRoute([post], decodeURIComponent(segments[3]!), decodeURIComponent(segments[4]!))).toEqual({ page: post, key: title })
    }
  })

  it('shows links encoded in the page outline of a detail record', () => {
    const page: Page = { ...createPage('Post', 'post'), collection: { slug: 'posts', field: 'title' } }
    page.root.children.push({ id: 'n_link', type: 'Link', props: { text: '{{ item.title }}', to: detailLink('post', 'title') }, style: {}, children: [] })
    const outline = pageOutline(page, { item: { title: 'Part #2' } })
    expect(outline).toContain('Link: Part #2 → post/Part%20%232')
  })
})
