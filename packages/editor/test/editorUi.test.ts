import { describe, expect, it } from 'vitest'
import { FIELD, FIELD_MONO, INPUT_UI, MENU_UI, MODAL_UI, MODAL_WIDTHS, SELECT_UI, findOption, mergeUi, toOptions } from '../src/editorUi.ts'

describe('toOptions', () => {
  it('turns strings into label/value options', () => {
    expect(toOptions(['GET', 'POST'])).toEqual([{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }])
  })

  it('keeps option objects with their icon and disabled flag', () => {
    const items = [{ label: 'Text', value: 'text', icon: 'i-lucide-type' }, { label: 'Image', value: 'image', disabled: true }]
    expect(toOptions(items)).toEqual(items)
  })

  it('accepts a mix of both', () => {
    expect(toOptions(['a', { label: 'B', value: 'b' }])).toEqual([{ label: 'a', value: 'a' }, { label: 'B', value: 'b' }])
  })
})

describe('findOption', () => {
  const options = toOptions([{ label: 'Text', value: 'text', icon: 'i-lucide-type' }, 'number'])

  it('finds the option of a value', () => {
    expect(findOption(options, 'text')?.icon).toBe('i-lucide-type')
    expect(findOption(options, 'number')?.label).toBe('number')
  })

  it('is undefined for an unknown or empty value', () => {
    expect(findOption(options, 'date')).toBeUndefined()
    expect(findOption(options, undefined)).toBeUndefined()
  })
})

describe('mergeUi', () => {
  it('appends the caller\'s classes per slot, after the kit\'s', () => {
    expect(mergeUi({ base: 'h-[30px] bg-elevated', content: 'p-1' }, { base: 'w-[54px]', trailing: 'hidden' })).toEqual({ base: 'h-[30px] bg-elevated w-[54px]', content: 'p-1', trailing: 'hidden' })
  })

  it('returns the kit ui when there is nothing to add', () => {
    const base = { base: 'a' }
    expect(mergeUi(base)).toBe(base)
  })
})

describe('the shared classes', () => {
  it('are the panel soft field', () => {
    expect(FIELD).toBe('h-[30px] rounded-lg bg-elevated text-[12px]')
    expect(FIELD_MONO).toBe('h-[30px] rounded-lg bg-elevated font-mono text-[12px]')
    expect(INPUT_UI.base).toContain(FIELD)
    expect(SELECT_UI.base).toContain(FIELD)
  })

  it('give two-line menu items a dimmed 11 px description of at most two lines', () => {
    for (const ui of [MENU_UI, SELECT_UI]) {
      expect(ui.itemDescription).toContain('text-[11px]')
      expect(ui.itemDescription).toContain('text-dimmed')
      expect(ui.itemDescription).toContain('line-clamp-2')
    }
  })

  it('give selects the menu popover', () => {
    expect(SELECT_UI.content).toContain(MENU_UI.content)
    expect(SELECT_UI.item).toContain('px-2.5 py-1.5 text-[12px]')
    expect(MENU_UI.item).toContain('px-2.5 py-1.5 text-[12px]')
  })

  it('scope the dark chrome on the modal itself', () => {
    expect(MODAL_UI.overlay).toContain('bildr-chrome')
    expect(MODAL_UI.content).toContain('bildr-chrome')
    expect(Object.keys(MODAL_WIDTHS)).toEqual(['sm', 'md', 'lg', 'xl'])
  })
})
