import { describe, expect, it } from 'vitest'
import type { ComponentDefinition } from '#shared/document/schema'
import { createInteractionMachine, initialMachineState } from '#shared/runtime/interactions'

const def: ComponentDefinition = {
  id: 'c', name: 'C', root: { id: 'r', type: 'Container', props: {}, style: {}, children: [] }, properties: [],
  interactions: [{ id: 'i1', on: 'click', to: 'a' }],
  variants: [
    { id: 'h', name: 'H', overrides: {}, state: { of: '', kind: 'hover' }, interactions: [{ id: 'i2', on: 'mouseleave', to: 'b' }] },
    { id: 'p', name: 'P', overrides: {}, state: { of: '', kind: 'pressed' }, interactions: [{ id: 'i3', on: 'click', to: 'b' }] },
    { id: 'a', name: 'A', overrides: {} },
    { id: 'b', name: 'B', overrides: {} }
  ]
}
const make = () => {
  const state = initialMachineState('')
  return { state, m: createInteractionMachine({ component: () => def, setVariant: () => '' }, state) }
}
describe('interactions of a state, in the renderer\'s event order', () => {
  it('a pressed state\'s click runs before its base\'s', () => {
    const { m, state } = make()
    m.hover(true)
    m.dispatch('mouseenter')
    m.press(true)
    m.press(false)
    m.dispatch('click')
    expect(state.current).toBe('b')
  })
  it('a hover state\'s mouseleave fires', () => {
    const { m, state } = make()
    m.hover(true)
    m.dispatch('mouseenter')
    m.hover(false)
    m.dispatch('mouseleave')
    expect(state.current).toBe('b')
  })
  it('the state shown before a release only counts for the next event', () => {
    const { m, state } = make()
    m.hover(true)
    m.press(true)
    m.press(false)
    m.dispatch('mouseenter')
    m.dispatch('click')
    expect(state.current).toBe('a')
  })
})
