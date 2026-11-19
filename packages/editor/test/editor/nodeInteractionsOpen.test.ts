import { expect, it } from 'vitest'
import { click, settle } from '../helpers.ts'
import { indexPage, open, sectionAdd, select, setupHarness } from '../design/harness.ts'
import { interactionModule } from './dataKit.ts'

/**
 * Picking an event from the Interactions "+" opens the new interaction's steps under its row, and they stay open until the row is
 * closed: the steps are an editor in the panel, not a popover (the "+" menu hands focus back to its button as it closes, which
 * dismisses a popover that the pick opened).
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)

it('keeps the steps of a new interaction open after the event is picked, and a click on its row closes them and drops it: no step is made, so nothing is lost', async () => {
  const head = indexPage().root.children!.find(node => node.id === 'n_head')!
  head.children!.push({ id: 'n_open', type: 'Button', props: { text: 'Open' } })
  await open({ ...interactionModule() }, 'pg_index')
  await select('n_open')
  sectionAdd('data-node-interactions').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  const item = [...document.body.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(entry => entry.textContent?.trim() === 'Click')!
  item.click()
  await settle()
  expect(q('[data-node-interaction="0"]')).not.toBeNull()
  expect(q('[data-node-interaction="0"] [data-node-interaction-fields]')).not.toBeNull()
  expect(q('[data-node-interaction="0"] [aria-expanded="true"]')).not.toBeNull()
  await click(q('[data-node-interaction="0"] [data-node-interaction-toggle]'))
  expect(q('[data-node-interaction]')).toBeNull()
})
