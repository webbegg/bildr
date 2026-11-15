import { describe, expect, it } from 'vitest'
import { settle } from '../helpers.ts'
import { boot, FakeEventSource, setupHarness } from './boot.ts'

/**
 * The adapter's selection, file and device members (U2): they read and write the
 * store, in the hosted `useEditor`'s shapes (a reactive object, no `.value`).
 */

setupHarness()

describe('selection', () => {
  it('selectedId and selectedIds are the store\'s, and writing them selects', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    editor.selectedId = 'n_head'
    expect(design.selectedIds.value).toEqual(['n_head'])
    expect(editor.selectedIds).toEqual(['n_head'])
    editor.selectedIds = ['n_head', 'n_list']
    expect(editor.selectedId).toBe('n_list')
    expect(design.selectedId.value).toBe('n_list')
    expect(editor.selected?.id).toBe('n_list')
    expect(editor.selectedNodes.map(node => node.id)).toEqual(['n_head', 'n_list'])
  })

  it('a canvas click drills from the top-level layer toward the element, Shift toggles, Cmd goes deep', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.setDeepSelect(false)
    editor.canvasClick('n_h1', { shift: false, meta: false })
    expect(editor.selectedIds).toEqual(['n_head'])
    editor.canvasClick('n_h1', { shift: false, meta: false })
    expect(editor.selectedIds).toEqual(['n_h1'])
    editor.canvasClick('n_list', { shift: true, meta: false })
    expect(editor.selectedIds).toEqual(['n_h1', 'n_list'])
    editor.canvasClick('n_quote', { shift: false, meta: true })
    expect(editor.selectedIds).toEqual(['n_quote'])
    editor.setDeepSelect(true)
    editor.canvasClick('n_about_title', { shift: false, meta: false })
    expect(editor.selectedIds).toEqual(['n_about_title'])
  })

  it('a layers row click selects it, Shift adds, and navigate steps through the tree', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.selectRow('n_head', false)
    editor.selectRow('n_list', true)
    expect(editor.selectedIds).toEqual(['n_head', 'n_list'])
    editor.selectRow('n_head', false)
    expect(editor.navigate('child')).toBe(true)
    expect(editor.selectedId).toBe('n_h1')
    editor.navigate('next')
    expect(editor.selectedId).toBe('n_toggle')
    editor.navigate('parent')
    expect(editor.selectedId).toBe('n_head')
  })

  it('hoveredId is the store\'s', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    editor.hoveredId = 'n_list'
    expect(design.hoveredId.value).toBe('n_list')
  })

  it('selecting a node inside a collapsed row opens the rows that hide it', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.setCollapsed('n_head', true)
    expect([...editor.collapsed]).toEqual(['n_head'])
    editor.selectedId = 'n_h1'
    expect([...editor.collapsed]).toEqual([])
  })

  it('selection survives a refresh while its node exists, and goes with it otherwise', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    editor.selectedIds = ['n_head', 'n_gone']
    await design.refresh()
    expect(editor.selectedIds).toEqual(['n_head'])
  })
})

