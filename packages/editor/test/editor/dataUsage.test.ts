import { afterEach, describe, expect, it, vi } from 'vitest'
import { click, settle, typeInto } from '../helpers.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { FOLDED_KEY } from '../../src/editor/dataTree.ts'
import { byLabel, indexPage, menuItem, setupHarness, world } from '../design/harness.ts'
import { activeTab, inputs, open, q, qa, tab, tabNames, text } from './dataKit.ts'

/**
 * "Used in" for collections and fields (S5, DW-4), on the Data screen over the mocked actions: a collection's Used in tab, the count
 * on each field and its list, and the warning before a delete or a rename of what is used. The module's own rules are `codegen`'s
 * (`field-usage.test.ts`, `entities`), the sentences are `shared/dataUsage.test.ts`'s.
 */

setupHarness()

afterEach(() => {
  takeStart()
  localStorage.removeItem(FOLDED_KEY)
})

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const collection = (plural: string) => q(`[data-collection="${plural}"]`)
const textButton = (label: string) => qa('button').find(candidate => candidate.textContent?.trim() === label) ?? null
const entries = (scope: string) => qa(`${scope} [data-use]`).map(entry => entry.getAttribute('data-use'))
/** No page reads the quotes any more: nothing but its own query uses the Quote collection. */
const freeQuotes = () => {
  indexPage().uses!.queries = indexPage().uses!.queries!.filter(use => use.query !== 'q_latest_quotes')
  indexPage().root.children = indexPage().root.children!.filter(node => node.id !== 'n_quotes')
}

describe('the Used in tab of a collection', () => {
  it('is the fourth tab: Rows, Fields, Endpoints, Used in and JSON', async () => {
    await open()
    expect(tabNames()).toEqual(['rows', 'fields', 'endpoints', 'used', 'json'])
    await click(tab('used'))
    expect(activeTab()).toBe('used')
  })

  it('lists the pages and components that use the collection, once each, with how', async () => {
    await open({}, {}, '/data?item=collection:ent_post&tab=used')
    expect(text(q('[data-used-in] p'))).toBe('Used in 4 places')
    expect(entries('[data-used-in-outside]')).toEqual(expect.arrayContaining(['page:pg_index', 'page:pg_post_detail', 'page:pg_new_post', 'component:cmp_post_card']))
    expect(entries('[data-used-in-outside]')).toHaveLength(4)
    const index = text(q('[data-use="page:pg_index"]'))
    expect(index).toContain('Reads “Featured posts” as “featured”')
    expect(index).toContain('n_list lists its rows as “post”')
    expect(text(q('[data-use="page:pg_post_detail"]'))).toContain('Detail page: reads “Post by slug” as “post”')
  })

  it('lists what goes with the collection apart, and does not count it', async () => {
    await open({}, {}, '/data?item=collection:ent_post&tab=used')
    expect(entries('[data-used-in-follows]')).toEqual(expect.arrayContaining(['action:act_create_post']))
    expect(text(q('[data-used-in-follows]'))).toContain('Goes with it')
    expect(entries('[data-used-in-outside]').some(entry => entry?.startsWith('action:'))).toBe(false)
  })

  it('opens the page on the Canvas from its entry, and a component too', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await open({}, {}, '/data?item=collection:ent_post&tab=used')
      await click(q('[data-use-open="page:pg_index"]'))
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.pageId).toBe('pg_index')
    } finally {
      off()
    }
  })

  it('opens a component on the Canvas from its entry', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await open({}, {}, '/data?item=collection:ent_post&tab=used')
      await click(q('[data-use-open="component:cmp_post_card"]'))
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.fileId).toBe('cmp_post_card')
    } finally {
      off()
    }
  })

  it('says nothing uses a collection that is not used', async () => {
    freeQuotes()
    await open({}, {}, '/data?item=collection:ent_quote&tab=used')
    expect(entries('[data-used-in]').filter(entry => !entry?.startsWith('action:'))).toEqual([])
    expect(text(q('[data-used-in-empty]'))).toBe('Not used yet. No page or component reads this collection.')
  })
})

