import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesign } from '../../src/design/store.ts'
import { openItem } from '../../src/editor/openItem.ts'
import type { OpenContext } from '../../src/editor/openItem.ts'
import { createEditor } from '../../src/editor/useEditor.ts'
import type { EditorToast } from '../../src/editor/useEditor.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'
import { itemOfUse } from '../../src/shared/items.ts'
import { mockActions, settle } from '../helpers.ts'
import { baseHandlers, setupHarness, world } from '../design/harness.ts'

/**
 * The one way an item is opened (S8, S10): a page, a component or a layout on the Canvas, a collection, a connection, a query or an action in the Data
 * workspace; from an editor (which guards unsaved edits) or from a screen with none (the Checks screen), for a link of a "Used in" list and for a
 * link of the Checks screen alike. A link to something deleted since lands on its screen, with a message.
 */

setupHarness()

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  takeStart()
})

const boot = async (view?: 'data') => {
  mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }) })
  const design = createDesign()
  const editor = createEditor(design, view ? { view } : {})
  disposers.push(() => design.dispose())
  await editor.start()
  await settle()
  return editor
}

/** The screens the editors ask the shell for, as the shell's router answers them. */
const screens = () => {
  const open = vi.fn()
  disposers.push(registerScreens(open))
  return open
}

/** A screen with no editor: what the Checks screen opens from. */
const withoutEditor = (model: OpenContext['model'] = world.model) => {
  const push = vi.fn()
  const notice = vi.fn<(toast: EditorToast) => void>()
  const context = { editor: null, push, model, notify: notice } satisfies OpenContext
  return { push, notice, context }
}

describe('the one vocabulary of items', () => {
  it('names a collection what the usage index calls an entity, and every other kind as it is', () => {
    expect(itemOfUse({ kind: 'entity', id: 'ent_post' })).toEqual({ kind: 'collection', id: 'ent_post' })
    expect(itemOfUse({ kind: 'page', id: 'pg_index' })).toEqual({ kind: 'page', id: 'pg_index' })
    expect(itemOfUse({ kind: 'component', id: 'cmp_tip' })).toEqual({ kind: 'component', id: 'cmp_tip' })
    expect(itemOfUse({ kind: 'layout', id: 'lay_main' })).toEqual({ kind: 'layout', id: 'lay_main' })
    expect(itemOfUse({ kind: 'query', id: 'q_featured_posts' })).toEqual({ kind: 'query', id: 'q_featured_posts' })
    expect(itemOfUse({ kind: 'action', id: 'act_create_post' })).toEqual({ kind: 'action', id: 'act_create_post' })
  })
})

describe('opening an item from an editor', () => {
  it('shows a collection, a connection, a query or an action in the Data workspace', async () => {
    const editor = await boot('data')
    await openItem({ kind: 'collection', id: 'ent_quote' }, { editor })
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_quote' })
    await openItem({ kind: 'connection', id: 'ds_quotes' }, { editor })
    expect(editor.dataItem).toEqual({ kind: 'connection', id: 'ds_quotes' })
    // A connection chosen does not keep the collection from being the item shown.
    await openItem({ kind: 'collection', id: 'ent_post' }, { editor })
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
    await openItem({ kind: 'query', id: 'q_featured_posts' }, { editor })
    expect(editor.dataItem).toEqual({ kind: 'query', id: 'q_featured_posts' })
    await openItem({ kind: 'action', id: 'act_create_post' }, { editor })
    expect(editor.dataItem).toEqual({ kind: 'action', id: 'act_create_post' })
  })

  it('opens the Data workspace from the Design screen, carrying the collection', async () => {
    const open = screens()
    const editor = await boot()
    await openItem({ kind: 'collection', id: 'ent_quote' }, { editor })
    expect(open).toHaveBeenLastCalledWith('data')
    expect(takeStart()).toMatchObject({ view: 'data', data: { collectionId: 'ent_quote' } })
  })

  it('opens a page on the Canvas, in the Pages panel', async () => {
    screens()
    const editor = await boot()
    editor.sidebarPanel = 'assets'
    await openItem({ kind: 'page', id: 'pg_post_detail' }, { editor })
    expect(editor).toMatchObject({ mode: 'build', sidebarPanel: 'pages', pageId: 'pg_post_detail' })
  })

  it('opens a component in its own view, in the Assets panel', async () => {
    screens()
    const editor = await boot()
    await openItem({ kind: 'component', id: 'cmp_tip' }, { editor })
    expect(editor).toMatchObject({ mode: 'build', sidebarPanel: 'assets', componentId: 'cmp_tip' })
  })

  it('opens a layout in its own view, in the Assets panel', async () => {
    screens()
    const editor = await boot()
    await openItem({ kind: 'layout', id: 'lay_main' }, { editor })
    expect(editor).toMatchObject({ mode: 'build', sidebarPanel: 'assets', layoutId: 'lay_main' })
  })

  // Each is its own editor: the shell leaves the Data screen, and its editor, for the Design screen.
  it.each([
    [{ kind: 'page', id: 'pg_post_detail' }, { pageId: 'pg_post_detail' }],
    [{ kind: 'component', id: 'cmp_tip' }, { fileId: 'cmp_tip' }],
    [{ kind: 'layout', id: 'lay_main' }, { fileId: 'lay_main' }]
  ] as const)('opens the Design screen from the Data workspace on %j', async (item, start) => {
    const open = screens()
    const editor = await boot('data')
    await openItem(item, { editor })
    expect(open).toHaveBeenLastCalledWith('design')
    expect(takeStart()).toMatchObject({ view: 'build', data: start })
  })
})

