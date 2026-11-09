import { describe, expect, it } from 'vitest'
import { getComponent } from '#shared/document/components'
import type { PropDef } from '#shared/document/components'
import { groupedProps, isDefaultProp, propGroup } from '#shared/editor/propGroups'

const props = (type: string) => getComponent(type)!.props
const groups = (type: string) => groupedProps(props(type)).map(g => [g.group, g.props.map(p => p.name)])

describe('Settings prop groups', () => {
  it('orders a Button as Content, Behaviour, Appearance', () => {
    expect(groups('Button')).toEqual([
      ['Content', ['label', 'message']],
      ['Behaviour', ['action', 'to']],
      ['Appearance', ['icon', 'trailingIcon', 'color', 'variant', 'size']]
    ])
  })

  it('puts data and form props under Behaviour and layout under Appearance', () => {
    expect(groups('List')).toEqual([
      ['Behaviour', ['collection', 'limit', 'sortField', 'sortDir', 'filterField', 'filterValue']],
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