describe('the count on each field', () => {
  const fieldsTab = async (extra = {}) => {
    const mounted = await open(extra, {}, '/data?item=collection:ent_post&tab=fields')
    return mounted
  }
  const row = (name: string) => q(`[data-fields-tab] [data-field="${name}"]`)!

  it('shows how many places use a field, with the words in a tooltip title', async () => {
    await fieldsTab()
    const badge = row('title').querySelector<HTMLElement>('[data-field-uses]')!
    expect(text(badge)).toBe('3')
    expect(badge.getAttribute('aria-label')).toBe('Used in 3 places: show them')
    // A query, an action's steps, a page's binding, a form field and a component: 6 places.
    expect(text(row('published').querySelector('[data-field-uses]'))).toBe('6')
  })

  it('shows none on a field nothing uses', async () => {
    world.model.modules.blog!.entities[0]!.fields.push({ id: 'fld_extra', name: 'extra', type: 'text' })
    await fieldsTab()
    expect(row('extra').querySelector('[data-field-uses]')).toBeNull()
  })

  it('opens the list of a field under its row, each place a link that opens it on the Canvas', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await fieldsTab()
      expect(q('[data-field-uses-list]')).toBeNull()
      await click(row('title').querySelector('[data-field-uses]'))
      expect(entries('[data-field-uses-list="title"]')).toEqual(expect.arrayContaining(['page:pg_post_detail', 'page:pg_new_post', 'component:cmp_post_card']))
      expect(text(q('[data-field-uses-list="title"] [data-use="page:pg_post_detail"]'))).toContain('n_title shows “post.title”')
      await click(q('[data-field-uses-list="title"] [data-use-open="page:pg_post_detail"]'))
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.pageId).toBe('pg_post_detail')
    } finally {
      off()
    }
  })

  it('shows a query that filters by a field, and opens it in the Data workspace', async () => {
    await fieldsTab()
    await click(row('published').querySelector('[data-field-uses]'))
    expect(entries('[data-field-uses-list="published"]')).toContain('query:q_featured_posts')
    expect(text(q('[data-field-uses-list="published"] [data-use="query:q_featured_posts"]'))).toContain('Filters by it')
    await click(q('[data-field-uses-list="published"] [data-use-open="query:q_featured_posts"]'))
    expect(text(q('[data-data-title] h2'))).toBe('Featured posts')
  })

  it('counts a connection collection\'s fields too, read-only', async () => {
    await open({}, {}, '/data?item=collection:ent_quote&tab=fields')
    expect(text(q('[data-fields-tab] [data-field="text"] [data-field-uses]'))).toBe('1')
  })
})

