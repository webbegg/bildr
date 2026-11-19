import { describe, expect, it } from 'vitest'
import type { EditorToCanvas } from '../../src/canvas/protocol.ts'
import { byTestId, click, settle } from '../helpers.ts'
import { chooseDevice, FakeEventSource, find, fromCanvas, frames, indexPage, modelGet, open, openFile, readyAll, sent, setupHarness, world } from './harness.ts'

/**
 * State in the canvas preview (B5, S5): the Design screen holds the values a `setState` step sets while the canvas is in
 * preview, shows them to every page that uses the State (a computed value follows: the drafts toggle switches the List), keeps
 * them across renders, resets them on request and when preview ends, and drops those a model edit left without a field.
 */

setupHarness()

const lastData = () => sent('bildr:render').at(-1)!.data
const slugs = (rows: unknown) => (rows as Array<{ slug: string }>).map(row => row.slug)
const shown = () => slugs(lastData().posts)
const featured = ['hello-bildr']
const everything = ['a-draft', 'hello-bildr']
const preferences = () => lastData().preferences

const setState = (value: unknown, extra: Record<string, unknown> = {}) => fromCanvas({
  type: 'bildr:interaction',
  nodeId: 'n_toggle',
  on: 'change',
  step: { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value, ...extra } as never
})
const preview = () => click(byTestId('preview-toggle'))
const reset = () => byTestId('reset-state')
/** The module tells the editor a model file changed: it reads the model again. */
const modelChanged = async () => {
  FakeEventSource.instances.at(-1)!.send({ type: 'model', version: 9, files: ['.bildr/modules/blog/pages/index.json'], source: 'disk' })
  await settle()
}

describe('the canvas holds the State\'s values', () => {
  it('starts at the defaults: the page\'s computed List source picks the featured posts', async () => {
    await open({}, 'pg_index')
    expect(preferences()).toEqual({ showDrafts: false })
    expect(shown()).toEqual(featured)
  })

  it('applies Set state in preview: the List includes the draft, and goes back when set again', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    expect(preferences()).toEqual({ showDrafts: true })
    expect(shown()).toEqual(everything)
    await setState(false)
    expect(preferences()).toEqual({ showDrafts: false })
    expect(shown()).toEqual(featured)
  })

  it('ignores Set state while the canvas is editing', async () => {
    await open({}, 'pg_index')
    const renders = sent('bildr:render').length
    await setState(true)
    expect(preferences()).toEqual({ showDrafts: false })
    expect(sent('bildr:render').length).toBe(renders)
  })

  it('ignores what it cannot apply: another kind of value, a field or State that is not there, a State the page does not use', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState('yes')
    await setState({ not: { $bind: 'preferences.showDrafts' } })
    await setState(true, { field: 'gone' })
    await setState(true, { state: 'st_gone' })
    expect(preferences()).toEqual({ showDrafts: false })
    // A step the node reported does not have (another node, another event) is not the page's own: nothing is set.
    await fromCanvas({ type: 'bildr:interaction', nodeId: 'n_any', on: 'click', step: { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: true } })
    await fromCanvas({ type: 'bildr:interaction', nodeId: 'n_h1', on: 'change', step: { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: true } })
    await fromCanvas({ type: 'bildr:interaction', nodeId: 'n_toggle', on: 'click', step: { kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: true } })
    expect(shown()).toEqual(featured)

    // A page without the State: the canvas shows the page, the step has nothing to set.
    await open({}, 'pg_new_post')
    await preview()
    await setState(false)
    expect(lastData().preferences).toBeUndefined()
  })

  it('survives a render a model edit causes, and is the same in every render', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    find(indexPage().root, 'n_h1')!.props!.text = 'Changed on disk'
    await modelChanged()
    expect(find(sent('bildr:render').at(-1)!.file.root, 'n_h1')?.props?.text).toBe('Changed on disk')
    expect(preferences()).toEqual({ showDrafts: true })
    expect(shown()).toEqual(everything)
  })

  it('drops a value whose field was renamed or removed: the field starts again at its default', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    const state = world.model.modules.blog!.state[0]!
    state.fields[0]!.name = 'showAll'
    await modelChanged()
    state.fields[0]!.name = 'showDrafts'
    await modelChanged()
    expect(preferences()).toEqual({ showDrafts: false })
    expect(shown()).toEqual(featured)
  })

  it('drops a value when the field\'s default is changed in Data: the field starts again at its new default', async () => {
    await open({}, 'pg_index')
    await preview()
    // Set to off, which the default already is: the preview holds that as a value of its own.
    await setState(false)
    expect(preferences()).toEqual({ showDrafts: false })
    world.model.modules.blog!.state[0]!.fields[0]!.default = true
    await modelChanged()
    // The new default shows: the old value did not outlive the default it was set over.
    expect(preferences()).toEqual({ showDrafts: true })
    expect(shown()).toEqual(everything)
  })

  it('keeps a value when the model changes in a way that leaves the field\'s default as it was', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    world.model.modules.blog!.state[0]!.fields[0]!.required = true
    await modelChanged()
    expect(preferences()).toEqual({ showDrafts: true })
  })

  it('drops the values of a State that was deleted, and does not bring them back with the State', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    const blog = world.model.modules.blog!
    const [state] = blog.state.splice(0, 1)
    await modelChanged()
    blog.state.push(state!)
    await modelChanged()
    expect(preferences()).toEqual({ showDrafts: false })
  })
})

