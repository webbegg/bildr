import { describe, expect, it } from 'vitest'
import { createNode, createPage, createProject } from '#shared/document/factory'
import type { PropertyDef, Project } from '#shared/document/schema'
import { INSTANCE_TYPE } from '#shared/document/components'
import { propertyValues, styleBindCandidates, styleBindingAt } from '#shared/editor/bindingDot'

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

describe('styleBindingAt (RELIABILITY-012)', () => {
  const bound = prop('pad', 'select', { bindings: [{ nodeId: 'n', prop: 'p', target: 'style' }] })
  const tablet = prop('padMd', 'select', { bindings: [{ nodeId: 'n', prop: 'md:p', target: 'style' }] })

  it('finds the binding of the edited breakpoint key', () => {
    expect(styleBindingAt([bound, tablet], 'n', 'md:p', 'p')).toEqual({ property: tablet, key: 'md:p', inherited: false })
    expect(styleBindingAt([bound], 'n', 'p', 'p')).toEqual({ property: bound, key: 'p', inherited: false })
  })

  it('falls back to a binding of the base key, as inherited', () => {
    expect(styleBindingAt([bound], 'n', 'md:p', 'p')).toEqual({ property: bound, key: 'p', inherited: true })
  })

  it('finds nothing for another node, a prop binding or an unbound key', () => {
    const propBinding = prop('text', 'text', { bindings: [{ nodeId: 'n', prop: 'p' }] })
    expect(styleBindingAt([bound], 'other', 'md:p', 'p')).toBeUndefined()
    expect(styleBindingAt([propBinding], 'n', 'md:p', 'p')).toBeUndefined()
    expect(styleBindingAt([], 'n', 'p', 'p')).toBeUndefined()
  })
})
