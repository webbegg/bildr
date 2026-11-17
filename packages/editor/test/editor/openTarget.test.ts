import { describe, expect, it, vi } from 'vitest'
import { openTarget } from '../../src/editor/openTarget.ts'
import type { Target } from '../../src/editor/findingTargets.ts'
import type { Editor } from '../../src/editor/useEditor.ts'
import { registerScreens, takeStart } from '../../src/editor/views.ts'

/** How each kind of target is opened (S8): a route is pushed, an item of the canvas is opened by the editor of the screen, or, on a screen with no editor, by the Design screen that is opened for it. */

const route = (kind: Target['kind'], id: string, to: NonNullable<Target['to']>): Target => ({ kind, id, label: 'x', to })

describe('opening a target', () => {
  it.each([
    [route('code', 'layers/blog/app/pages/index.vue', { path: '/code', query: { path: '.bildr/modules/blog/pages/index.json', file: 'layers/blog/app/pages/index.vue' } })],
    [route('collection', 'ent_post', { path: '/data', query: { item: 'collection:ent_post' } })],
    [route('connection', 'ds_quotes', { path: '/data', query: { item: 'connection:ds_quotes' } })],
    [route('query', 'q_featured_posts', { path: '/data', query: { item: 'query:q_featured_posts' } })],
    [route('action', 'act_create_post', { path: '/data', query: { item: 'action:act_create_post' } })],
    [route('files', '.bildr/layouts/main.json', { path: '/data', query: { item: 'files', file: '.bildr/layouts/main.json' } })]
  ])('pushes the route of %j', (target) => {
    const push = vi.fn()
    openTarget(target, { push, editor: null })
    expect(push).toHaveBeenCalledWith(target.to)
  })

  it('opens a page, a component and a layout through the editor that is there, as a "Used in" link does', () => {
    const editor = { mode: 'data', sidebarPanel: '', selectPage: vi.fn(), editComponent: vi.fn(), editLayout: vi.fn() } as unknown as Editor
    const push = vi.fn()
    openTarget({ kind: 'page', id: 'pg_index', label: 'x' }, { push, editor })
    expect(editor).toMatchObject({ mode: 'build', sidebarPanel: 'pages' })
    expect(editor.selectPage).toHaveBeenCalledWith('pg_index')
    openTarget({ kind: 'component', id: 'cmp_tip', label: 'x' }, { push, editor })
    expect(editor.editComponent).toHaveBeenCalledWith('cmp_tip')
    openTarget({ kind: 'layout', id: 'lay_main', label: 'x' }, { push, editor })
    expect(editor.editLayout).toHaveBeenCalledWith('lay_main')
    expect(push).not.toHaveBeenCalled()
  })

  it('opens the Design screen on the page, component or layout when no editor is there (the Checks screen)', () => {
    const open = vi.fn()
    const off = registerScreens(open)
    try {
      const push = vi.fn()
      openTarget({ kind: 'page', id: 'pg_index', label: 'x' }, { push, editor: null })
      expect(open).toHaveBeenLastCalledWith('design')
      expect(takeStart()).toEqual({ view: 'build', data: { pageId: 'pg_index' } })
      openTarget({ kind: 'component', id: 'cmp_tip', label: 'x' }, { push, editor: null })
      expect(takeStart()).toEqual({ view: 'build', data: { fileId: 'cmp_tip' } })
      openTarget({ kind: 'layout', id: 'lay_main', label: 'x' }, { push, editor: null })
      expect(takeStart()).toEqual({ view: 'build', data: { fileId: 'lay_main' } })
      expect(push).not.toHaveBeenCalled()
    } finally {
      off()
    }
  })
})
