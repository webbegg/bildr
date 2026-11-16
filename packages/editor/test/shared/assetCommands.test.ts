import { describe, expect, it, vi } from 'vitest'
import type { ComponentFile, LayoutFile, Model, ModelNode, PageFile } from '@bildr/codegen/model'
import { insertableComponents } from '../../src/editor/drop.ts'
import { layoutSelection } from '../../src/editor/layouts.ts'
import type { CommandContext } from '../../src/shared/commands.ts'
import { componentCommands } from '../../src/shared/componentEditor.ts'
import { layoutCommands } from '../../src/shared/layoutEditor.ts'

/** Ported from the hosted `componentEditor.test.ts` and `layoutEditor.test.ts`: the component and layout quick actions and what they offer, over the model's files. */

const n = (id: string, type: string, props: ModelNode['props'] = {}, children: ModelNode[] = []): ModelNode => ({ id, type, props, ...(children.length ? { children } : {}) })
const component = (id: string, name: string, root: ModelNode) => ({ id, name, properties: [], variants: [], root }) as unknown as ComponentFile
const layout = (id: string, name: string) => ({ id, name, root: n(`${id}_root`, 'Page'), slots: [], variables: [] }) as unknown as LayoutFile

/** Card nests a Buttons/Primary; Buttons/Ghost stands alone. */
const model = (): Model => ({
  modules: {
    app: {
      components: [
        component('cmp_btn', 'Buttons/Primary', n('b', 'Button')),
        component('cmp_card', 'Card', n('c', 'Card', {}, [n('ci', 'Instance', { component: 'cmp_btn' })])),
        component('cmp_ghost', 'Buttons/Ghost', n('g', 'Button'))
      ],
      pages: []
    }
  },
  layouts: [layout('main', 'Main'), layout('blank', 'Blank')]
}) as unknown as Model

const ctx = (mode: 'build' | 'data' = 'build') => ({ editor: { mode, page: { id: 'p', root: n('r', 'Page') } } }) as unknown as CommandContext

describe('insertableComponents', () => {
  it('offers every component on a page', () => {
    expect(insertableComponents(model(), null).map(c => c.id)).toEqual(['cmp_btn', 'cmp_card', 'cmp_ghost'])
  })

  it('leaves out, in a component view, that component and the ones that use it (a cycle)', () => {
    expect(insertableComponents(model(), 'cmp_btn').map(c => c.id)).toEqual(['cmp_ghost'])
    expect(insertableComponents(model(), 'cmp_card').map(c => c.id)).toEqual(['cmp_btn', 'cmp_ghost'])
  })
})

describe('componentCommands', () => {
  it('inserts and opens components, and creates one from the selection', () => {
    const actions = { insert: vi.fn(), edit: vi.fn(), create: vi.fn() }
    const commands = componentCommands(model(), { editingId: 'cmp_card', canCreate: false }, actions)
    const insert = commands.filter(c => c.group === 'insert')
    expect(insert.map(c => c.id)).toEqual(['insert:component:cmp_btn', 'insert:component:cmp_ghost'])
    insert[0]!.run(ctx())
    expect(actions.insert).toHaveBeenCalledWith('cmp_btn')
    expect(insert[0]!.enabled(ctx('data'))).toBe(false)

    const open = commands.filter(c => c.group === 'goto')
    expect(open.map(c => [c.label, c.enabled(ctx())])).toEqual([['Buttons/Primary', true], ['Card', false], ['Buttons/Ghost', true]])
    open[0]!.run(ctx())
    expect(actions.edit).toHaveBeenCalledWith('cmp_btn')

    const create = commands.find(c => c.id === 'component:create')!
    expect(create.enabled(ctx())).toBe(false)
    expect(componentCommands(model(), { editingId: null, canCreate: true }, actions).find(c => c.id === 'component:create')!.enabled(ctx())).toBe(true)
  })

  it('previews the interactions of the component being edited, with ⌘P', () => {
    const actions = { insert: vi.fn(), edit: vi.fn(), create: vi.fn(), previewInteractions: vi.fn() }
    const preview = componentCommands(model(), { editingId: 'cmp_card', canCreate: false }, actions).find(c => c.id === 'component:preview-interactions')!
    expect(preview).toMatchObject({ group: 'actions', label: 'Preview interactions', shortcut: ['meta', 'p'] })
    expect(preview.enabled(ctx())).toBe(true)
    expect(preview.enabled(ctx('data'))).toBe(false)
    preview.run(ctx())
    expect(actions.previewInteractions).toHaveBeenCalledWith('cmp_card')
    expect(componentCommands(model(), { editingId: null, canCreate: false }, actions).find(c => c.id === 'component:preview-interactions')).toBeUndefined()
  })
})