describe('the values through the editor\'s own changes', () => {
  it('keeps them while the model is briefly invalid, and prunes them against the next valid model', async () => {
    let invalid = false
    await open({ model_get: () => invalid ? { ok: false, problems: [] } : modelGet() }, 'pg_index')
    await preview()
    await setState(true)
    // The module reads a half-written file: the model is invalid for a moment, then it is as it was.
    invalid = true
    await modelChanged()
    invalid = false
    await modelChanged()
    expect(preferences()).toEqual({ showDrafts: true })
    expect(shown()).toEqual(everything)

    // A field renamed in that moment is gone when the model is valid again.
    const state = world.model.modules.blog!.state[0]!
    invalid = true
    await modelChanged()
    state.fields[0]!.name = 'showAll'
    invalid = false
    await modelChanged()
    state.fields[0]!.name = 'showDrafts'
    await modelChanged()
    expect(preferences()).toEqual({ showDrafts: false })
  })

  it('keeps them when another page is opened and the first one again: the State is the app\'s, not a page\'s', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    await openFile('pg_new_post')
    expect(lastData().preferences).toBeUndefined()
    await openFile('pg_index')
    expect(preferences()).toEqual({ showDrafts: true })
    expect(shown()).toEqual(everything)
  })

  it('ignores a Set state that arrives after preview ended', async () => {
    await open({}, 'pg_index')
    await preview()
    await preview()
    await setState(true)
    expect(preferences()).toEqual({ showDrafts: false })
    expect(shown()).toEqual(featured)
  })

  it('sets nothing from a layout or a component being edited: only a page uses a State', async () => {
    await open({}, 'pg_index')
    await preview()
    for (const file of ['lay_main', 'cmp_post_card']) {
      await openFile(file)
      await setState(true)
      await openFile('pg_index')
      expect(preferences(), file).toEqual({ showDrafts: false })
    }
  })

  it('gives every device frame the same value', async () => {
    await open({}, 'pg_index')
    await chooseDevice('tablet')
    await readyAll()
    expect(frames()).toHaveLength(2)
    const received = frames().map((frame) => {
      const calls: EditorToCanvas[] = []
      const stub = frame.contentWindow as unknown as { postMessage: (message: EditorToCanvas) => void }
      const original = stub.postMessage
      stub.postMessage = (message) => {
        calls.push(message)
        original(message)
      }
      return calls
    })
    await preview()
    await setState(true)
    for (const calls of received) {
      const renders = calls.filter((message): message is Extract<EditorToCanvas, { type: 'bildr:render' }> => message.type === 'bildr:render')
      expect(renders.at(-1)?.data.preferences).toEqual({ showDrafts: true })
    }
  })
})

describe('Reset state', () => {
  it('is in the toolbar while the canvas is in preview, and there is something to reset', async () => {
    await open({}, 'pg_index')
    expect(reset()).toBeNull()
    await preview()
    expect(reset()?.getAttribute('aria-label')).toBe('Reset state')
    expect(reset()?.hasAttribute('disabled')).toBe(true)
    await setState(true)
    expect(reset()?.hasAttribute('disabled')).toBe(false)
  })

  it('puts every value back to its default, and the canvas stays in preview', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    await click(reset())
    expect(preferences()).toEqual({ showDrafts: false })
    expect(shown()).toEqual(featured)
    expect(byTestId('preview-toggle')?.getAttribute('aria-pressed')).toBe('true')
    expect(reset()?.hasAttribute('disabled')).toBe(true)
    await setState(true)
    expect(shown()).toEqual(everything)
  })

  it('happens when preview ends: editing shows the page as the app first renders it', async () => {
    await open({}, 'pg_index')
    await preview()
    await setState(true)
    await preview()
    expect(byTestId('preview-toggle')?.getAttribute('aria-pressed')).toBe('false')
    expect(reset()).toBeNull()
    expect(preferences()).toEqual({ showDrafts: false })
    expect(shown()).toEqual(featured)
    await preview()
    expect(preferences()).toEqual({ showDrafts: false })
  })
})
