import { describe, expect, it } from 'vitest'
import { createProject } from '#shared/document/factory'
import type { ComponentDefinition, DocNode, Project, PropertyDef } from '#shared/document/schema'
import { variantOverridden } from '#shared/editor/bindingDot'
import { detailPatch, propertiesTitle, takesPlaceholder } from '#shared/editor/propertyLabels'
import { replaceChoiceHint, replaceChoices, styleAddItems } from '../../app/composables/componentEditor'

const node = (id: string, type: string, extra: Partial<DocNode> = {}): DocNode => ({ id, type, props: {}, style: {}, children: [], ...extra })
const def = (id: string, name: string, children: DocNode[] = []): ComponentDefinition => ({ id, name, root: node(`${id}_root`, 'Container', { children }), properties: [], variants: [] })

/** Card is used twice on Home and once inside Shelf; Shelf holds a Card; Badge is unused. */
function project(): Project {
  const p = createProject('Demo')
  p.components = [
    def('cmp_card', 'Card'),
    def('cmp_shelf', 'Shelf', [node('n_in', 'Instance', { props: { component: 'cmp_card' } })]),
    def('cmp_badge', 'Badge')
  ]
  p.pages[0]!.root.children = [node('n_a', 'Instance', { props: { component: 'cmp_card' } }), node('n_b', 'Instance', { props: { component: 'cmp_card' } }), node('n_s', 'Instance', { props: { component: 'cmp_shelf' } })]
  return p
}

describe('replaceChoices', () => {
  it('lists every component with its usage count; the current one is disabled', () => {
    const choices = replaceChoices(project(), 'cmp_card', [{ pageId: 'p' }])
    expect(choices.map(c => [c.def.name, c.usages, c.disabled, c.reason])).toEqual([
      ['Card', 3, true, 'The current component'],
      ['Shelf', 1, false, ''],
      ['Badge', 0, false, '']
    ])
  })

  it('hints the usage count, and why a choice is disabled', () => {
    expect(replaceChoiceHint({ usages: 2, reason: 'The current component' })).toBe('2 instances · The current component')
    expect(replaceChoiceHint({ usages: 1, reason: '' })).toBe('1 instance')
    expect(replaceChoiceHint({ usages: 0, reason: '' })).toBe('0 instances')
  })

  it('disables the ones that would create a cycle in a component host', () => {
    const choices = replaceChoices(project(), 'cmp_card', [{ componentId: 'cmp_shelf' }])
    expect(choices.find(c => c.def.id === 'cmp_shelf')).toMatchObject({ disabled: true, reason: '"Shelf" cannot contain itself: replacing would create a cycle' })
    expect(choices.find(c => c.def.id === 'cmp_badge')!.disabled).toBe(false)
  })
})

describe('styleAddItems', () => {
  it('offers the style keys the node sets plus Background and Text color, bound ones disabled', () => {
    const properties: PropertyDef[] = [{ id: 'prop_a', name: 'Pad', kind: 'select', bindings: [{ nodeId: 'n_1', prop: 'p', target: 'style' }] }]
    const items = styleAddItems(properties, node('n_1', 'Card', { style: { 'p': '4', 'md:gap': '2' } }))
    expect(items).toEqual([
      { id: 'style:p', label: 'Style · Padding', disabled: true, hint: 'Already a property' },
      { id: 'style:md:gap', label: 'Style · Gap (md)', disabled: false, hint: 'Instances can set it' },
      { id: 'style:bg', label: 'Style · Background', disabled: false, hint: 'Instances can set it' },
      { id: 'style:color', label: 'Style · Text color', disabled: false, hint: 'Instances can set it' }
    ])
  })

  it('offers nothing for an instance or slot content', () => {
    expect(styleAddItems([], node('n_i', 'Instance'))).toEqual([])
    expect(styleAddItems([], node('n_f', 'SlotFill'))).toEqual([])
  })
})

describe('variantOverridden', () => {
  const override = { props: { text: 'Hi' }, style: { bg: 'muted' }, unset: ['p'] }
  it('says whether a variant overrides a prop, a style key, or removes one', () => {
    expect(variantOverridden(override, 'prop', 'text')).toBe(true)
    expect(variantOverridden(override, 'prop', 'level')).toBe(false)
    expect(variantOverridden(override, 'style', 'bg')).toBe(true)
    expect(variantOverridden(override, 'style', 'p')).toBe(true)
    expect(variantOverridden(override, 'style', 'md:bg')).toBe(false)
    expect(variantOverridden(undefined, 'style', 'bg')).toBe(false)
  })
})

describe('properties modal labels', () => {
  it('titles the modal "<Component> properties" or "<Layout> variables"', () => {
    expect(propertiesTitle('component', 'Card')).toBe('Card properties')
    expect(propertiesTitle('layout', 'Site layout')).toBe('Site layout variables')
  })

  it('turns a field edit into an update patch: an empty text removes it', () => {
    expect(detailPatch('description', '  The title ')).toEqual({ description: 'The title' })
    expect(detailPatch('description', '   ')).toEqual({ description: null })
    expect(detailPatch('placeholder', '')).toEqual({ placeholder: null })
    expect(detailPatch('optional', true)).toEqual({ optional: true })
    expect(detailPatch('optional', false)).toEqual({ optional: null })
  })

  it('offers a placeholder for text kinds only', () => {
    expect(['text', 'textarea', 'link', 'image', 'number', 'boolean', 'select', 'slot'].filter(k => takesPlaceholder(k as PropertyDef['kind']))).toEqual(['text', 'textarea', 'link', 'image'])
  })
})
