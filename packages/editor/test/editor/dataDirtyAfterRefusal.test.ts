import { afterEach, describe, expect, it } from 'vitest'
import { Failure, click, settle, typeInto } from '../helpers.ts'
import { takeStart } from '../../src/editor/views.ts'
import { menuItem, setupHarness } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'
import { activeTab, confirmText, inputs, open, q, qa, tab, text } from './dataKit.ts'

/**
 * B7: a confirmed discard, then a refused create, in every dialog that asks before it writes (`guardLeave`). The discard clears what the
 * workspace remembers is unsaved; the create the user agreed to it for did not happen, so the Post collection's JSON that is still on
 * the screen is still unsaved, and the next move away from it asks again. (B2 did it for New state; the dialogs below are the others.)
 */

setupHarness()

afterEach(() => {
  takeStart()
})

const UNSAVED = '/data?item=collection:ent_post&tab=json'
const todos = [{ id: 1, todo: 'Buy milk', completed: false, user_id: 7 }]
const preview = () => ({
  status: 200,
  itemsPath: 'todos',
  count: 30,
  fields: [{ name: 'id', type: 'integer', remote: 'id' }, { name: 'todo', type: 'text', remote: 'todo' }],
  items: todos,
  sample: { todos }
})
const refused = (message: string) => () => new Failure(422, 'invalid', message)
const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const button = (label: string) => qa('button').find(entry => entry.textContent?.trim() === label) ?? null

/** The Post collection's JSON, edited and not saved: the workspace asks before it moves away from it. */
const mountedUnsaved = async (extra: Handlers) => {
  const mounted = await open(extra, {}, UNSAVED)
  await typeInto(q('[data-testid="raw-content"]'), '{ "draft": true }')
  return mounted
}

/** Agrees to discard what is unsaved, for the create the dialog asked it for. */
const discard = async () => {
  expect(confirmText()).toContain('Discard unsaved changes to Post (JSON)?')
  await click(q('[data-confirm-ok]'))
}

/** Moving to another tab of the collection asks again, and keeping the edits keeps the screen where it was. */
const expectStillAsked = async () => {
  await click(tab('fields'))
  expect(confirmText()).toContain('Discard unsaved changes to Post (JSON)?')
  await click(q('[data-confirm-cancel]'))
  expect(activeTab()).toBe('json')
}

describe('a confirmed discard, then a refused create', () => {
  it('New connection: the JSON still unsaved is asked about again', async () => {
    const { actions } = await mountedUnsaved({ datasource_create: refused('A connection called Billing already exists') })
    await menuItem(q('[data-synced-add]'), 'New connection')
    await typeInto(q('[aria-label="New connection name"]'), 'Billing')
    q('[data-new-connection]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    await discard()
    expect(inputs(actions, 'datasource_create')).toHaveLength(1)
    await expectStillAsked()
  })

  it('New collection: the JSON still unsaved is asked about again', async () => {
    const { actions } = await mountedUnsaved({
      datasource_create: ok({ datasourceId: 'ds_sample', filePath: '.bildr/datasources/sample.json', database: false }),
      datasource_delete: ok({ database: false }),
      entity_create: refused('Module "blog" already has the entity Menu (ent_menu)')
    })
    await click(q('[aria-label="Add collection"]'))
    await typeInto(q('[data-new-collection-name]'), 'Menu')
    await click(q('[data-artifact-submit]'))
    await discard()
    expect(inputs(actions, 'entity_create')).toHaveLength(1)
    expect(text(q('[data-artifact-error]'))).toContain('already has the entity Menu')
    await click(button('Cancel'))
    await expectStillAsked()
  })

  it('New collection in a connection: the JSON still unsaved is asked about again', async () => {
    const { actions } = await mountedUnsaved({ datasource_preview: preview, entity_create: refused('Module "blog" already has the entity Todo (ent_todo)') })
    await click(q('[data-connection-add-collection]'))
    await click(q('[data-artifact-submit]'))
    await typeInto(q('[data-endpoint-path="list"]'), '/todos')
    await click(q('[data-endpoint-test="list"]'))
    await click(q('[data-api-save]'))
    await discard()
    expect(inputs(actions, 'entity_create')).toHaveLength(1)
    expect(q('[data-connection-source]')).not.toBeNull()
    await click(button('Cancel'))
    await expectStillAsked()
  })

  it('Import from URL: the JSON still unsaved is asked about again', async () => {
    const { actions } = await mountedUnsaved({ datasource_preview: preview, entity_create: refused('Module "blog" already has the entity Todo (ent_todo)') })
    const trigger = q('[data-synced-add]')!
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    await click(qa('[role^="menuitem"]').find(item => item.textContent?.includes('Import from URL')) ?? null)
    await typeInto(q('[data-api-url]'), 'https://dummyjson.com/todos')
    await click(q('[data-api-fetch]'))
    await click(q('[data-api-save]'))
    await discard()
    expect(inputs(actions, 'entity_create')).toHaveLength(1)
    expect(q('[data-api-source]')).not.toBeNull()
    await click(button('Cancel'))
    await expectStillAsked()
  })
})