describe('opening an item asks before it leaves unsaved edits', () => {
  const DISCARD = 'Discard unsaved changes to Post (JSON)?'

  it('asks first from the Data workspace, and opens the item once the edits are given up', async () => {
    const editor = await boot('data')
    editor.reportDirty().set('Post (JSON)')
    const opened = openItem({ kind: 'query', id: 'q_featured_posts' }, { editor })
    await settle()
    expect(editor.confirmRequest?.title).toBe(DISCARD)
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
    editor.confirmRequest?.answer(true)
    expect(await opened).toBe(true)
    expect(editor.dataItem).toEqual({ kind: 'query', id: 'q_featured_posts' })
    expect(editor.dataDirty).toBeNull()
  })

  it('keeps the item and the edits when they are kept', async () => {
    const editor = await boot('data')
    editor.reportDirty().set('Post (JSON)')
    const opened = openItem({ kind: 'action', id: 'act_create_post' }, { editor })
    await settle()
    editor.confirmRequest?.answer(false)
    expect(await opened).toBe(false)
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
    expect(editor.dataDirty).toBe('Post (JSON)')
  })

  it('asks first before it leaves the Data workspace for the Canvas, and goes nowhere when the edits are kept', async () => {
    const open = screens()
    const editor = await boot('data')
    editor.reportDirty().set('Post (JSON)')
    const opened = openItem({ kind: 'page', id: 'pg_index' }, { editor })
    await settle()
    expect(editor.confirmRequest?.title).toBe(DISCARD)
    expect(open).not.toHaveBeenCalled()
    editor.confirmRequest?.answer(false)
    expect(await opened).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(editor.mode).toBe('data')
  })

  it('does not ask when nothing is unsaved', async () => {
    const editor = await boot('data')
    await openItem({ kind: 'query', id: 'q_featured_posts' }, { editor })
    expect(editor.confirmRequest).toBeNull()
  })
})

