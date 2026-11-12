import { describe, expect, it } from 'vitest'
import { createNode, createPage, createProject } from '#shared/document/factory'
import type { PropertyDef, Project } from '#shared/document/schema'
import { INSTANCE_TYPE } from '#shared/document/components'
import type { StyleBindingDot } from '#shared/editor/bindingDot'
import { propertyValues, styleBindCandidates, styleBindingDot, unbindLabel } from '#shared/editor/bindingDot'

const prop = (id: string, kind: PropertyDef['kind'], extra: Partial<PropertyDef> = {}): PropertyDef => ({ id, name: id, kind, bindings: [], ...extra })

describe('styleBindCandidates (RELIABILITY-010)', () => {
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
})

describe('propertyValues', () => {
  it('is a component property default plus every instance value', () => {
    const project = createProject('P') as Project
    const def = { id: 'cmp', name: 'Card', root: createNode('Column'), properties: [prop('pad', 'select', { default: '4' })], variants: [] }
    project.components.push(def as never)
    const a = createNode(INSTANCE_TYPE, { component: 'cmp', pad: '8' })
    const b = createNode(INSTANCE_TYPE, { component: 'cmp' })
    project.pages[0]!.root.children.push(a, b)
    expect(propertyValues(project, { componentId: 'cmp' }, def.properties[0]!)).toEqual(['4', '8'])
  })

  it('is a layout variable default plus every page value', () => {
    const project = createProject('P') as Project
    const variable = prop('gap', 'text', { default: '2' })
    project.layouts.push({ id: 'lay', name: 'L', root: createNode('Column'), slots: [], variables: [variable] } as never)
    const other = createPage('About')
    project.pages[0]!.layoutId = 'lay'
    project.pages[0]!.layoutValues = { gap: '6' }
    other.layoutId = 'lay'
    project.pages.push(other)
    expect(propertyValues(project, { layoutId: 'lay' }, variable)).toEqual(['2', '6'])
  })
})

describe('styleBindingDot (RELIABILITY-012, RELIABILITY-T8-001)', () => {
  const bound = prop('pad', 'select', { bindings: [{ nodeId: 'n', prop: 'p', target: 'style' }] })
  const tablet = prop('padMd', 'select', { bindings: [{ nodeId: 'n', prop: 'md:p', target: 'style' }] })
  const small = prop('padSm', 'select', { bindings: [{ nodeId: 'n', prop: 'sm:p', target: 'style' }] })

  it('shows a binding of the edited breakpoint key as its own, whose Unbind targets exactly that key', () => {
    expect(styleBindingDot([bound, tablet], 'n', { 'p': '4', 'md:p': '8' }, 'md:p')).toEqual({
      state: 'own', property: tablet, boundKey: 'md:p',
      actions: [{ kind: 'unbind', key: 'md:p', property: tablet, scope: 'key' }]
    })
    expect(styleBindingDot([bound], 'n', { p: '4' }, 'p')).toEqual({
      state: 'own', property: bound, boundKey: 'p',
      actions: [{ kind: 'unbind', key: 'p', property: bound, scope: 'key' }]
    })
  })

  it('shows a base-key binding at a breakpoint as inherited, still offering Bind and Create for the breakpoint key (a, b)', () => {
    const dot = styleBindingDot([bound], 'n', { p: '4' }, 'md:p')
    expect(dot.state).toBe('inherited')
    expect(dot.property).toBe(bound)
    expect(dot.boundKey).toBe('p')
    expect(dot.actions).toEqual([
      { kind: 'unbind', key: 'p', property: bound, scope: 'cascade' },
      { kind: 'bind', key: 'md:p' },
      { kind: 'create', key: 'md:p' }
    ])
    expect(dot.actions.some(a => a.kind === 'unbind' && a.scope === 'key')).toBe(false)
  })

  it('labels a cascading unbind explicitly, never as a plain Unbind (a)', () => {
    const unbindOf = (dot: StyleBindingDot) => {
      const action = dot.actions.find(a => a.kind === 'unbind')
      if (action?.kind !== 'unbind') throw new Error('no unbind action')
      return action
    }
    expect(unbindLabel(unbindOf(styleBindingDot([bound], 'n', {}, 'lg:p')), 'property')).toBe('Unbind property on all breakpoints')
    expect(unbindLabel(unbindOf(styleBindingDot([small], 'n', {}, 'lg:p')), 'variable')).toBe('Unbind variable from sm up')
    expect(unbindLabel(unbindOf(styleBindingDot([tablet], 'n', {}, 'md:p')), 'property')).toBe('Unbind property')
  })

  it('inherits through the mobile-first cascade: the nearest smaller bound key', () => {
    expect(styleBindingDot([bound, small], 'n', {}, 'lg:p')).toMatchObject({ state: 'inherited', property: small, boundKey: 'sm:p' })
  })

  it('an own value at the edited key, or at a breakpoint between the base and it, cancels the inheritance (c)', () => {
    const none = { state: 'none', actions: [{ kind: 'bind', key: 'md:p' }, { kind: 'create', key: 'md:p' }] }
    expect(styleBindingDot([bound], 'n', { 'p': '4', 'md:p': '8' }, 'md:p')).toEqual(none)
    expect(styleBindingDot([bound], 'n', { 'p': '4', 'sm:p': '6' }, 'md:p')).toEqual(none)
    // A value at a wider breakpoint does not reach the edited one.
    expect(styleBindingDot([bound], 'n', { 'p': '4', 'lg:p': '8' }, 'md:p').state).toBe('inherited')
  })

  it('follows the key\'s own cascade, desktop-first too (S37)', () => {
    expect(styleBindingDot([bound], 'n', { 'max-lg:p': '8' }, 'max-md:p').state).toBe('none')
    expect(styleBindingDot([bound], 'n', { 'max-sm:p': '8' }, 'max-md:p').state).toBe('inherited')
  })

  it('finds nothing for another node, a prop binding or an unbound key', () => {
    const propBinding = prop('text', 'text', { bindings: [{ nodeId: 'n', prop: 'p' }] })
    const none = { state: 'none', actions: [{ kind: 'bind', key: 'md:p' }, { kind: 'create', key: 'md:p' }] }
    expect(styleBindingDot([bound], 'other', {}, 'md:p')).toEqual(none)
    expect(styleBindingDot([propBinding], 'n', {}, 'md:p')).toEqual(none)
    expect(styleBindingDot([], 'n', {}, 'p')).toEqual({ state: 'none', actions: [{ kind: 'bind', key: 'p' }, { kind: 'create', key: 'p' }] })
  })

  it('keeps a non-responsive key (a colour) to its own key', () => {
    const fill = prop('fill', 'text', { bindings: [{ nodeId: 'n', prop: 'bg', target: 'style' }] })
    expect(styleBindingDot([fill], 'n', { bg: 'primary' }, 'bg')).toMatchObject({ state: 'own', boundKey: 'bg' })
  })
})
