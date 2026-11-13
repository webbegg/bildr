import { describe, expect, it } from 'vitest'
import { pageOutline, resolveLink } from '#shared/runtime/render'
import { createNode, createPage } from '#shared/document/factory'

describe('resolveLink', () => {
  it('keeps absolute URLs and marks them external', () => {
    expect(resolveLink('https://nuxt.com', '/p/shop')).toEqual({ to: 'https://nuxt.com', external: true })
  })

  it('turns a page slug into a path under the base', () => {
    expect(resolveLink('about', '/p/shop')).toEqual({ to: '/p/shop/about', external: false })
    expect(resolveLink('/about', '/p/shop')).toEqual({ to: '/p/shop/about', external: false })
  })

  // A browser reads `//host` and `/\host` as another origin: an open redirect.
  it('keeps a slug with leading slashes, backslashes or whitespace on this origin', () => {
    for (const to of ['\\evil.com', '\\\\evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', '\n//evil.com']) {
      expect(resolveLink(to, ''), JSON.stringify(to)).toEqual({ to: '/evil.com', external: false })
    }
    expect(resolveLink('//evil.com', '/p/shop')).toEqual({ to: '/p/shop/evil.com', external: false })
  })

  it('returns undefined for an empty link', () => {
    expect(resolveLink('', '/p/shop')).toBeUndefined()
  })
})

describe('pageOutline', () => {
  it('describes the page as indented text an agent can read', () => {
    const page = createPage('Home')
    const row = createNode('Row')
    row.children.push(createNode('Button', { label: 'Buy', to: 'checkout' }))
    page.root.children.push(createNode('Heading', { text: 'Welcome' }), row)

    expect(pageOutline(page)).toBe([
      'Page "Home" (/home)',
      '  Heading: Welcome',
      '  Row',
      '    Button: Buy → checkout'
    ].join('\n'))
  })
})
