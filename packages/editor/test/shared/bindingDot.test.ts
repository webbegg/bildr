import { describe, expect, it } from 'vitest'
import type { ModelNode, PropertyDef } from '@bildr/codegen/model'
import type { StyleBindingDot } from '../../src/shared/bindingDot.ts'
import { propertyValues, styleBindCandidates, styleBindingDot, unbindLabel, variantOverridden } from '../../src/shared/bindingDot.ts'
import { bindsKey, boundProperty, propBindingAdd, styleBindingAdd, uniqueComponentName } from '../../src/shared/componentEditor.ts'

/** The hosted `test/editor/bindingDot.test.ts` over the model's properties (`bindings` optional, values in `props.values`), plus the binding helpers of `componentEditor`. */

const prop = (id: string, kind: PropertyDef['kind'], extra: Partial<PropertyDef> = {}): PropertyDef => ({ id, name: id, kind, ...extra })
const node = (id: string, type: string, props?: ModelNode['props'], children?: ModelNode[]): ModelNode => ({ id, type, ...(props ? { props } : {}), ...(children ? { children } : {}) })

describe('styleBindCandidates', () => {
  it('offers only text and select properties whose values are all valid for the style key', () => {
    const properties = [
      prop('padding', 'select', { default: '4' }),
      prop('title', 'text', { default: 'Hello' }),
      prop('empty', 'text'),
      prop('count', 'number', { default: 3 }),
      prop('tone', 'select', { default: 'primary' }),
      prop('used', 'text', { default: '2' })
    ]
    const values: Record<string, string[]> = { used: ['6', 'huge'] }
    const found = styleBindCandidates(properties, 'p', p => [...(p.default === undefined ? [] : [p.default]), ...(values[p.id] ?? [])])
    expect(found.map(p => p.id)).toEqual(['padding', 'empty'])
  })

  it('checks colour keys against the theme colours it is given', () => {
    const properties = [prop('accent', 'text', { default: 'brand' }), prop('hex', 'text', { default: '#ff6600' })]
    const values = (p: PropertyDef) => (p.default === undefined ? [] : [p.default])
    expect(styleBindCandidates(properties, 'bg', values).map(p => p.id)).toEqual(['hex'])
    expect(styleBindCandidates(properties, 'bg', values, ['brand']).map(p => p.id)).toEqual(['accent', 'hex'])
  })

  it('refuses a value that is an expression (a binding is not a token)', () => {
    expect(styleBindCandidates([prop('pad', 'text', { default: { $bind: 'x' } })], 'p', p => (p.default === undefined ? [] : [p.default]))).toEqual([])
  })
})

describe('propertyValues', () => {
  const model = (pages: ModelNode[], components: { id: string, root: ModelNode }[], layouts: { id: string, root: ModelNode }[] = [], pageLayout?: { layout: string, layoutValues: Record<string, string> }) => ({
    modules: { blog: { pages: pages.map(root => ({ id: `pg_${root.id}`, root, ...pageLayout })), components } },
    layouts
  }) as never

  it('is a component property default plus every instance value, in the pages, the other components and the layouts', () => {
    const def = prop('pad', 'select', { default: '4' })
    const withValue = (value: string) => node('i', 'Instance', { component: 'cmp', values: { pad: value } })
    const m = model(
      [node('p1', 'Page', undefined, [withValue('8'), node('i2', 'Instance', { component: 'cmp' })])],
      [{ id: 'cmp', root: node('self', 'Column', undefined, [withValue('1')]) }, { id: 'other', root: node('o', 'Column', undefined, [withValue('2')]) }],
      [{ id: 'lay', root: node('l', 'Column', undefined, [withValue('3')]) }]
    )
    // The component's own tree is not an instance of it; an instance without a value adds none; the other component's counts.
    expect(propertyValues(m, { componentId: 'cmp' }, def)).toEqual(['4', '8', '2', '3'])
  })

  it('is a layout variable default plus every page value of a page using the layout', () => {
    const variable = prop('gap', 'text', { default: '2' })
    const m = model([node('a', 'Page')], [], [{ id: 'lay', root: node('l', 'Column') }], { layout: 'lay', layoutValues: { gap: '6' } })
    expect(propertyValues(m, { layoutId: 'lay' }, variable)).toEqual(['2', '6'])
    expect(propertyValues(m, { layoutId: 'other' }, variable)).toEqual(['2'])
  })
})

