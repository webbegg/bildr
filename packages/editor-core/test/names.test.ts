import { describe, expect, it } from 'vitest'
import { componentPrefill, nameProblem, uniqueName } from '../src/names.ts'

const components = [{ id: 'c1', name: 'Card' }, { id: 'c2', name: 'Buttons/Primary' }]

describe('nameProblem', () => {
  it('accepts a new name', () => {
    expect(nameProblem('Hero', components, 'component')).toBe('')
  })

  it('refuses an empty name', () => {
    expect(nameProblem('   ', components, 'component')).toBe('Give the component a name')
  })

  it('refuses a name already used, ignoring case and spaces around it', () => {
    expect(nameProblem('card', components, 'component')).toBe('A component named "Card" already exists')
    expect(nameProblem(' buttons/primary ', components, 'component')).toBe('A component named "Buttons/Primary" already exists')
    expect(nameProblem('Card', [{ id: 'l1', name: 'Card' }], 'layout')).toBe('A layout named "Card" already exists')
  })

  it('lets a rename keep its own name in another case', () => {
    expect(nameProblem('CARD', components, 'component', 'c1')).toBe('')
    expect(nameProblem('Card', components, 'component', 'c2')).toBe('A component named "Card" already exists')
  })
})

describe('uniqueName', () => {
  it('numbers a base that is taken in any case', () => {
    expect(uniqueName('card', components)).toBe('card 2')
    expect(uniqueName('Hero', components)).toBe('Hero')
    expect(uniqueName('Card', [...components, { name: 'CARD 2' }])).toBe('Card 3')
  })
})

describe('componentPrefill', () => {
  it('names a component after the one selected layer', () => {
    expect(componentPrefill(['Pricing card'], components)).toBe('Pricing card')
    expect(componentPrefill(['Container'], components)).toBe('Container')
  })

  it('calls several layers "Component"', () => {
    expect(componentPrefill(['Heading', 'Text'], components)).toBe('Component')
  })

  it('never prefills a name already used', () => {
    expect(componentPrefill(['card'], components)).toBe('card 2')
  })
})
