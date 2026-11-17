import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { mountWithApp, settle } from '../helpers.ts'
import EditorChoiceCards from '../../src/components/kit/EditorChoiceCards.vue'
import { setupHarness } from '../design/harness.ts'

/** The kit's choice cards: one radiogroup of cards, a roving tabindex, the arrows that move and pick, and a mark that is not colour only. */

setupHarness()

const ITEMS = [
  { value: 'a', label: 'Alpha', description: 'The first.' },
  { value: 'b', label: 'Beta', description: 'The second.' },
  { value: 'c', label: 'Gamma', description: 'The third.' }
]

const mountCards = async (start = 'b', columns?: 1 | 2) => {
  const picked = ref(start)
  await mountWithApp(defineComponent({
    render: () => h(EditorChoiceCards, { 'modelValue': picked.value, 'onUpdate:modelValue': (value: string) => (picked.value = value), 'items': ITEMS, 'label': 'Pick one', 'hook': 'data-pick', columns })
  }))
  return picked
}

const cards = () => [...document.body.querySelectorAll<HTMLElement>('[data-pick]')]
const card = (value: string) => document.body.querySelector<HTMLElement>(`[data-pick="${value}"]`)!
const press = async (element: HTMLElement, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  await settle()
  return event
}

describe('EditorChoiceCards', () => {
  it('is a radiogroup of radios, one checked, each with its label and description', async () => {
    await mountCards()
    const group = document.body.querySelector('[role="radiogroup"]')!
    expect(group.getAttribute('aria-label')).toBe('Pick one')
    expect(cards().map(element => [element.getAttribute('role'), element.getAttribute('aria-checked')])).toEqual([['radio', 'false'], ['radio', 'true'], ['radio', 'false']])
    expect(cards().map(element => element.querySelector('[data-pick-description]')?.textContent)).toEqual(['The first.', 'The second.', 'The third.'])
    expect(cards().map(element => element.textContent)).toEqual(['AlphaThe first.', 'BetaThe second.', 'GammaThe third.'])
  })

  it('has one tab stop: the checked card, else the first', async () => {
    await mountCards('b')
    expect(cards().map(element => element.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('has the first card as its tab stop when none is checked', async () => {
    await mountCards('')
    expect(cards().map(element => element.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it('shows the checked card with a dot, not by colour only', async () => {
    await mountCards('b')
    expect(cards().map(element => element.querySelector('[data-choice-dot]') !== null)).toEqual([false, true, false])
    expect(cards().map(element => element.querySelector('[data-choice-radio]') !== null)).toEqual([true, true, true])
  })

  it('picks a card when it is clicked', async () => {
    const picked = await mountCards('a')
    card('c').click()
    await settle()
    expect(picked.value).toBe('c')
    expect(cards().map(element => element.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
  })

  it('moves focus to the next card with the arrows and picks it; every arrow of either axis moves', async () => {
    const picked = await mountCards('a')
    card('a').focus()
    const event = await press(card('a'), 'ArrowDown')
    expect(event.defaultPrevented).toBe(true)
    expect(picked.value).toBe('b')
    expect(document.activeElement).toBe(card('b'))
    await press(card('b'), 'ArrowRight')
    expect(picked.value).toBe('c')
    await press(card('c'), 'ArrowUp')
    expect(picked.value).toBe('b')
    await press(card('b'), 'ArrowLeft')
    expect(picked.value).toBe('a')
    expect(cards().map(element => element.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it('goes round at the ends, and Home and End go to the first and the last', async () => {
    const picked = await mountCards('c')
    card('c').focus()
    await press(card('c'), 'ArrowDown')
    expect(picked.value).toBe('a')
    await press(card('a'), 'ArrowUp')
    expect(picked.value).toBe('c')
    await press(card('c'), 'Home')
    expect(picked.value).toBe('a')
    await press(card('a'), 'End')
    expect(picked.value).toBe('c')
    expect(document.activeElement).toBe(card('c'))
  })

  it('leaves any other key alone', async () => {
    const picked = await mountCards('b')
    const event = await press(card('b'), 'x')
    expect(event.defaultPrevented).toBe(false)
    expect(picked.value).toBe('b')
  })

  it('lays the cards out in two columns when asked', async () => {
    await mountCards('b', 2)
    expect(document.body.querySelector('[role="radiogroup"]')!.className).toContain('grid-cols-2')
  })
})