describe('removing a field', () => {
  const fieldsTab = (extra = {}) => open(extra, {}, '/data?item=collection:ent_post&tab=fields')
  const row = (name: string) => q(`[data-fields-tab] [data-field="${name}"]`)!

  it('warns "Used in N places" before a used field is removed, lists the places, and disables Remove', async () => {
    const { actions } = await fieldsTab({ entity_field_remove: ok() })
    await click(row('title').querySelector('[data-row-remove]'))
    expect(text(q('[data-confirm-description]'))).toContain('Used in 3 places')
    expect(text(q('[data-confirm-description]'))).toContain('change them first')
    expect(entries('[data-confirm-uses]')).toEqual(expect.arrayContaining(['page:pg_post_detail', 'page:pg_new_post', 'component:cmp_post_card']))
    const submit = q('[data-confirm-ok]')!
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(submit.getAttribute('title')).toBe('Used in 3 places: change them first')
    await click(submit)
    expect(inputs(actions, 'entity_field_remove')).toEqual([])
  })

  it('opens a place on the Canvas from the warning, and closes it', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await fieldsTab({ entity_field_remove: ok() })
      await click(row('title').querySelector('[data-row-remove]'))
      await click(q('[data-confirm-uses] [data-use-open="page:pg_new_post"]'))
      expect(q('[data-confirm]')).toBeNull()
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.pageId).toBe('pg_new_post')
    } finally {
      off()
    }
  })

  it('removes a field nothing uses after the usual confirmation, with no used-in warning', async () => {
    world.model.modules.blog!.entities[0]!.fields.push({ id: 'fld_extra', name: 'extra', type: 'text' })
    const { actions } = await fieldsTab({ entity_field_remove: ok() })
    await click(row('extra').querySelector('[data-row-remove]'))
    expect(text(q('[data-confirm-description]'))).not.toContain('Used in')
    await click(textButton('Remove field'))
    expect(inputs(actions, 'entity_field_remove')).toEqual([{ entity: 'ent_post', field: 'fld_extra' }])
  })

  it('asks nothing more for a field that only an action picks: the module changes the action with it', async () => {
    world.model.modules.blog!.entities[0]!.fields.push({ id: 'fld_extra', name: 'extra', type: 'text' })
    world.model.modules.blog!.actions.find(action => action.id === 'act_create_post')!.input.pick!.push('extra')
    const { actions } = await fieldsTab({ entity_field_remove: ok() })
    expect(row('extra').querySelector('[data-field-uses]')).toBeNull()
    await click(row('extra').querySelector('[data-row-remove]'))
    expect(q('[data-confirm-uses]')).toBeNull()
    await click(textButton('Remove field'))
    expect(inputs(actions, 'entity_field_remove')).toHaveLength(1)
  })
})

describe('renaming a field', () => {
  const fieldsTab = (extra = {}) => open(extra, {}, '/data?item=collection:ent_post&tab=fields')
  const nameOf = (field: string) => q(`[data-fields-tab] [data-field="${field}"] [data-field-label-input]`) as HTMLInputElement

  it('says a used field cannot be renamed and that nothing is rewritten, lists where, and puts the name back', async () => {
    const { actions } = await fieldsTab({ entity_field_update: ok() })
    await typeInto(nameOf('slug'), 'permalink')
    expect(text(q('[data-confirm-description]'))).toContain('Used in')
    expect(text(q('[data-confirm-description]'))).toContain('are not rewritten')
    expect(entries('[data-confirm-uses]')).toEqual(expect.arrayContaining(['page:pg_post_detail', 'page:pg_index']))
    expect(q('[data-confirm-ok]')!.hasAttribute('disabled')).toBe(true)
    await click(q('[data-confirm-cancel]'))
    expect(inputs(actions, 'entity_field_update')).toEqual([])
    expect(nameOf('slug').value).toBe('slug')
  })

  it('renames a field that only an action picks without asking: the action follows the new name', async () => {
    world.model.modules.blog!.entities[0]!.fields.push({ id: 'fld_extra', name: 'extra', type: 'text' })
    world.model.modules.blog!.actions.find(action => action.id === 'act_create_post')!.input.pick!.push('extra')
    const { actions } = await fieldsTab({ entity_field_update: ok() })
    await typeInto(nameOf('extra'), 'more')
    expect(q('[data-confirm]')).toBeNull()
    expect(inputs(actions, 'entity_field_update')).toEqual([{ entity: 'ent_post', field: 'fld_extra', name: 'more' }])
  })

  it('renames a field nothing uses without asking', async () => {
    world.model.modules.blog!.entities[0]!.fields.push({ id: 'fld_extra', name: 'extra', type: 'text' })
    const { actions } = await fieldsTab({ entity_field_update: ok() })
    await typeInto(nameOf('extra'), 'more')
    expect(q('[data-confirm]')).toBeNull()
    expect(inputs(actions, 'entity_field_update')).toEqual([{ entity: 'ent_post', field: 'fld_extra', name: 'more' }])
  })
})

