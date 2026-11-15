import { describe, expect, it } from 'vitest'
import { NODE_PROP_DEFS, nodeDef, propDefsOf } from '../../src/shared/nodeProps.ts'
import type { PropDef } from '../../src/shared/nodeProps.ts'
import { groupedProps, isActionable, isDefaultProp, propGroup, propOptions } from '../../src/shared/propGroups.ts'

/** The hosted `test/editor/propGroups.test.ts` over the module's node props: how the inspector groups what a node type takes. */

const props = (type: string) => propDefsOf(type)
const groups = (type: string) => groupedProps(props(type), type).map(g => [g.group, g.props.map(p => p.name)])

describe('Settings prop groups', () => {
  it('puts Behaviour first on an actionable node: a Button is Behaviour, Content, Appearance, Advanced', () => {
    expect(groups('Button')).toEqual([
      ['Behaviour', ['type', 'href', 'disabled']],
      ['Content', ['text']],
      ['Appearance', ['icon', 'trailingIcon', 'color', 'variant', 'size']],
      ['Advanced', ['visible']]
    ])
    expect(groups('Link')).toEqual([
      ['Behaviour', ['to', 'href']],
      ['Content', ['text']],
      ['Appearance', ['icon']],
      ['Advanced', ['visible']]
    ])
  })

  it('tells actionable nodes: Button and Link, or anything with a link-to prop', () => {
    expect(isActionable(props('Button'), 'Button')).toBe(true)
    expect(isActionable(props('Link'), 'Link')).toBe(true)
    expect(isActionable([], 'Link')).toBe(true)
    expect(isActionable([{ name: 'to', label: 'Link to', kind: 'page', default: '' }], 'Instance')).toBe(true)
    expect(isActionable(props('Form'), 'Form')).toBe(false)
    expect(isActionable(props('Input'), 'Input')).toBe(false)
  })

  it('keeps Content first on the other nodes', () => {
    expect(groups('Heading')[0]![0]).toBe('Content')
    expect(groupedProps(props('Button'), 'Button').map(g => g.group)).toEqual(['Behaviour', 'Content', 'Appearance', 'Advanced'])
  })

  it('explains the select options that need it, as a one-line description', () => {
    const type = props('Button').find(p => p.name === 'type')!
    expect(propOptions(type)).toEqual([
      { label: 'button', value: 'button', description: 'Does nothing by itself: its interactions run' },
      { label: 'submit', value: 'submit', description: 'Sends the enclosing Form' }
    ])
    const level = props('Heading').find(p => p.name === 'level')!
    expect(propOptions(level)[0]).toEqual({ label: '1', value: '1' })
    const layout = props('List').find(p => p.name === 'layout')!
    expect(propOptions(layout).every(o => o.description)).toBe(true)
    const inputType = props('Input').find(p => p.name === 'inputType')!
    expect(propOptions(inputType).filter(o => o.description).map(o => o.value)).toEqual(['text', 'email', 'password', 'number'])
  })

  it('puts data and form props under Behaviour and layout under Appearance', () => {
    expect(groups('List')).toEqual([
      ['Content', ['as', 'empty', 'loading']],
      ['Behaviour', ['hideWhenEmpty', 'loadMore']],
      ['Appearance', ['layout']],
      ['Advanced', ['tag', 'visible']]
    ])
    expect(groups('Input')).toEqual([
      ['Content', ['label', 'placeholder']],
      ['Behaviour', ['field', 'inputType']],
      ['Advanced', ['multiline', 'rows', 'visible']]
    ])
    // A Form has no props of its own: its action and fields are the data panel (FormBindingPanel).
    expect(groups('Form')).toEqual([['Advanced', ['visible']]])
    expect(groups('Heading')).toEqual([['Content', ['text']], ['Appearance', ['level']], ['Advanced', ['visible']]])
  })

  it('sends props it does not know to Advanced, and has no groups without props', () => {
    const custom: PropDef = { name: 'tabIndex', label: 'Tab index', kind: 'number', default: 0 }
    expect(propGroup(custom)).toBe('Advanced')
    expect(propGroup({ ...custom, name: 'caption', kind: 'textarea' })).toBe('Content')
    expect(groupedProps([])).toEqual([])
  })

  it('tells a prop at its default from a changed one (a number select compares as text)', () => {
    const level = props('Heading').find(p => p.name === 'level')!
    expect(isDefaultProp(level, {})).toBe(true)
    expect(isDefaultProp(level, { level: 2 })).toBe(true)
    expect(isDefaultProp(level, { level: 1 })).toBe(false)
    const wrap = props('Row').find(p => p.name === 'wrap')!
    expect(isDefaultProp(wrap, { wrap: false })).toBe(true)
    expect(isDefaultProp(wrap, { wrap: true })).toBe(false)
  })
})

describe('the props of each node type', () => {
  it('knows the types the palette inserts, an Instance and a SlotFill, and gives every node a Visible switch but the last two', () => {
    expect(nodeDef('Heading')).toMatchObject({ label: 'Heading', icon: 'i-lucide-heading', container: false })
    expect(nodeDef('Page')).toMatchObject({ container: true })
    expect(nodeDef('Mystery')).toBeUndefined()
    expect(props('Instance')).toEqual([])
    expect(props('SlotFill')).toEqual([])
    expect(props('Text').map(p => p.name)).toEqual(['text', 'visible'])
  })

  it('offers only props the generator takes for the type (the render rules\' NODE_PROPS)', async () => {
    const { NODE_PROPS } = await import('@bildr/codegen/render')
    for (const [type, defs] of Object.entries(NODE_PROP_DEFS)) {
      expect(defs.map(def => def.name).filter(name => !NODE_PROPS[type]!.includes(name)), type).toEqual([])
    }
  })
})
