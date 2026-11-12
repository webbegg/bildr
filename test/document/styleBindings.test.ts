import { describe, expect, it } from 'vitest'
import { createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'
import type { ComponentDefinition, DocNode, Layout, PropertyDef } from '#shared/document/schema'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })

/** A badge whose Tint property drives the text colour of its label (S4d). */
function badge(tint: Partial<PropertyDef> = {}): ComponentDefinition {
  return {
    id: 'badge',
    name: 'Badge',
    root: n('b-root', 'Container', {}, [n('b-label', 'Text', { text: 'New' }, [], { color: 'default' })]),
    properties: [{ id: 'tint', name: 'Tint', kind: 'text', default: 'primary', bindings: [{ nodeId: 'b-label', prop: 'color', target: 'style' }], ...tint }],
    variants: []
  }
}

function project(def: ComponentDefinition, children: DocNode[] = []) {
  // Mobile-first: these fixtures use sm:, md:, lg: keys.
  const p = createProject('P', 'mobile')
  p.components = [def]
  p.pages[0]!.root.children = children
  return p
}

function problems(value: unknown): string[] {
  const result = ProjectSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map(i => i.message)
}

const COLOR_PROBLEM = (value: string, key = 'color') => `"${value}" is not a value of style token "${key}" (use a colour token, a #rgb, #rrggbb or #rrggbbaa hex, or a theme colour)`

describe('style bindings: component properties (S4d)', () => {
  it('accepts a text or select property bound to a style key, and keeps the binding', () => {
    expect(problems(project(badge()))).toEqual([])
    expect(problems(project(badge({ kind: 'select' })))).toEqual([])
    expect(ProjectSchema.parse(project(badge())).components[0]!.properties[0]!.bindings).toEqual([{ nodeId: 'b-label', prop: 'color', target: 'style' }])
  })

  it('checks the default against the style key: tokens and hex for colours', () => {
    expect(problems(project(badge({ default: '#ff6600' })))).toEqual([])
    expect(problems(project(badge({ default: 'nope' })))).toEqual([COLOR_PROBLEM('nope')])
  })

  it('refuses unknown style keys, non-string kinds and slots', () => {
    expect(problems(project(badge({ bindings: [{ nodeId: 'b-label', prop: 'colour', target: 'style' }] })))).toContain('Property "Tint" is bound to the unknown style token "colour"')
    expect(problems(project(badge({ kind: 'number', default: 3 })))).toContain('Property "Tint" (kind number) cannot drive style "color": use a text or select property')
    expect(problems(project(badge({ kind: 'slot', default: undefined, bindings: [{ nodeId: 'b-root', prop: 'children', target: 'style' }] })))).toContain('Slot "Tint" must bind a node\'s children, not a style')
  })

  it('checks instance values against the bound style key, theme colours included', () => {
    const use = (tint: string) => [n('i1', 'Instance', { component: 'badge', tint })]
    expect(problems(project(badge(), use('error-500')))).toEqual([])
    expect(problems(project(badge(), use('#0af')))).toEqual([])
    expect(problems(project(badge(), use('brand')))).toEqual([`Instance "i1": ${COLOR_PROBLEM('brand')}`])
    const themed = project(badge(), use('brand'))
    themed.theme = { ...themed.theme, custom: { brand: '#ff6600' } }
    expect(problems(themed)).toEqual([])
  })

  it('takes responsive keys, checked against that token\'s scale', () => {
    const def = badge({ id: 'pad', name: 'Pad', default: '4', bindings: [{ nodeId: 'b-root', prop: 'md:p', target: 'style' }] })
    expect(problems(project(def))).toEqual([])
    expect(problems(project({ ...def, properties: [{ ...def.properties[0]!, default: '13' }] }))).toEqual(['"13" is not a value of style token "md:p"'])
  })

  it('leaves prop bindings as they were', () => {
    const def = badge({ kind: 'textarea', bindings: [{ nodeId: 'b-label', prop: 'text' }], default: 'Hot' })
    expect(problems(project(def))).toEqual([])
  })
})

describe('style bindings: layout variables (S4d)', () => {
  function main(): Layout {
    return {
      id: 'main',
      name: 'Main',
      root: n('l-root', 'Page', {}, [n('l-bar', 'Container'), n('l-main', 'Container')]),
      slots: [{ id: 'children', name: 'Content', nodeId: 'l-main' }],
      variables: [{ id: 'bar', name: 'Bar colour', kind: 'text', default: 'primary-50', bindings: [{ nodeId: 'l-bar', prop: 'bg', target: 'style' }] }]
    }
  }

  it('checks defaults and page values against the bound style key', () => {
    const p = createProject('P', 'mobile')
    p.layouts = [main()]
    p.pages[0]!.layoutId = 'main'
    expect(problems(p)).toEqual([])
    p.pages[0]!.layoutValues = { bar: '#123456' }
    expect(problems(p)).toEqual([])
    p.pages[0]!.layoutValues = { bar: 'ghost' }
    expect(problems(p)).toEqual([`Page "Home": ${COLOR_PROBLEM('ghost', 'bg')}`])
  })
})
