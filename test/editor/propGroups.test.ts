import { describe, expect, it } from 'vitest'
import { getComponent } from '#shared/document/components'
import type { PropDef } from '#shared/document/components'
import { groupedProps, isActionable, isDefaultProp, propGroup, propOptions } from '#shared/editor/propGroups'

const props = (type: string) => getComponent(type)!.props
const groups = (type: string) => groupedProps(props(type), type).map(g => [g.group, g.props.map(p => p.name)])

describe('Settings prop groups', () => {
  it('puts Behaviour first on an actionable node: a Button is Behaviour, Content, Appearance', () => {
    expect(groups('Button')).toEqual([
      ['Behaviour', ['action', 'to']],
      ['Content', ['label', 'message']],
      ['Appearance', ['icon', 'trailingIcon', 'color', 'variant', 'size']]
    ])
    expect(groups('Link')).toEqual([
      ['Behaviour', ['to']],
      ['Content', ['label']],
      ['Appearance', ['icon']]
    ])
  })

  it('tells actionable nodes: Button and Link, or anything with an action or a link-to prop', () => {
    expect(isActionable(props('Button'), 'Button')).toBe(true)
    expect(isActionable(props('Link'), 'Link')).toBe(true)
    expect(isActionable([], 'Link')).toBe(true)
    expect(isActionable([{ name: 'action', label: 'Action', kind: 'select', default: 'a' }], 'Instance')).toBe(true)
    expect(isActionable([{ name: 'href', label: 'Href', kind: 'link', default: '' }], 'Instance')).toBe(true)
    // A Form's redirect is what happens after its submit, not what it does.
    expect(isActionable(props('Form'), 'Form')).toBe(false)
    expect(isActionable(props('Input'), 'Input')).toBe(false)
  })

  it('keeps Content first on the other nodes', () => {
    expect(groups('Form')[0]![0]).toBe('Content')
    expect(groups('Heading')[0]![0]).toBe('Content')
    expect(groupedProps(props('Button')).map(g => g.group)).toEqual(['Behaviour', 'Content', 'Appearance'])
  })

  it('explains the select options that need it, as a one-line description', () => {
    const action = props('Button').find(p => p.name === 'action')!
    expect(propOptions(action)).toEqual([
      { label: 'link', value: 'link', description: 'Opens the Link to page or URL' },
      { label: 'submit', value: 'submit', description: 'Sends the enclosing Form' },
      { label: 'toast', value: 'toast', description: 'Shows the toast message' }
    ])
    const level = props('Heading').find(p => p.name === 'level')!
    expect(propOptions(level)[0]).toEqual({ label: '1', value: '1' })
    const layout = props('List').find(p => p.name === 'layout')!
    expect(propOptions(layout).every(o => o.description)).toBe(true)
    const inputType = props('Input').find(p => p.name === 'inputType')!
    expect(propOptions(inputType).every(o => o.description)).toBe(true)
  })

  it('puts data and form props under Behaviour and layout under Appearance', () => {
    expect(groups('List')).toEqual([
      ['Behaviour', ['collection', 'limit', 'sortField', 'sortDir', 'filterField', 'filterValue', 'loadMore']],
      ['Appearance', ['layout']]
    ])
    expect(groups('Form')).toEqual([
      ['Content', ['successMessage']],
      ['Behaviour', ['collection', 'redirectTo', 'resetOnSuccess']]
    ])
    expect(groups('Input')).toEqual([
      ['Content', ['label', 'placeholder']],
      ['Behaviour', ['field', 'inputType']]
    ])
    expect(groups('Heading')).toEqual([['Content', ['text']], ['Appearance', ['level']]])
  })

  it('sends props it does not know to Advanced, and has no groups without props', () => {
    const custom: PropDef = { name: 'tabIndex', label: 'Tab index', kind: 'number', default: 0 }
    expect(propGroup(custom)).toBe('Advanced')
    expect(propGroup({ ...custom, name: 'caption', kind: 'textarea' })).toBe('Content')
    expect(groupedProps([])).toEqual([])
  })

  it('tells a prop at its component default from a changed one', () => {
    const level = props('Heading').find(p => p.name === 'level')!
    expect(isDefaultProp(level, {})).toBe(true)
    expect(isDefaultProp(level, { level: '2' })).toBe(true)
    expect(isDefaultProp(level, { level: '1' })).toBe(false)
  })
})
