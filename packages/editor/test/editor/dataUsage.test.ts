import { afterEach, describe, expect, it, vi } from 'vitest'
import { click, settle, typeInto } from '../helpers.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { FOLDED_KEY } from '../../src/editor/dataTree.ts'
import { usageKey } from '../../src/shared/dataArtifacts.ts'
import { byLabel, menuItem, setupHarness, world } from '../design/harness.ts'
import type { UseKind } from '@bildr/codegen/edit'
import { activeTab, addUnusedField, confirmText, freeQuotes, inputs, open, q, qa, tab, tabNames, text } from './dataKit.ts'

/**
 * "Used in" for collections and fields, on the Data screen over the mocked actions: a collection's Used in tab, the count on each
 * field and its list, and the warning before a delete or a rename of what is used. The module's own rules are `codegen`'s
 * (`field-usage.test.ts`, `usage-refusals.test.ts`), the sentences are `shared/dataUsage.test.ts`'s.
 *
 * The blog fixture's counts, once: the Post collection is used in 4 places (the pages index, posts-slug and posts-new, and the PostCard
 * component). `title` is used in 3 (the detail page, the form page and the component); `published` in 6 (the featured query,
 * the create and the publish action, and those three again); `slug` in 7 (those, the index page, the by-slug query, its repository
 * and the create action). The create action's pick of a field is the module's own, so it is listed apart and not counted.
 */

setupHarness()

afterEach(() => {
  takeStart()
  localStorage.removeItem(FOLDED_KEY)
})

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const collection = (plural: string) => q(`[data-collection="${plural}"]`)
const textButton = (label: string) => qa('button').find(candidate => candidate.textContent?.trim() === label) ?? null
/** The places a list shows, as `kind:id`: `usageKey`'s own hook in the DOM. */
const entries = (scope: string) => qa(`${scope} [data-use]`).map(entry => entry.getAttribute('data-use'))
const key = (kind: UseKind, id: string) => usageKey({ kind, id })
/** The labels of the dialog's buttons (the icon-only ones, the places' links, have none). */
const dialogButtons = () => qa('[role="dialog"] button').map(text).filter(Boolean)

describe('the Used in tab of a collection', () => {
  it('is the fourth of five tabs: Rows, Fields, Endpoints, Used in and JSON', async () => {
    await open()
    expect(tabNames()).toEqual(['rows', 'fields', 'endpoints', 'used', 'json'])
    await click(tab('used'))
    expect(activeTab()).toBe('used')
  })

  it('lists the pages and components that use the collection, once each, with how', async () => {
    await open({}, {}, '/data?item=collection:ent_post&tab=used')
    expect(text(q('[data-used-in] p'))).toBe('Used in 4 places')
    expect(entries('[data-used-in-outside]')).toEqual(expect.arrayContaining([key('page', 'pg_index'), key('page', 'pg_post_detail'), key('page', 'pg_new_post'), key('component', 'cmp_post_card')]))
    expect(entries('[data-used-in-outside]')).toHaveLength(4)
    const index = text(q(`[data-use="${key('page', 'pg_index')}"]`))
    expect(index).toContain('Reads “Featured posts” as “featured”')
    expect(index).toContain('The list shows its rows as “post”')
    expect(text(q(`[data-use="${key('page', 'pg_post_detail')}"]`))).toContain('Detail page: reads “Post by slug” as “post”')
  })

  it('lists what changes along with the collection apart, as Updated automatically, and does not count it', async () => {
    await open({}, {}, '/data?item=collection:ent_post&tab=used')
    expect(entries('[data-used-in-follows]')).toEqual(expect.arrayContaining([key('action', 'act_create_post')]))
    expect(text(q('[data-used-in-follows]'))).toContain('Updated automatically')
    expect(text(q('[data-used-in-follows]'))).toContain('Not counted above')
    expect(entries('[data-used-in-outside]').some(entry => entry?.startsWith('action:'))).toBe(false)
  })

  it('opens a page on the Canvas from its entry', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await open({}, {}, '/data?item=collection:ent_post&tab=used')
      await click(q(`[data-use-open="${key('page', 'pg_index')}"]`))
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
      await click(q(`[data-use-open="${key('component', 'cmp_post_card')}"]`))
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.fileId).toBe('cmp_post_card')
    } finally {
      off()
    }
  })

  it('says a collection is not used when only its own actions and queries are', async () => {
    freeQuotes()
    await open({}, {}, '/data?item=collection:ent_quote&tab=used')
    expect(entries('[data-used-in]').filter(entry => !entry?.startsWith('action:'))).toEqual([])
    expect(text(q('[data-used-in-empty]'))).toBe('Not used yet. No page or component reads this collection.')
  })
})

