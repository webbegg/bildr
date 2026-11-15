import { describe, expect, it } from 'vitest'
import { byTestId, click, Failure, settle } from '../helpers.ts'
import { chooseDevice, find, fromCanvas, indexPage, layer, open, openFile, select, sent, setupHarness, showVariant } from './harness.ts'

/**
 * The editor's side of the canvas handle drags (P4c): a drag's patch is shown
 * live (`bildr:style-preview` → `bildr:preview`), the release is one edit
 * (`bildr:style-commit`), and the selection's breadcrumbs.
 */

setupHarness()

const ok = () => ({ changed: [] })
const previews = () => sent('bildr:preview')

describe('handle drags', () => {
  it('shows a drag\'s patch live in the canvas, and drops it when the drag is cancelled', async () => {
    await open()
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { w: '64' } })
    expect(previews().at(-1)).toEqual({ type: 'bildr:preview', nodeId: 'n_h1', style: { w: '64' } })
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: null })
    expect(previews().at(-1)).toEqual({ type: 'bildr:preview', nodeId: 'n_h1', style: null })
  })

  it('commits the release as one node_update_style with the keys the drag holds (already at its breakpoint), then drops the preview', async () => {
    const { actions } = await open({ node_update_style: ok })
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { 'md:w': '64' } })
    await chooseDevice('tablet')
    await fromCanvas({ type: 'bildr:style-commit', nodeId: 'n_h1', style: { 'md:w': '64' } })

    expect(actions.named('node_update_style').map(call => call.input)).toEqual([{ file: 'pg_index', nodeIds: ['n_h1'], style: { 'md:w': '64' } }])
    expect(previews().at(-1)).toEqual({ type: 'bildr:preview', nodeId: 'n_h1', style: null })
  })

  it('records the release in the active variant of a component', async () => {
    const { actions } = await open({ component_variant_set_override: ok }, 'cmp_post_card')
    await showVariant('var_compact')
    await fromCanvas({ type: 'bildr:style-commit', nodeId: 'n_card', style: { pt: '6' } })
    expect(actions.named('component_variant_set_override').map(call => call.input)).toEqual([{ component: 'cmp_post_card', variant: 'var_compact', nodeId: 'n_card', style: { pt: '6' } }])
  })

  it('a refused commit shows the refusal and still drops the preview', async () => {
    await open({ node_update_style: () => new Failure(422, 'invalid', 'Unknown style token "wat"') })
    await fromCanvas({ type: 'bildr:style-commit', nodeId: 'n_h1', style: { w: '64' } })
    expect(byTestId('design-error')?.textContent?.trim()).toBe('Unknown style token "wat"')
    expect(previews().at(-1)).toEqual({ type: 'bildr:preview', nodeId: 'n_h1', style: null })
  })
})

describe('Esc during a drag', () => {
  const escape = async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    await settle()
  }

  it('cancels the drag in the canvas and keeps the selection', async () => {
    await open()
    await select('n_h1')
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { 'lg:w': '96' } })

    await escape()

    expect(sent('bildr:cancel-drag')).toEqual([{ type: 'bildr:cancel-drag' }])
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeIds: ['n_h1'] })
  })

  it('is the usual Esc again once the drag ended: it selects the parent (Framer\'s) and cancels nothing', async () => {
    await open()
    await select('n_h1')
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { 'lg:w': '96' } })
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: null })

    await escape()

    expect(sent('bildr:cancel-drag')).toEqual([])
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_head', nodeIds: ['n_head'] })
  })

  it('a commit ends the drag too', async () => {
    await open({ node_update_style: ok })
    await select('n_h1')
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { 'lg:w': '96' } })
    await fromCanvas({ type: 'bildr:style-commit', nodeId: 'n_h1', style: { 'lg:w': '96' } })

    await escape()

    expect(sent('bildr:cancel-drag')).toEqual([])
  })
})

describe('breadcrumb', () => {
  const crumbs = () => [...document.body.querySelectorAll('[data-breadcrumb] [data-crumb]')].map(crumb => crumb.textContent?.trim())

  it('shows the component being edited over its page, and a click goes back a level; Esc with nothing selected goes up one', async () => {
    await open()
    expect(document.body.querySelector('[data-breadcrumb]')).toBeNull()
    await openFile('cmp_post_card')
    expect(crumbs()).toEqual(['index', 'PostCard'])
    expect(document.body.querySelector('[data-breadcrumb-reach]')?.textContent).toBe('1 instance')
    expect(sent('bildr:render').at(-1)?.file.id).toBe('cmp_post_card')

    await click(document.body.querySelector('[data-breadcrumb] button[data-crumb="page"]'))
    expect(document.body.querySelector('[data-breadcrumb]')).toBeNull()
    expect(sent('bildr:render').at(-1)?.file.id).toBe('pg_index')

    await openFile('cmp_post_card')
    await select('n_card')
    await click(document.body.querySelector('[data-breadcrumb-done]'))
    expect(sent('bildr:render').at(-1)?.file.id).toBe('pg_index')
  })

  it('selects the parent with Esc, up to the root, one level at a time', async () => {
    await open()
    await select('n_h1')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await settle()
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_head' })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await settle()
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_page' })
  })

  it('names a layer by its own name where it has one, and an instance by its component', async () => {
    find(indexPage().root, 'n_h1')!.name = 'Title'
    await open()
    // The name, then the node's text in italics.
    expect(layer('n_h1')?.querySelector('[data-layer-name] > span')?.textContent?.trim()).toBe('Title')
    expect(layer('n_h1')?.querySelector('[data-layer-name]')?.textContent).toContain('Posts')
    expect(layer('n_card')?.querySelector('[data-layer-name] > span')?.textContent?.trim()).toBe('PostCard')
  })
})