describe('opening an item from a screen with no editor', () => {
  it('pushes the Data workspace on a collection, a connection, a query or an action', async () => {
    const { push, context } = withoutEditor()
    await openItem({ kind: 'collection', id: 'ent_post' }, context)
    expect(push).toHaveBeenLastCalledWith({ path: '/data', query: { item: 'collection:ent_post' } })
    await openItem({ kind: 'connection', id: 'ds_quotes' }, context)
    expect(push).toHaveBeenLastCalledWith({ path: '/data', query: { item: 'connection:ds_quotes' } })
    await openItem({ kind: 'query', id: 'q_featured_posts' }, context)
    expect(push).toHaveBeenLastCalledWith({ path: '/data', query: { item: 'query:q_featured_posts' } })
    await openItem({ kind: 'action', id: 'act_create_post' }, context)
    expect(push).toHaveBeenLastCalledWith({ path: '/data', query: { item: 'action:act_create_post' } })
  })

  it('opens the Design screen on a page (its own start), and on a component or a layout (another)', async () => {
    const open = screens()
    const { push, context } = withoutEditor()
    await openItem({ kind: 'page', id: 'pg_index' }, context)
    expect(open).toHaveBeenLastCalledWith('design')
    expect(takeStart()).toEqual({ view: 'build', data: { pageId: 'pg_index' } })
    await openItem({ kind: 'component', id: 'cmp_tip' }, context)
    expect(takeStart()).toEqual({ view: 'build', data: { fileId: 'cmp_tip' } })
    await openItem({ kind: 'layout', id: 'lay_main' }, context)
    expect(takeStart()).toEqual({ view: 'build', data: { fileId: 'lay_main' } })
    expect(push).not.toHaveBeenCalled()
  })

  it('opens what it is asked for while the model is not known (nothing says it is gone)', async () => {
    const { push, notice, context } = withoutEditor(null)
    await openItem({ kind: 'collection', id: 'ent_gone' }, context)
    expect(push).toHaveBeenLastCalledWith({ path: '/data', query: { item: 'collection:ent_gone' } })
    expect(notice).not.toHaveBeenCalled()
  })
})

describe('an item that is gone', () => {
  it.each([
    ['collection', 'ent_gone', 'That collection no longer exists'],
    ['connection', 'ds_gone', 'That connection no longer exists'],
    ['query', 'q_gone', 'That query no longer exists'],
    ['action', 'act_gone', 'That action no longer exists']
  ] as const)('lands on the Data workspace, with a message, for a %s deleted since the link was made', async (kind, id, title) => {
    const { push, notice, context } = withoutEditor()
    expect(await openItem({ kind, id }, context)).toBe(true)
    expect(push).toHaveBeenCalledOnce()
    expect(push).toHaveBeenLastCalledWith({ path: '/data', query: {} })
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ title, color: 'warning' }))
  })

  it.each([
    ['page', 'pg_gone', 'That page no longer exists'],
    ['component', 'cmp_gone', 'That component no longer exists'],
    ['layout', 'lay_gone', 'That layout no longer exists']
  ] as const)('lands on the Design screen, with a message, for a %s deleted since the link was made', async (kind, id, title) => {
    const open = screens()
    const { push, notice, context } = withoutEditor()
    await openItem({ kind, id }, context)
    expect(open).toHaveBeenLastCalledWith('design')
    // It does not ask the Design screen to open a file that is not there.
    expect(takeStart()).toEqual({ view: 'build', data: {} })
    expect(push).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ title }))
  })

  it('stays where it is when that is where the item would have been, and says so', async () => {
    const open = screens()
    const editor = await boot('data')
    const toasts: EditorToast[] = []
    await openItem({ kind: 'query', id: 'q_gone' }, { editor, notify: toast => toasts.push(toast) })
    expect(open).not.toHaveBeenCalled()
    expect(toasts.map(toast => toast.title)).toEqual(['That query no longer exists'])
    expect(editor.dataItem).toEqual({ kind: 'collection', id: 'ent_post' })
  })

  it('goes to the Design screen from the Data workspace for a page that is gone, after asking about unsaved edits', async () => {
    const open = screens()
    const editor = await boot('data')
    editor.reportDirty().set('Post (JSON)')
    const opened = openItem({ kind: 'page', id: 'pg_gone' }, { editor, notify: () => undefined })
    await settle()
    expect(editor.confirmRequest?.title).toContain('Discard unsaved changes')
    editor.confirmRequest?.answer(true)
    await opened
    expect(open).toHaveBeenLastCalledWith('design')
  })

  it('says nothing is wrong with an id of the other kind: a page id is not a layout', async () => {
    screens()
    const { notice, context } = withoutEditor()
    await openItem({ kind: 'layout', id: 'pg_index' }, context)
    expect(notice).toHaveBeenCalledOnce()
  })
})