describe('deleting a collection', () => {
  it('warns "Used in N places" before a used collection is deleted, lists the places, and disables Delete', async () => {
    const { actions } = await open({ entity_delete: ok({ deleted: [] }) })
    await menuItem(byLabel('Collection actions'), 'Delete')
    expect(text(q('[data-confirm-description]'))).toContain('Used in 4 places')
    expect(text(q('[data-confirm-description]'))).toContain('change them first')
    expect(entries('[data-confirm-uses]')).toEqual(expect.arrayContaining(['page:pg_index', 'page:pg_post_detail', 'page:pg_new_post', 'component:cmp_post_card']))
    expect(text(q('[data-confirm-uses]'))).toContain('Goes with it')
    const submit = q('[data-confirm-ok]')!
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(submit.getAttribute('title')).toBe('Used in 4 places: change them first')
    await click(submit)
    expect(inputs(actions, 'entity_delete')).toEqual([])
  })

  it('deletes a collection nothing outside uses after the usual confirmation', async () => {
    freeQuotes()
    const { actions } = await open({ entity_delete: ok({ deleted: ['ent_quote'] }) })
    await menuItem(collection('quotes')!.parentElement!.querySelector('[aria-label="Collection actions"]'), 'Delete')
    expect(text(q('[data-confirm-description]'))).toContain('The collection goes with its repository')
    expect(text(q('[data-confirm-description]'))).not.toContain('Used in')
    expect(q('[data-confirm-ok]')!.hasAttribute('disabled')).toBe(false)
    await click(textButton('Delete collection'))
    expect(inputs(actions, 'entity_delete')).toEqual([{ entity: 'ent_quote' }])
  })
})

describe('renaming a collection', () => {
  const rename = async (to: string) => {
    collection('posts')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    const input = byLabel('Rename collection')!
    await typeInto(input, to)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
  }

  it('says what a rename of a used collection does before it runs: places refer to it by id, hand-written code needs the rename', async () => {
    const { actions } = await open({ entity_update: ok() })
    await rename('Article')
    expect(text(q('[data-confirm-description]'))).toContain('Used in 4 places')
    expect(text(q('[data-confirm-description]'))).toContain('refer to it by id')
    expect(text(q('[data-confirm-description]'))).toContain('Hand-written code')
    expect(entries('[data-confirm-uses]')).toContain('page:pg_index')
    expect(inputs(actions, 'entity_update')).toEqual([])
    expect(q('[data-confirm-ok]')!.hasAttribute('disabled')).toBe(false)
    await click(q('[data-confirm-ok]'))
    expect(inputs(actions, 'entity_update')).toEqual([{ entity: 'ent_post', name: 'Article' }])
  })

  it('does nothing when the warning is cancelled', async () => {
    const { actions } = await open({ entity_update: ok() })
    await rename('Article')
    await click(q('[data-confirm-cancel]'))
    expect(inputs(actions, 'entity_update')).toEqual([])
  })

  it('warns for the name and the plural typed in the panel, and puts the text back when cancelled', async () => {
    const { actions } = await open({ entity_update: ok() }, {}, '/data?item=collection:ent_post&tab=fields')
    const panel = q('[data-collection-panel]')!
    await typeInto(panel.querySelector('[aria-label="Collection plural"]'), 'articles')
    expect(text(q('[data-confirm-description]'))).toContain('Used in 4 places')
    expect(text(q('[data-confirm-description]'))).toContain('list route')
    await click(q('[data-confirm-cancel]'))
    expect(inputs(actions, 'entity_update')).toEqual([])
    expect((panel.querySelector('[aria-label="Collection plural"]') as HTMLInputElement).value).toBe('posts')
    await typeInto(panel.querySelector('[aria-label="Collection name"]'), 'Article')
    await click(q('[data-confirm-ok]'))
    expect(inputs(actions, 'entity_update')).toEqual([{ entity: 'ent_post', name: 'Article' }])
  })

  it('renames a collection nothing outside uses without asking', async () => {
    freeQuotes()
    const { actions } = await open({ entity_update: ok() }, {}, '/data?item=collection:ent_quote&tab=fields')
    await typeInto(q('[data-collection-panel] [aria-label="Collection name"]'), 'Saying')
    expect(q('[data-confirm]')).toBeNull()
    expect(inputs(actions, 'entity_update')).toEqual([{ entity: 'ent_quote', name: 'Saying' }])
  })
})