describe('the count on each field', () => {
  const fieldsTab = (extra = {}) => open(extra, {}, '/data?item=collection:ent_post&tab=fields')
  const row = (name: string) => q(`[data-fields-tab] [data-field="${name}"]`)!

  it('shows how many places use a field, and says so in its label', async () => {
    await fieldsTab()
    const badge = row('title').querySelector<HTMLElement>('[data-field-uses]')!
    expect(text(badge)).toBe('3')
    expect(badge.getAttribute('aria-label')).toBe('Used in 3 places: show them')
    expect(text(row('published').querySelector('[data-field-uses]'))).toBe('6')
  })

  it('shows none on a field nothing uses', async () => {
    addUnusedField()
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
      expect(entries('[data-field-uses-list="title"]')).toEqual(expect.arrayContaining([key('page', 'pg_post_detail'), key('page', 'pg_new_post'), key('component', 'cmp_post_card')]))
      // The node is said by its type, not its id; the create action's pick is tagged as automatic.
      expect(text(q(`[data-field-uses-list="title"] [data-use="${key('page', 'pg_post_detail')}"]`))).toContain('A Heading shows “post.title”')
      expect(text(q(`[data-field-uses-list="title"] [data-use="${key('action', 'act_create_post')}"]`))).toContain('Updated automatically')
      await click(q(`[data-field-uses-list="title"] [data-use-open="${key('page', 'pg_post_detail')}"]`))
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.pageId).toBe('pg_post_detail')
    } finally {
      off()
    }
  })

  it('shows a query that filters by a field, and opens it in the Data workspace', async () => {
    await fieldsTab()
    await click(row('published').querySelector('[data-field-uses]'))
    expect(entries('[data-field-uses-list="published"]')).toContain(key('query', 'q_featured_posts'))
    expect(text(q(`[data-field-uses-list="published"] [data-use="${key('query', 'q_featured_posts')}"]`))).toContain('Filters by it')
    await click(q(`[data-field-uses-list="published"] [data-use-open="${key('query', 'q_featured_posts')}"]`))
    expect(text(q('[data-data-title] h2'))).toBe('Featured posts')
  })

  it('counts a connection collection\'s fields too, read-only, with the same list', async () => {
    await open({}, {}, '/data?item=collection:ent_quote&tab=fields')
    expect(text(q('[data-fields-tab] [data-field="text"] [data-field-uses]'))).toBe('1')
    await click(q('[data-fields-tab] [data-field="text"] [data-field-uses]'))
    expect(entries('[data-field-uses-list="text"]')).toEqual([key('page', 'pg_index')])
  })
})