describe('styleBindingDot', () => {
  const bound = prop('pad', 'select', { bindings: [{ nodeId: 'n', prop: 'p', target: 'style' }] })
  const tablet = prop('padMd', 'select', { bindings: [{ nodeId: 'n', prop: 'md:p', target: 'style' }] })
  const small = prop('padSm', 'select', { bindings: [{ nodeId: 'n', prop: 'sm:p', target: 'style' }] })

  it('shows a binding of the edited breakpoint key as its own, whose Unbind targets exactly that key', () => {
    expect(styleBindingDot([bound, tablet], 'n', { 'p': '4', 'md:p': '8' }, 'md:p')).toEqual({
      state: 'own',
      property: tablet,
      boundKey: 'md:p',
      actions: [{ kind: 'unbind', key: 'md:p', property: tablet, scope: 'key' }]
    })
    expect(styleBindingDot([bound], 'n', { p: '4' }, 'p')).toEqual({
      state: 'own',
      property: bound,
      boundKey: 'p',
      actions: [{ kind: 'unbind', key: 'p', property: bound, scope: 'key' }]
    })
  })

  it('shows a base-key binding at a breakpoint as inherited, still offering Bind and Create for the breakpoint key', () => {
    const dot = styleBindingDot([bound], 'n', { p: '4' }, 'md:p')
    expect(dot.state).toBe('inherited')
    expect(dot.property).toBe(bound)
    expect(dot.boundKey).toBe('p')
    expect(dot.actions).toEqual([
      { kind: 'unbind', key: 'p', property: bound, scope: 'cascade' },
      { kind: 'bind', key: 'md:p' },
      { kind: 'create', key: 'md:p' }
    ])
  })

  it('labels a cascading unbind explicitly, never as a plain Unbind', () => {
    const unbindOf = (dot: StyleBindingDot) => {
      const action = dot.actions.find(a => a.kind === 'unbind')
      if (action?.kind !== 'unbind') throw new Error('no unbind action')
      return action
    }
    expect(unbindLabel(unbindOf(styleBindingDot([bound], 'n', {}, 'lg:p')), 'property')).toBe('Unbind property on all breakpoints')
    expect(unbindLabel(unbindOf(styleBindingDot([small], 'n', {}, 'lg:p')), 'variable')).toBe('Unbind variable from sm up')
    expect(unbindLabel(unbindOf(styleBindingDot([tablet], 'n', {}, 'md:p')), 'property')).toBe('Unbind property')
  })

  it('an own value at the edited key, or at a breakpoint between the base and it, cancels the inheritance', () => {
    const none = { state: 'none', actions: [{ kind: 'bind', key: 'md:p' }, { kind: 'create', key: 'md:p' }] }
    expect(styleBindingDot([bound], 'n', { 'p': '4', 'md:p': '8' }, 'md:p')).toEqual(none)
    expect(styleBindingDot([bound], 'n', { 'p': '4', 'sm:p': '6' }, 'md:p')).toEqual(none)
    expect(styleBindingDot([bound], 'n', { 'p': '4', 'lg:p': '8' }, 'md:p').state).toBe('inherited')
  })

  it('follows the key\'s own cascade, desktop-first too', () => {
    expect(styleBindingDot([bound], 'n', { 'max-lg:p': '8' }, 'max-md:p').state).toBe('none')
    expect(styleBindingDot([bound], 'n', { 'max-sm:p': '8' }, 'max-md:p').state).toBe('inherited')
  })

  it('finds nothing for another node, a prop binding or an unbound key; a property without bindings is none', () => {
    const propBinding = prop('text', 'text', { bindings: [{ nodeId: 'n', prop: 'p' }] })
    const none = { state: 'none', actions: [{ kind: 'bind', key: 'md:p' }, { kind: 'create', key: 'md:p' }] }
    expect(styleBindingDot([bound], 'other', {}, 'md:p')).toEqual(none)
    expect(styleBindingDot([propBinding], 'n', {}, 'md:p')).toEqual(none)
    expect(styleBindingDot([prop('bare', 'text')], 'n', {}, 'p').state).toBe('none')
    expect(styleBindingDot([], 'n', {}, 'p')).toEqual({ state: 'none', actions: [{ kind: 'bind', key: 'p' }, { kind: 'create', key: 'p' }] })
  })

  it('keeps a non-responsive key (a colour) to its own key', () => {
    const fill = prop('fill', 'text', { bindings: [{ nodeId: 'n', prop: 'bg', target: 'style' }] })
    expect(styleBindingDot([fill], 'n', { bg: 'primary' }, 'bg')).toMatchObject({ state: 'own', boundKey: 'bg' })
  })
})

