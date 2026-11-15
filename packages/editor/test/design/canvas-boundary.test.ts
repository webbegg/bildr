import { describe, expect, it } from 'vitest'
import { byLabel, chooseDevice, fromCanvas, frames, menuItem, open, readyAll, select, sent, setupHarness, toggle, world } from './harness.ts'
import { settle } from '../helpers.ts'

/** The editor↔canvas trust boundary (U-E1, V6): only this editor's mounted frames, at this origin, are heard. */

setupHarness()
const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const drop = { type: 'bildr:drop' as const, parentId: 'n_page', index: 0, payload: JSON.stringify({ kind: 'component', type: 'Text' }) }
const raw = async (data: unknown, source: unknown, origin = window.location.origin) => {
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window, origin }))
  await settle()
}

describe('the editor hears only its own mounted frames', () => {
  it('a frame hidden by "Active frame only" is no longer heard', async () => {
    const { actions } = await open({ node_insert: ok() })
    await chooseDevice('tablet')
    const mobile = frames().find(f => f.dataset.device === 'mobile')!
    const stale = mobile.contentWindow
    await menuItem(byLabel('Zoom'), 'Active frame only')
    expect(document.body.contains(mobile)).toBe(false)
    await raw(drop, stale)
    expect(actions.named('node_insert')).toEqual([])
    await fromCanvas(drop)
    expect(actions.named('node_insert')).toHaveLength(1)
  })

  it('board frames are not heard once the board is off, nor the device frame once it is back on', async () => {
    const { actions } = await open({ node_insert: ok() }, 'cmp_post_card')
    await readyAll()
    const boardWindows = frames().map(f => f.contentWindow)
    expect(boardWindows).toHaveLength(3)
    await toggle('[data-variant-board-toggle]')
    const deviceFrame = frames()[0]!
    for (const w of boardWindows) await raw({ ...drop, parentId: 'n_card' }, w)
    const deviceWindow = deviceFrame.contentWindow
    await toggle('[data-variant-board-toggle]')
    await raw({ ...drop, parentId: 'n_card' }, deviceWindow)
    expect(actions.named('node_insert')).toEqual([])
  })

  it('ignores a null, empty or look-alike origin and a null source', async () => {
    const { actions } = await open({ node_insert: ok() })
    for (const origin of ['null', '', `${window.location.origin}.evil.test`, window.location.origin.replace('http:', 'https:')]) await fromCanvas(drop, origin)
    await raw(drop, null)
    expect(actions.named('node_insert')).toEqual([])
  })

  it('malformed data from an own frame does nothing', async () => {
    const { actions } = await open({ node_insert: ok(), node_move: ok() })
    const own = frames()[0]!.contentWindow
    const before = world.posted.length
    for (const data of [null, undefined, 'bildr:drop', 42, [], { type: 5 }, { type: 'drop' }, { type: 'bildr:nope' }, JSON.stringify(drop),
      { ...drop, payload: 'not json' }, { ...drop, payload: '{"kind":"node"}' }, { ...drop, payload: '{"kind":"component","type":7}' }, { ...drop, payload: 'null' }]) await raw(data, own)
    expect(actions.named('node_insert')).toEqual([])
    expect(actions.named('node_move')).toEqual([])
    expect(world.posted.length).toBe(before)
  })
})

describe('drops and Esc across frames', () => {
  it('a drop from a non-active frame inserts and activates it; a gesture node drop moves', async () => {
    const { actions } = await open({ node_insert: ok({ nodeId: 'n_text_1' }), node_move: ok() })
    await chooseDevice('tablet')
    await readyAll()
    const mobile = frames().find(f => f.dataset.device === 'mobile')!
    await fromCanvas({ ...drop, index: 1 }, undefined, mobile)
    expect(actions.named('node_insert').map(c => c.input)).toEqual([{ file: 'pg_index', parentId: 'n_page', index: 1, type: 'Text' }])
    expect(document.body.querySelector('[data-frame="mobile"]')?.hasAttribute('data-active')).toBe(true)
    await fromCanvas({ type: 'bildr:drop', parentId: 'n_head', index: 2, payload: JSON.stringify({ kind: 'node', id: 'n_h1' }) })
    expect(actions.named('node_move').map(c => c.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', parentId: 'n_head', index: 1 }])
  })

  it('Esc during a drag in the non-active frame cancels it in every frame and keeps the selection', async () => {
    localStorage.setItem('bildr:frames', JSON.stringify(['tablet', 'mobile']))
    await open()
    await readyAll()
    await select('n_h1')
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { w: '64' } }, undefined, frames()[1]!)
    world.posted = []
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(sent('bildr:cancel-drag')).toHaveLength(2)
    expect(sent('bildr:select')).toEqual([])
  })

  it('a style-preview from another origin does not arm the Esc cancel', async () => {
    await open()
    await select('n_h1')
    await fromCanvas({ type: 'bildr:style-preview', nodeId: 'n_h1', style: { w: '64' } }, 'https://evil.test')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(sent('bildr:cancel-drag')).toEqual([])
  })
})
