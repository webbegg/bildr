import { afterEach, describe, expect, it } from 'vitest'
import { click, Failure, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import DataView from '../../src/views/DataView.vue'
import { takeStart } from '../../src/editor/views.ts'
import { baseHandlers, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'

/**
 * The dialogs of the Data view (U7): a new collection in a connection, its mapping, and Import from
 * API. A collection is an entity over a REST data source: Test is `datasource_preview` (or
 * `repository_endpoint_test` for a saved one), Save one `entity_create` (or the `entity_field_*`
 * steps of an edited mapping). The mocked actions check every call against the real schemas.
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const byLabel = (label: string) => q(`[aria-label="${label}"]`)

const todos = [{ id: 1, todo: 'Buy milk', completed: false, user_id: 7 }, { id: 2, todo: 'Walk', completed: true, user_id: 7 }]
const preview = (over: Record<string, unknown> = {}) => ({
  status: 200,
  itemsPath: 'todos',
  count: 30,
  fields: [{ name: 'id', type: 'integer', remote: 'id' }, { name: 'todo', type: 'text', remote: 'todo' }, { name: 'completed', type: 'boolean', remote: 'completed' }, { name: 'userId', type: 'integer', remote: 'user_id' }],
  items: todos,
  sample: { todos },
  ...over
})

const open = async (extra: Handlers = {}) => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...extra })
  await mountWithApp(DataView, '/data')
  return actions
}
const inputs = (actions: Awaited<ReturnType<typeof open>>, name: string) => actions.named(name).map(call => call.input)
const button = (label: string) => qa('button').find(entry => entry.textContent?.trim() === label) ?? null

afterEach(() => {
  takeStart()
})

describe('a new collection in a connection', () => {
  const dialog = async (extra: Handlers = {}) => {
    const actions = await open(extra)
    await click(q('[data-connection-add-collection]'))
    return actions
  }
  const test = async (path: string) => {
    await typeInto(q('[data-endpoint-path="list"]'), path)
    await click(q('[data-endpoint-test="list"]'))
  }

  it('tests the list endpoint with datasource_preview and proposes the entity, its fields and a preview', async () => {
    const actions = await dialog({ datasource_preview: () => preview() })
    expect(text(q('[role="dialog"]'))).toContain('New collection')
    expect(text(q('[role="dialog"]'))).toContain('Relative to https://dummyjson.com')
    await test('/todos')
    expect(inputs(actions, 'datasource_preview')).toEqual([{ datasource: 'ds_quotes', path: '/todos' }])
    expect(text(q('[data-endpoint-status] span'))).toBe('200')
    expect(text(q('[data-endpoint-status]'))).toContain('30 items in the response')
    expect((q('[data-api-name]') as HTMLInputElement).value).toBe('Todo')
    expect((q('[data-api-items-path]') as HTMLInputElement).value).toBe('todos')
    expect(qa('[data-mapping-row]').map(row => row.getAttribute('data-mapping-row'))).toEqual(['id', 'todo', 'completed', 'user_id'])
    expect(qa('[data-preview-column]').map(column => text(column))).toEqual(['Id', 'Todo', 'Completed', 'User id'])
    expect([...q('[data-api-preview] tbody tr')!.querySelectorAll('td')].map(cell => text(cell))).toEqual(['1', 'Buy milk', 'false', '7'])
  })

  it('saves it as one entity_create over the connection, with the plural the path gave', async () => {
    const actions = await dialog({ datasource_preview: () => preview(), entity_create: ok({ entityId: 'ent_todo' }) })
    await test('/todos')
    await click(q('[data-api-save]'))
    expect(inputs(actions, 'entity_create')).toEqual([{
      name: 'Todo',
      plural: 'todos',
      source: 'ds_quotes',
      fields: [{ name: 'id', type: 'integer', remote: 'id' }, { name: 'todo', type: 'text', remote: 'todo' }, { name: 'completed', type: 'boolean', remote: 'completed' }, { name: 'userId', type: 'integer', remote: 'user_id' }],
      endpoints: { list: { path: '/todos', itemsPath: 'todos' } }
    }])
    expect(q('[role="dialog"]')).toBeNull()
  })

  it('leaves out the fields switched off, renames and retypes, and takes the other endpoints the API has', async () => {
    const actions = await dialog({ datasource_preview: () => preview(), entity_create: ok({ entityId: 'ent_todo' }) })
    await test('/todos')
    await click(q('[data-mapping-row="user_id"] [data-include]'))
    await typeInto(q('[data-mapping-row="todo"] [data-key]'), 'title')
    await typeInto(q('[data-api-name]'), 'Task')
    await typeInto(q('[data-api-total-path]'), 'total')
    await click(q('[data-other-endpoint="get"] [data-other-on]'))
    await click(q('[data-other-endpoint="create"] [data-other-on]'))
    expect((q('[data-other-endpoint="get"] [data-other-path]') as HTMLInputElement).placeholder).toBe('/todos/:id')
    await click(q('[data-api-save]'))
    expect(inputs(actions, 'entity_create')).toEqual([{
      name: 'Task',
      source: 'ds_quotes',
      fields: [{ name: 'id', type: 'integer', remote: 'id' }, { name: 'title', type: 'text', remote: 'todo' }, { name: 'completed', type: 'boolean', remote: 'completed' }],
      endpoints: { list: { path: '/todos', itemsPath: 'todos', totalPath: 'total' }, get: { path: '/todos/:id', method: 'GET' }, create: { path: '/todos', method: 'POST' } }
    }])
  })

  it('names a mapping that cannot be saved and keeps Save off', async () => {
    await dialog({ datasource_preview: () => preview() })
    await test('/todos')
    await typeInto(q('[data-mapping-row="completed"] [data-key]'), 'todo')
    expect(text(q('[data-api-mapping]'))).toContain('"todo" is used twice')
    expect(q('[data-api-save]')?.hasAttribute('disabled')).toBe(true)
  })

  it('refuses a path with a query or a full URL before it is tested', async () => {
    const actions = await dialog({ datasource_preview: () => preview() })
    await typeInto(q('[data-endpoint-path="list"]'), '/todos?limit=5')
    expect(text(q('[role="dialog"]'))).toContain('Use a path like /posts/:id')
    expect(q('[data-endpoint-test="list"]')?.hasAttribute('disabled')).toBe(true)
    expect(actions.named('datasource_preview')).toEqual([])
  })

  it('cannot map a response that is a bare array, which the generated adapter does not read', async () => {
    const actions = await dialog({ datasource_preview: () => preview({ itemsPath: '', items: todos }) })
    await test('/todos')
    expect(text(q('[role="dialog"]'))).toContain('a response that is a bare array cannot be mapped yet')
    expect(q('[data-api-save]')?.hasAttribute('disabled')).toBe(true)
    expect(actions.named('entity_create')).toEqual([])
  })

  it('reads the items at another top-level key when asked again', async () => {
    const actions = await dialog({ datasource_preview: () => preview() })
    await test('/todos')
    await typeInto(q('[data-api-items-path]'), 'items')
    await click(q('[data-endpoint-test="list"]'))
    expect(inputs(actions, 'datasource_preview')).toEqual([{ datasource: 'ds_quotes', path: '/todos' }, { datasource: 'ds_quotes', path: '/todos', itemsPath: 'items' }])
  })

  it('says what the preview said when it fails, or when the response has no list', async () => {
    let answer: unknown = new Failure(502, 'upstream', 'Request failed with status 502')
    await dialog({ datasource_preview: () => answer })
    await test('/todos')
    expect(text(q('[data-api-error]'))).toBe('Request failed with status 502')
    answer = { status: 200, item: { id: 1 }, fields: [], sample: { id: 1 } }
    await click(q('[data-endpoint-test="list"]'))
    expect(text(q('[data-api-error]'))).toBe('The response has no list of items; set the items path to point at one.')
  })

  it('keeps the dialog open and says why when entity_create refuses', async () => {
    await dialog({ datasource_preview: () => preview(), entity_create: () => new Failure(422, 'invalid', 'Module "blog" already has the entity Todo (ent_todo)') })
    await test('/todos')
    await click(q('[data-api-save]'))
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(text(q('[data-api-error]'))).toContain('already has the entity Todo')
  })
})

describe('the mapping of a saved collection', () => {
  const dialog = async (extra: Handlers = {}) => {
    const actions = await open({
      repository_endpoint_test: () => preview({ itemsPath: 'quotes', fields: [], items: [{ id: 1, quote: 'Hello', author: 'Ann' }, { id: 2, quote: 'Bye', author: 'Bob' }] }),
      ...extra
    })
    await click(q('[data-collection="quotes"]'))
    await click(q('[data-data-tab="fields"]'))
    await click(q('[data-fields-tab] [data-edit-mapping]'))
    return actions
  }

  it('shows the saved fields with their keys, tests the list endpoint as saved, and previews its items', async () => {
    const actions = await dialog()
    expect(inputs(actions, 'repository_endpoint_test')).toEqual([{ repository: 'repo_quote', op: 'list' }])
    expect(qa('[data-mapping-row]').map(row => row.getAttribute('data-mapping-row'))).toEqual(['id', 'quote', 'author'])
    expect((q('[data-endpoint-path="list"]') as HTMLInputElement).readOnly).toBe(true)
    expect((q('[data-endpoint-path="list"]') as HTMLInputElement).value).toBe('/quotes')
    expect((q('[data-api-items-path]') as HTMLInputElement).value).toBe('quotes')
    expect((q('[data-api-total-path]') as HTMLInputElement).value).toBe('total')
    expect([...q('[data-api-preview] tbody tr')!.querySelectorAll('td')].map(cell => text(cell))).toEqual(['1', 'Hello', 'Ann'])
    // The key is the entity's: it cannot be left out or renamed.
    expect(q('[data-mapping-row="id"] [data-include]')?.hasAttribute('disabled')).toBe(true)
  })

  it('warns of a key no item has, and saves a changed key as one entity_field_update', async () => {
    const actions = await dialog({ entity_field_update: ok() })
    await typeInto(q('[data-mapping-row="quote"] [data-path]'), 'body')
    expect(text(q('[data-mapping-note]'))).toBe('No item of the response has this key')
    await typeInto(q('[data-mapping-row="body"] [data-path]'), 'quote')
    expect(q('[data-mapping-note]')).toBeNull()
    await typeInto(q('[data-mapping-row="quote"] [data-path]'), 'quote_text')
    await click(button('Save mapping'))
    expect(inputs(actions, 'entity_field_update')).toEqual([{ entity: 'ent_quote', field: 'fld_q_text', remote: 'quote_text' }])
    expect(q('[role="dialog"]')).toBeNull()
  })

  it('removes a field left out and adds one by hand, in that order, each one an action', async () => {
    const actions = await dialog({ entity_field_remove: ok(), entity_field_add: ok({ fieldId: 'fld_likes' }) })
    await click(q('[data-mapping-row="author"] [data-include]'))
    await typeInto(byLabel('New field name'), 'likes')
    await typeInto(byLabel('New field key'), 'like_count')
    q('[data-api-add-field]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    await click(button('Save mapping'))
    expect(actions.calls.filter(call => call.name.startsWith('entity_field_')).map(call => [call.name, call.input])).toEqual([
      ['entity_field_remove', { entity: 'ent_quote', field: 'fld_q_author' }],
      ['entity_field_add', { entity: 'ent_quote', name: 'likes', type: 'text', remote: 'like_count' }]
    ])
  })

  it('stops at the first step the model refuses, keeps the dialog and says why', async () => {
    const actions = await dialog({
      entity_field_remove: () => new Failure(422, 'invalid', 'author is used by q_quotes_by_author: change them first'),
      entity_field_update: ok()
    })
    await click(q('[data-mapping-row="author"] [data-include]'))
    await typeInto(q('[data-mapping-row="quote"] [data-path]'), 'quote_text')
    await click(button('Save mapping'))
    expect(actions.calls.filter(call => call.name.startsWith('entity_field_')).map(call => call.name)).toEqual(['entity_field_remove'])
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(text(q('[data-api-error]'))).toContain('author is used by q_quotes_by_author')
  })
})

describe('a mapping save refused partway', () => {
  const entity = () => Object.values(world.model.modules).flatMap(entry => entry.entities).find(candidate => candidate.id === 'ent_quote')!

  it('refreshes from the model, so a retry sends only the steps that remain (never a field twice)', async () => {
    let refuse = true
    const actions = await open({
      repository_endpoint_test: () => preview({ itemsPath: 'quotes', fields: [], items: [{ id: 1, quote: 'Hello', author: 'Ann' }] }),
      entity_field_remove: (input) => {
        entity().fields = entity().fields.filter(field => field.id !== input.field)
        return { changed: [] }
      },
      entity_field_add: (input) => {
        entity().fields.push({ id: 'fld_q_likes', name: String(input.name), type: input.type as 'text', remote: String(input.remote) } as never)
        return { changed: [], fieldId: 'fld_q_likes' }
      },
      entity_field_update: () => {
        if (refuse) return new Failure(422, 'invalid', 'quote is used by q_search: change them first')
        return { changed: [] }
      }
    })
    await click(q('[data-collection="quotes"]'))
    await click(q('[data-data-tab="fields"]'))
    await click(q('[data-fields-tab] [data-edit-mapping]'))
    await click(q('[data-mapping-row="author"] [data-include]'))
    await typeInto(byLabel('New field name'), 'likes')
    await typeInto(byLabel('New field key'), 'like_count')
    q('[data-api-add-field]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    await typeInto(q('[data-mapping-row="quote"] [data-path]'), 'quote_text')

    await click(button('Save mapping'))
    expect(text(q('[data-api-error]'))).toContain('quote is used by q_search')
    // The remove went through, and the dialog shows the model's fields now (the removed one gone, the update still wanted).
    expect(qa('[data-mapping-row]').map(row => row.getAttribute('data-mapping-row'))).not.toContain('author')

    refuse = false
    await click(button('Save mapping'))
    expect(actions.calls.filter(call => call.name.startsWith('entity_field_')).map(call => [call.name, call.input])).toEqual([
      ['entity_field_remove', { entity: 'ent_quote', field: 'fld_q_author' }],
      ['entity_field_update', { entity: 'ent_quote', field: 'fld_q_text', remote: 'quote_text' }],
      ['entity_field_update', { entity: 'ent_quote', field: 'fld_q_text', remote: 'quote_text' }],
      ['entity_field_add', { entity: 'ent_quote', name: 'likes', type: 'text', remote: 'like_count' }]
    ])
    expect(q('[role="dialog"]')).toBeNull()
  })
})

describe('Import from API', () => {
  const openImport = async () => {
    const trigger = q('[data-synced-add]')!
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    await click(qa('[role^="menuitem"]').find(item => item.textContent?.includes('Import from URL')) ?? null)
  }
  const fetchUrl = async (url: string) => {
    await typeInto(q('[data-api-url]'), url)
    await click(q('[data-api-fetch]'))
  }

  it('fetches through the data source of the URL\'s origin, and saves the path under it without the query', async () => {
    const actions = await open({ datasource_preview: () => preview(), entity_create: ok({ entityId: 'ent_todo' }) })
    await openImport()
    expect(text(q('[role="dialog"]'))).toContain('Import from API')
    await fetchUrl('https://dummyjson.com/todos?limit=5')
    expect(actions.named('datasource_create')).toEqual([])
    expect(inputs(actions, 'datasource_preview')).toEqual([{ datasource: 'ds_quotes', path: '/todos?limit=5' }])
    expect((q('[data-api-name]') as HTMLInputElement).value).toBe('Todo')
    await click(q('[data-api-save]'))
    expect(inputs(actions, 'entity_create')).toMatchObject([{ name: 'Todo', plural: 'todos', source: 'ds_quotes', endpoints: { list: { path: '/todos', itemsPath: 'todos' } } }])
    expect(q('[role="dialog"]')).toBeNull()
  })

  it('makes a data source for an origin the project has none for, named after the host', async () => {
    const actions = await open({ datasource_create: ok({ datasourceId: 'ds_example_org' }), datasource_preview: () => preview(), entity_create: ok({ entityId: 'ent_todo' }) })
    await openImport()
    await fetchUrl('https://example.org/v1/todos')
    expect(inputs(actions, 'datasource_create')).toEqual([{ name: 'example-org', kind: 'rest', defaults: { baseUrl: 'https://example.org' } }])
    expect(inputs(actions, 'datasource_preview')).toEqual([{ datasource: 'ds_example_org', path: '/v1/todos' }])
    await click(q('[data-api-save]'))
    expect(inputs(actions, 'entity_create')).toMatchObject([{ source: 'ds_example_org', endpoints: { list: { path: '/v1/todos' } } }])
    expect(actions.named('datasource_delete')).toEqual([])
  })

  it('deletes the data source it made when the dialog is closed without saving', async () => {
    const actions = await open({ datasource_create: ok({ datasourceId: 'ds_example_org' }), datasource_preview: () => preview(), datasource_delete: ok({ database: true }) })
    await openImport()
    await fetchUrl('https://example.org/todos')
    await click(button('Cancel'))
    expect(inputs(actions, 'datasource_delete')).toEqual([{ datasource: 'ds_example_org' }])
  })

  it('deletes the data source it made when the screen goes away with the dialog open (a route change)', async () => {
    const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), datasource_create: ok({ datasourceId: 'ds_example_org' }), datasource_preview: () => preview(), datasource_delete: ok({ database: true }) })
    const { wrapper } = await mountWithApp(DataView, '/data')
    await openImport()
    await fetchUrl('https://example.org/todos')
    wrapper.unmount()
    await settle()
    expect(inputs(actions, 'datasource_delete')).toEqual([{ datasource: 'ds_example_org' }])
  })

  it('does not delete a data source the project already had', async () => {
    const actions = await open({ datasource_preview: () => preview(), datasource_delete: ok({ database: true }) })
    await openImport()
    await fetchUrl('https://dummyjson.com/todos')
    await click(button('Cancel'))
    expect(actions.named('datasource_delete')).toEqual([])
  })

  it('refuses what is not an http(s) URL, and a path with characters a saved endpoint cannot have', async () => {
    const actions = await open({ datasource_preview: () => preview() })
    await openImport()
    await typeInto(q('[data-api-url]'), 'api.example.org/todos')
    expect(text(q('[role="dialog"]'))).toContain('Use a full http or https URL')
    expect(q('[data-api-fetch]')?.hasAttribute('disabled')).toBe(true)
    await typeInto(q('[data-api-url]'), 'https://example.org/to dos')
    await typeInto(q('[data-api-url]'), 'https://example.org/todos%20list')
    expect(actions.named('datasource_preview')).toEqual([])
  })

  it('opens from the empty Data view too', async () => {
    world.model.modules.blog!.entities = []
    world.model.modules.blog!.repositories = []
    await open()
    await click(q('[data-empty-import]'))
    expect(text(q('[role="dialog"]'))).toContain('Import from API')
  })
})
