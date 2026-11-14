import { describe, expect, it } from 'vitest'
import { allByTestId, byTestId, click, Failure } from '../helpers.ts'
import { find, fromCanvas, indexPage, open, select, sent, setupHarness } from './harness.ts'

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
    await click(byTestId('device-tablet'))
    await fromCanvas({ type: 'bildr:style-commit', nodeId: 'n_h1', style: { 'md:w': '64' } })

    expect(actions.named('node_update_style').map(call => call.input)).toEqual([{ file: 'pg_index', nodeIds: ['n_h1'], style: { 'md:w': '64' } }])
    expect(previews().at(-1)).toEqual({ type: 'bildr:preview', nodeId: 'n_h1', style: null })
  })

  it('records the release in the active variant of a component', async () => {
    const { actions } = await open({ component_variant_set_override: ok }, 'cmp_post_card')
    await click(byTestId('variant-tab-var_compact'))
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

describe('breadcrumbs', () => {
  it('show the path from the root to the selected layer, and a click selects that ancestor', async () => {
    await open()
    expect(byTestId('breadcrumbs')).toBeNull()
    await select('n_h1')
    expect(allByTestId('breadcrumb').map(crumb => crumb.textContent?.trim())).toEqual(['Page', 'Row', 'Heading'])
    expect(byTestId('breadcrumb-n_h1')?.getAttribute('aria-current')).toBe('true')

    await click(byTestId('breadcrumb-n_head'))
    expect(sent('bildr:select').at(-1)).toMatchObject({ nodeId: 'n_head', nodeIds: ['n_head'] })
    expect(allByTestId('breadcrumb').map(crumb => crumb.textContent?.trim())).toEqual(['Page', 'Row'])
  })

  it('use a layer\'s own name where it has one, and a component\'s for its instance', async () => {
    find(indexPage().root, 'n_h1')!.name = 'Title'
    await open()
    await select('n_card')
    expect(allByTestId('breadcrumb').map(crumb => crumb.textContent?.trim())).toEqual(['Page', 'List', 'PostCard'])
    await select('n_h1')
    expect(allByTestId('breadcrumb').at(-1)?.textContent?.trim()).toBe('Title')
  })
})