describe('variantOverridden', () => {
  it('is true where the variant sets a prop, sets a token or removes one', () => {
    const override = { props: { text: 'x' }, style: { p: '2' }, unset: ['gap'] }
    expect(variantOverridden(override, 'prop', 'text')).toBe(true)
    expect(variantOverridden(override, 'prop', 'level')).toBe(false)
    expect(variantOverridden(override, 'style', 'p')).toBe(true)
    expect(variantOverridden(override, 'style', 'gap')).toBe(true)
    expect(variantOverridden(override, 'style', 'bg')).toBe(false)
    expect(variantOverridden(undefined, 'style', 'p')).toBe(false)
  })
})

describe('the binding helpers of the component editor', () => {
  it('tells a prop binding from a style binding of the same key, and finds the property that drives it', () => {
    const text = prop('title', 'text', { bindings: [{ nodeId: 'n', prop: 'text' }] })
    const style = prop('size', 'select', { bindings: [{ nodeId: 'n', prop: 'text', target: 'style' }] })
    expect(bindsKey({ nodeId: 'n', prop: 'text' }, 'n', 'text', 'prop')).toBe(true)
    expect(bindsKey({ nodeId: 'n', prop: 'text' }, 'n', 'text', 'style')).toBe(false)
    expect(boundProperty([text, style], 'n', 'text', 'prop')).toBe(text)
    expect(boundProperty([text, style], 'n', 'text', 'style')).toBe(style)
    expect(boundProperty([prop('bare', 'text')], 'n', 'text', 'prop')).toBeUndefined()
  })

  it('names a new property after the prop or the style, with a number when the name is taken', () => {
    expect(uniqueComponentName('Text', [{ name: 'Text' }, { name: 'Text 2' }])).toBe('Text 3')
    const heading = node('h', 'Heading', { text: 'Hi' })
    expect(propBindingAdd([], heading, 'text')).toEqual({ name: 'Text', kind: 'text', bindings: [{ nodeId: 'h', prop: 'text' }] })
    expect(propBindingAdd([{ name: 'Text' }], heading, 'text')?.name).toBe('Text 2')
    expect(styleBindingAdd([], 'h', 'md:p')).toMatchObject({ name: 'Padding', kind: 'select', bindings: [{ nodeId: 'h', prop: 'md:p', target: 'style' }] })
    expect(styleBindingAdd([], 'h', 'p').options).toContain('4')
  })

  it('offers a select property its options, and none for the props that shape the markup', () => {
    const button = node('b', 'Button')
    expect(propBindingAdd([], button, 'color')).toMatchObject({ kind: 'select', options: expect.arrayContaining(['primary', 'error']) })
    expect(propBindingAdd([], button, 'disabled')).toMatchObject({ kind: 'boolean' })
    // A level, a tag, a link target and `href` shape the generated markup: no property can drive them.
    expect(propBindingAdd([], node('h', 'Heading'), 'level')).toBeUndefined()
    expect(propBindingAdd([], node('c', 'Container'), 'tag')).toBeUndefined()
    expect(propBindingAdd([], node('l', 'Link'), 'to')).toBeUndefined()
    expect(propBindingAdd([], button, 'href')).toBeUndefined()
    expect(propBindingAdd([], button, 'nothing')).toBeUndefined()
  })
})