describe('the file being edited', () => {
  it('currentPage, page and treeRef follow the store\'s file; a page has the model\'s path, not a slug', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    expect(editor.currentPage?.id).toBe('pg_index')
    expect(editor.pageId).toBe('pg_index')
    expect(editor.page?.id).toBe('pg_index')
    expect(editor.treeRef).toEqual({ file: 'pg_index' })
    expect(editor.currentPage?.path).toBe('/')
    expect(editor.previewUrl).toBe('/')
    expect(editor.model?.project.name).toBe(design.model.value?.project.name)
    expect(editor).not.toHaveProperty('project')
  })

  it('the component view keeps the page under it and the breadcrumb is the edit stack', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    editor.selectedId = 'n_card'
    editor.editComponent('cmp_post_card', null, { nested: true })
    await settle()
    expect(design.fileId.value).toBe('cmp_post_card')
    expect(editor.componentId).toBe('cmp_post_card')
    expect(editor.component?.name).toBe('PostCard')
    expect(editor.currentPage?.id).toBe('pg_index')
    expect(editor.editStack.map(level => level.id)).toEqual(['cmp_post_card'])
    expect(editor.page?.id).toBe('cmp_post_card')
    editor.leaveView()
    await settle()
    expect(design.fileId.value).toBe('pg_index')
    expect(editor.editStack).toEqual([])
    expect(editor.selectedIds).toEqual(['n_card'])
  })

  it('goToCrumb returns to a level and Escape with nothing selected leaves one', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.editComponent('cmp_post_card', null, { nested: true })
    editor.editLayout('lay_main')
    expect(editor.layoutId).toBe('lay_main')
    expect(editor.editStack.map(level => level.id)).toEqual(['lay_main'])
    editor.goToCrumb(-1)
    expect(editor.layoutId).toBeNull()
    expect(editor.currentPage?.id).toBe('pg_index')
    editor.editComponent('cmp_post_card')
    expect(editor.shortcut('Escape', false, false)).toBe(true)
    expect(editor.componentId).toBeNull()
  })

  it('a navigate event from an agent moves the breadcrumb with the store', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    FakeEventSource.instances.at(-1)!.send({ type: 'navigate', target: { file: 'cmp_post_card', kind: 'component', nodeId: 'n_title', variant: null } })
    await settle()
    expect(design.fileId.value).toBe('cmp_post_card')
    expect(editor.componentId).toBe('cmp_post_card')
    expect(editor.editStack.map(level => level.id)).toEqual(['cmp_post_card'])
    expect(editor.selectedIds).toEqual(['n_title'])
    FakeEventSource.instances.at(-1)!.send({ type: 'navigate', target: { file: 'pg_new_post', kind: 'page', nodeId: null, variant: null } })
    await settle()
    expect(editor.editStack).toEqual([])
    expect(editor.currentPage?.id).toBe('pg_new_post')
  })

  it('a navigate event shows the variant it names and reports the new context (editor_context_get follows an agent)', async () => {
    const { design, actions } = await boot({}, 'pg_index')
    FakeEventSource.instances.at(-1)!.send({ type: 'navigate', target: { file: 'cmp_post_card', kind: 'component', nodeId: 'n_title', variant: 'var_hovered' } })
    await settle()
    expect(design.variantId.value).toBe('var_hovered')
    expect(actions.named('editor_context_set').at(-1)?.input).toMatchObject({ file: 'cmp_post_card', nodeId: 'n_title', variant: 'var_hovered' })
  })

  it('the canvas accent is the context purple inside a component or layout, and for instances', async () => {
    const { editor } = await boot({}, 'pg_index')
    expect(editor.canvasAccent).toBe('#09f')
    editor.selectedId = 'n_card'
    expect(editor.canvasAccent).toBe('#85f')
    editor.selectedId = 'n_head'
    editor.editComponent('cmp_post_card')
    expect(editor.canvasAccent).toBe('#85f')
  })
})

describe('devices', () => {
  it('deviceId and device are the store\'s; setDevice asks the canvas to pan', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    expect(editor.deviceId).toBe(design.device.value.id)
    editor.setDevice('desktop')
    expect(design.device.value.id).toBe('desktop')
    expect(editor.deviceId).toBe('desktop')
    expect(editor.device.id).toBe('desktop')
    expect(editor.frameRequest).toEqual({ deviceId: 'desktop' })
    expect(editor.breakpointBase).toBe(design.base.value)
  })

  it('showing a frame edits it and hiding the edited one goes back to the Primary', async () => {
    const { editor } = await boot({}, 'pg_index')
    const primary = editor.device.id
    editor.showFrame('desktop')
    expect(editor.frames).toContain('desktop')
    expect(editor.deviceId).toBe('desktop')
    editor.hideFrame('desktop')
    expect(editor.frames).not.toContain('desktop')
    expect(editor.deviceId).toBe(primary)
  })
})