describe('removing a field', () => {
  const fieldsTab = (extra = {}) => open(extra, {}, '/data?item=collection:ent_post&tab=fields')
  const row = (name: string) => q(`[data-fields-tab] [data-field="${name}"]`)!

  it('says a used field is used in N places before it is removed, lists them, and has only a Close button', async () => {
    const { actions } = await fieldsTab({ entity_field_remove: ok() })
    await click(row('title').querySelector('[data-row-remove]'))
    expect(confirmText()).toContain('“title” is used in 3 places')
    expect(text(q('[data-confirm-description]'))).toContain('A field can\'t be removed while it is used.')
    expect(text(q('[data-confirm-description]'))).toContain('change them, then try again')
    expect(entries('[data-confirm-uses]')).toEqual(expect.arrayContaining([key('page', 'pg_post_detail'), key('page', 'pg_new_post'), key('component', 'cmp_post_card')]))
    // The create action's pick follows the field: listed, tagged, and said not to count.
    expect(text(q(`[data-confirm-uses] [data-use="${key('action', 'act_create_post')}"]`))).toContain('Updated automatically')
    expect(text(q('[data-confirm-description]'))).toContain('are changed for you and not counted')
    expect(q('[data-confirm-ok]')).toBeNull()
    expect(dialogButtons()).toEqual(['Close'])
    await click(q('[data-confirm-cancel]'))
    expect(inputs(actions, 'entity_field_remove')).toEqual([])
  })

  it('opens a place on the Canvas from the warning, and closes it', async () => {
    const opened = vi.fn()
    const off = registerScreens(opened)
    try {
      await fieldsTab({ entity_field_remove: ok() })
      await click(row('title').querySelector('[data-row-remove]'))
      await click(q(`[data-confirm-uses] [data-use-open="${key('page', 'pg_new_post')}"]`))
      expect(q('[data-confirm]')).toBeNull()
      expect(opened).toHaveBeenCalledWith('design')
      expect(takeStart().data.pageId).toBe('pg_new_post')
    } finally {
      off()
    }
  })

  it('removes a field nothing uses after the usual confirmation, with no used-in warning', async () => {
    addUnusedField()
    const { actions } = await fieldsTab({ entity_field_remove: ok() })
    await click(row('extra').querySelector('[data-row-remove]'))
    expect(text(q('[data-confirm-description]'))).not.toContain('used')
    await click(textButton('Remove field'))
    expect(inputs(actions, 'entity_field_remove')).toEqual([{ entity: 'ent_post', field: 'fld_extra' }])
  })

  it('asks nothing more for a field that only an action picks: the module changes the action with it', async () => {
    addUnusedField()
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

  it('says a used field cannot be renamed, and why: pages and queries name it directly. It lists where, and puts the name back', async () => {
    const { actions } = await fieldsTab({ entity_field_update: ok() })
    await typeInto(nameOf('slug'), 'permalink')
    expect(confirmText()).toContain('“slug” is used in 7 places')
    expect(text(q('[data-confirm-description]'))).toContain('pages and queries name it directly, so they would stop working')
    expect(entries('[data-confirm-uses]')).toEqual(expect.arrayContaining([key('page', 'pg_post_detail'), key('page', 'pg_index')]))
    expect(q('[data-confirm-ok]')).toBeNull()
    await click(q('[data-confirm-cancel]'))
    expect(inputs(actions, 'entity_field_update')).toEqual([])
    expect(nameOf('slug').value).toBe('slug')
  })

  // Neither case is used by anything that stops a rename: the second has only the create action's pick, which follows the new name.
  it.each([
    ['a field nothing uses', () => addUnusedField()],
    ['a field that only an action picks', () => {
      addUnusedField()
      world.model.modules.blog!.actions.find(action => action.id === 'act_create_post')!.input.pick!.push('extra')
    }]
  ])('renames %s without asking', async (_name, setup) => {
    setup()
    const { actions } = await fieldsTab({ entity_field_update: ok() })
    await typeInto(nameOf('extra'), 'more')
    expect(q('[data-confirm]')).toBeNull()
    expect(inputs(actions, 'entity_field_update')).toEqual([{ entity: 'ent_post', field: 'fld_extra', name: 'more' }])
  })

  it('puts the name back on Esc, and renames nothing', async () => {
    addUnusedField()
    const { actions } = await fieldsTab({ entity_field_update: ok() })
    const input = nameOf('extra')
    input.focus()
    input.value = 'more'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // A browser fires `change` when an edited field loses the focus (Esc leaves it by blurring), unless its text is the one it had.
    input.addEventListener('blur', () => {
      if (input.value !== 'extra') input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(inputs(actions, 'entity_field_update')).toEqual([])
    expect(nameOf('extra').value).toBe('extra')
  })
})

describe('deleting a collection', () => {
  it('says a used collection is used in N places before it is deleted, lists them, and has only a Close button', async () => {
    const { actions } = await open({ entity_delete: ok({ deleted: [] }) })
    await menuItem(byLabel('Collection actions'), 'Delete')
    expect(confirmText()).toContain('“Post” is used in 4 places')
    expect(dialogButtons()).toEqual(['Close'])
    expect(text(q('[data-confirm-description]'))).toContain('A collection can\'t be deleted while it is used.')
    expect(entries('[data-confirm-uses]')).toEqual(expect.arrayContaining([key('page', 'pg_index'), key('page', 'pg_post_detail'), key('page', 'pg_new_post'), key('component', 'cmp_post_card')]))
    expect(text(q('[data-confirm-uses]'))).toContain('Updated automatically')
    expect(q('[data-confirm-ok]')).toBeNull()
    await click(q('[data-confirm-cancel]'))
    expect(inputs(actions, 'entity_delete')).toEqual([])
  })

  it('deletes a collection nothing outside uses after the usual confirmation', async () => {
    freeQuotes()
    const { actions } = await open({ entity_delete: ok({ deleted: ['ent_quote'] }) })
    await menuItem(collection('quotes')!.parentElement!.querySelector('[aria-label="Collection actions"]'), 'Delete')
    expect(text(q('[data-confirm-description]'))).toContain('The collection goes with its queries')
    expect(text(q('[data-confirm-description]'))).not.toContain('used in')
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

  it('says what a rename of a used collection does before it runs: places keep working, hand-written code needs the rename', async () => {
    const { actions } = await open({ entity_update: ok() })
    await rename('Article')
    expect(text(q('[data-confirm-description]'))).toContain('Used in 4 places')
    expect(text(q('[data-confirm-description]'))).toContain('They follow the collection itself, not its name, so they keep working.')
    expect(text(q('[data-confirm-description]'))).toContain('Code you wrote yourself that uses its name must be renamed too.')
    expect(entries('[data-confirm-uses]')).toContain(key('page', 'pg_index'))
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
    expect(text(q('[data-confirm-description]'))).toContain('Code you wrote yourself that uses its plural must be renamed too.')
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