describe('layoutSelection', () => {
  const page = (extra: Partial<PageFile> = {}) => ({ id: 'p', name: 'Home', path: '/', root: n('root', 'Page', {}, [n('nav', 'Row', {}, [n('logo', 'Text')]), n('body', 'Text'), n('foot', 'Container')]), ...extra }) as unknown as PageFile

  it('takes top-level layers of a page without a layout, in page order', () => {
    expect(layoutSelection(page(), ['foot', 'nav'])).toEqual({ nodeIds: ['nav', 'foot'] })
  })

  it('says why the selection cannot become a layout', () => {
    expect(layoutSelection(page(), [])).toEqual({ reason: 'Select the layers to share, such as a nav and a footer' })
    expect(layoutSelection(page(), ['root'])).toEqual({ reason: 'Select top-level layers of the page' })
    expect(layoutSelection(page(), ['nav', 'logo'])).toEqual({ reason: 'Select top-level layers of the page' })
    expect(layoutSelection(page({ layout: 'main' }), ['nav'])).toEqual({ reason: 'The page already has a layout' })
  })
})

describe('layoutCommands', () => {
  const actions = () => ({ create: vi.fn(), createFromSelection: vi.fn(), edit: vi.fn(), setPageLayout: vi.fn() })

  it('creates a layout, from the selection when it can, and opens each layout', () => {
    const a = actions()
    const commands = layoutCommands(model(), { editingId: 'blank', pageLayoutId: 'main', fromSelection: false }, a)
    expect(commands.find(c => c.id === 'layout:new')!.label).toBe('New layout')
    commands.find(c => c.id === 'layout:new')!.run(ctx())
    expect(a.create).toHaveBeenCalled()
    const fromSelection = commands.find(c => c.id === 'layout:from-selection')!
    expect([fromSelection.label, fromSelection.enabled(ctx())]).toEqual(['Create layout from selection', false])
    expect(layoutCommands(model(), { editingId: null, pageLayoutId: undefined, fromSelection: true }, a).find(c => c.id === 'layout:from-selection')!.enabled(ctx())).toBe(true)

    const edit = commands.filter(c => c.id.startsWith('layout:edit:'))
    expect(edit.map(c => [c.label, c.enabled(ctx())])).toEqual([['Edit layout Main', true], ['Edit layout Blank', false]])
    edit[0]!.run(ctx())
    expect(a.edit).toHaveBeenCalledWith('main')
  })

  it('sets the page layout, the current one disabled', () => {
    const a = actions()
    const set = layoutCommands(model(), { editingId: null, pageLayoutId: 'main', fromSelection: false }, a).filter(c => c.id.startsWith('layout:set:'))
    expect(set.map(c => [c.label, c.enabled(ctx())])).toEqual([['Set page layout › None', true], ['Set page layout › Main', false], ['Set page layout › Blank', true]])
    expect(set[1]!.enabled(ctx('data'))).toBe(false)
    set[0]!.run(ctx())
    set[2]!.run(ctx())
    expect(a.setPageLayout.mock.calls).toEqual([[null], ['blank']])
  })
})
