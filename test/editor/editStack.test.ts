import { describe, expect, it } from 'vitest'
import type { EditLevel } from '#shared/editor/editStack'
import { goToLevel, leaveLevel, levelTrail, openLevel, pruneLevels, topLevel } from '#shared/editor/editStack'

const card = { kind: 'component', id: 'cmp_card' } as const
const button = { kind: 'component', id: 'cmp_button' } as const
const site = { kind: 'layout', id: 'lay_site' } as const

describe('openLevel', () => {
  it('opens a first level from the page, remembering the page selection', () => {
    expect(openLevel([], card, ['n_inst'])).toEqual([{ ...card, back: ['n_inst'] }])
  })

  it('pushes a nested component onto the stack', () => {
    const stack = openLevel(openLevel([], card, ['n_inst']), button, ['n_btn'], { nested: true })
    expect(stack).toEqual([{ ...card, back: ['n_inst'] }, { ...button, back: ['n_btn'] }])
    expect(topLevel(stack)).toEqual({ ...button, back: ['n_btn'] })
  })

  it('replaces the stack when not nested (Assets, ⌘K), keeping the page selection to go back to', () => {
    const stack = openLevel([], card, ['n_inst'])
    expect(openLevel(stack, site, ['n_root'])).toEqual([{ ...site, back: ['n_inst'] }])
  })

  it('goes back to a level already on the stack instead of opening it twice', () => {
    const stack = openLevel(openLevel([], card, ['a']), button, ['b'], { nested: true })
    expect(openLevel(stack, card, ['x'], { nested: true })).toEqual([{ ...card, back: ['a'] }])
    expect(openLevel(stack, button, ['x'], { nested: true })).toBe(stack)
  })
})

describe('leaveLevel (Esc with nothing selected, and Done)', () => {
  it('goes up one level and restores the selection it was opened from', () => {
    const stack: EditLevel[] = [{ ...card, back: ['n_inst'] }, { ...button, back: ['n_btn'] }]
    expect(leaveLevel(stack)).toEqual({ stack: [{ ...card, back: ['n_inst'] }], restore: ['n_btn'] })
    expect(leaveLevel([{ ...card, back: ['n_inst'] }])).toEqual({ stack: [], restore: ['n_inst'] })
  })

  it('does nothing on the page', () => {
    expect(leaveLevel([])).toEqual({ stack: [], restore: null })
  })
})

describe('goToLevel (a breadcrumb click)', () => {
  const stack: EditLevel[] = [{ ...card, back: ['p1'] }, { ...button, back: ['c1'] }, { kind: 'component', id: 'cmp_icon', back: ['b1'] }]

  it('keeps the levels up to the crumb and restores the selection of the level above it', () => {
    expect(goToLevel(stack, 0)).toEqual({ stack: stack.slice(0, 1), restore: ['c1'] })
    expect(goToLevel(stack, -1)).toEqual({ stack: [], restore: ['p1'] })
  })

  it('changes nothing on the current crumb', () => {
    expect(goToLevel(stack, 2)).toEqual({ stack, restore: null })
  })
})

describe('pruneLevels', () => {
  it('drops a deleted level and everything opened from it', () => {
    const stack: EditLevel[] = [{ ...card, back: [] }, { ...button, back: [] }]
    expect(pruneLevels(stack, level => level.id !== 'cmp_card')).toEqual([])
    expect(pruneLevels(stack, level => level.id !== 'cmp_button')).toEqual(stack.slice(0, 1))
    expect(pruneLevels(stack, () => true)).toBe(stack)
  })
})

describe('levelTrail', () => {
  it('names the page, then each level, with the index a click goes to', () => {
    const names: Record<string, string> = { cmp_card: 'Card', cmp_button: 'Button', lay_site: 'Site layout' }
    const stack: EditLevel[] = [{ ...card, back: [] }, { ...button, back: [] }]
    expect(levelTrail('Home', stack, id => names[id])).toEqual([
      { kind: 'page', label: 'Home', index: -1 },
      { kind: 'component', label: 'Card', index: 0 },
      { kind: 'component', label: 'Button', index: 1 }
    ])
    expect(levelTrail('Home', [{ ...site, back: [] }], id => names[id]).map(c => c.label)).toEqual(['Home', 'Site layout'])
    expect(levelTrail('Home', [{ kind: 'component', id: 'gone', back: [] }], id => names[id])[1]!.label).toBe('Missing')
  })
})
