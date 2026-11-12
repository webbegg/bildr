import { describe, expect, it } from 'vitest'
import { detailLink, parseDetailLink, resolvePageRoute, detailKeyField } from '#shared/runtime/detail'
import { resolveLink } from '#shared/runtime/render'
import { resolveBindings } from '#shared/runtime/bindings'
import { listKey, listQueryOf } from '#shared/runtime/list'

const pages = [{ slug: 'home' }, { slug: 'blog-post', collection: { slug: 'posts' } }, { slug: 'about' }]
describe('verify links', () => {
  it('round-trips', () => {
    for (const f of ['slug', 'id', 'title', 'my_key']) {
      const link = detailLink('blog-post', f)
      expect(parseDetailLink(link, pages)).toEqual({ page: pages[1], field: f })
      expect(parseDetailLink('/' + link, pages)?.field).toBe(f)
      expect(parseDetailLink(` ${link} `, pages)?.field).toBe(f)
    }
    expect(parseDetailLink('about/{{ item.slug }}', pages)).toBeUndefined()
    expect(parseDetailLink('blog-post/{{ item.slug }}/x', pages)).toBeUndefined()
    expect(parseDetailLink('https://x.com/blog-post/{{ item.slug }}', pages)).toBeUndefined()
    expect(parseDetailLink('blog-post/{{item.slug}}', pages)?.field).toBe('slug')
    const t0 = performance.now()
    parseDetailLink('a-'.repeat(50000) + '!', pages)
    expect(performance.now() - t0).toBeLessThan(200)
  })
  it('resolves on the published site', () => {
    const to = resolveBindings(detailLink('blog-post', 'slug'), { item: { slug: 'hello-world' }, link: true })
    expect(resolveLink(to, '/p/site')).toEqual({ to: '/p/site/blog-post/hello-world', external: false })
    expect(resolveLink(resolveBindings('/blog-post/{{ item.slug }}', { item: { slug: 'x' }, link: true }), '/p/site')?.to).toBe('/p/site/blog-post/x')
    expect(resolveLink(resolveBindings(detailLink('blog-post', 'title'), { item: { title: 'Why? #1 & more' }, link: true }), '/p/site')?.to).toBe('/p/site/blog-post/Why%3F%20%231%20%26%20more')
  })
  it('routes', () => {
    expect(resolvePageRoute(pages, undefined, undefined)?.page.slug).toBe('home')
    expect(resolvePageRoute(pages, undefined, 'x')).toBeUndefined()
    expect(resolvePageRoute(pages, 'blog-post', undefined)).toBeUndefined()
    expect(resolvePageRoute(pages, 'blog-post', 'k')?.key).toBe('k')
    expect(resolvePageRoute(pages, 'about', 'k')).toBeUndefined()
    expect(detailKeyField({ fields: [{ key: 'slug', type: 'number' } as never] })).toBe('id')
  })
  it('listKey unchanged for non-loadMore', () => {
    const q = listQueryOf({ collection: 'posts', limit: 5, sortField: 'v', sortDir: 'desc', filterField: 'a', filterValue: 'b' })
    expect(listKey(q)).toBe(JSON.stringify(['posts', 5, 'v', 'desc', 'a', 'b']))
    expect(listKey(listQueryOf({ collection: 'posts', loadMore: false }))).toBe(JSON.stringify(['posts', 10, '', 'asc', '', '']))
    expect(listKey(listQueryOf({ collection: 'posts', loadMore: true }))).not.toBe(listKey(listQueryOf({ collection: 'posts' })))
  })
})
