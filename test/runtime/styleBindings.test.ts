import { describe, expect, it } from 'vitest'
import type { ComponentDefinition, DocNode, Layout, Page } from '#shared/document/schema'
import { applySetters, propertySetters, resolveInstance } from '#shared/runtime/instances'
import { resolvePageWithLayout } from '#shared/runtime/layouts'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })
const find = (root: DocNode, id: string): DocNode | undefined => root.id === id ? root : root.children.map(c => find(c, id)).find(Boolean)

/** A badge whose Tint drives its label's text colour and whose Pad drives the root's md padding (S4d). */
function badge(): ComponentDefinition {
  return {
    id: 'badge',
    name: 'Badge',
    root: n('root', 'Container', {}, [n('label', 'Text', { text: 'New' }, [], { color: 'default', mt: '2' })], { p: '2' }),
    properties: [
      { id: 'tint', name: 'Tint', kind: 'text', default: 'primary', bindings: [{ nodeId: 'label', prop: 'color', target: 'style' }] },
      { id: 'pad', name: 'Pad', kind: 'text', bindings: [{ nodeId: 'root', prop: 'md:p', target: 'style' }] }
    ],
    variants: [{ id: 'loud', name: 'Loud', overrides: { label: { style: { color: 'error' } } } }]
  }
}

const instance = (props: DocNode['props'] = {}) => n('i1', 'Instance', { component: 'badge', ...props })

describe('style bindings in instances (S4d)', () => {
  it('sets the bound style key from the instance value, else the default', () => {
    expect(find(resolveInstance(instance({ tint: '#ff6600' }), [badge()])!, 'i1/label')!.style).toEqual({ color: '#ff6600', mt: '2' })
    expect(find(resolveInstance(instance(), [badge()])!, 'i1/label')!.style).toEqual({ color: 'primary', mt: '2' })
  })

  it('keeps the node\'s own style without a value or default, and never touches props', () => {
    const def = badge()
    delete def.properties[0]!.default
    const label = find(resolveInstance(instance(), [def])!, 'i1/label')!
    expect(label.style.color).toBe('default')
    expect(label.props).toEqual({ text: 'New' })
  })

  it('puts a variant override over the default, under the instance value', () => {
    expect(find(resolveInstance(instance({ variant: 'loud' }), [badge()])!, 'i1/label')!.style.color).toBe('error')
    expect(find(resolveInstance(instance({ variant: 'loud', tint: 'success' }), [badge()])!, 'i1/label')!.style.color).toBe('success')
  })

  it('drives breakpoint keys, and the instance\'s own style still wins on the root', () => {
    expect(resolveInstance(instance({ pad: '8' }), [badge()])!.style).toEqual({ 'p': '2', 'md:p': '8' })
    const own = { ...instance({ pad: '8' }), style: { 'md:p': '4' } }
    expect(resolveInstance(own, [badge()])!.style['md:p']).toBe('4')
  })

  it('leaves applySetters to props only', () => {
    const props: Record<string, string> = { text: 'x' }
    applySetters(props, propertySetters(badge().properties, { tint: 'error' }), 'label')
    expect(props).toEqual({ text: 'x' })
  })
})

describe('style bindings in layouts (S4d)', () => {
  const layout: Layout = {
    id: 'main',
    name: 'Main',
    root: n('l-root', 'Page', {}, [n('l-bar', 'Container', {}, [], { bg: 'muted' }), n('l-main', 'Container')]),
    slots: [{ id: 'children', name: 'Content', nodeId: 'l-main' }],
    variables: [{ id: 'bar', name: 'Bar colour', kind: 'text', bindings: [{ nodeId: 'l-bar', prop: 'bg', target: 'style' }] }]
  }
  const page = (layoutValues?: Page['layoutValues']): Page => ({ id: 'p1', name: 'Home', slug: 'home', layoutId: 'main', root: n('proot', 'Page'), ...(layoutValues ? { layoutValues } : {}) })

  it('sets the bound style key from the page value, else keeps the layout node\'s own', () => {
    expect(find(resolvePageWithLayout(page({ bar: '#123456' }), [layout], []), 'proot/@l-bar')!.style).toEqual({ bg: '#123456' })
    expect(find(resolvePageWithLayout(page(), [layout], []), 'proot/@l-bar')!.style).toEqual({ bg: 'muted' })
  })
})
