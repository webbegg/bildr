import { describe, expect, it, vi } from 'vitest'
import { createProject } from '#shared/document/factory'
import type { DocNode, Layout, Project } from '#shared/document/schema'
import type { CommandContext } from '#shared/editor/commands'
import {
  childrenSlotNode,
  layoutChoiceHint,
  layoutCommands,
  layoutDeleteConfirm,
  layoutSelection,
  layoutEntries,
  layoutItems,
  layoutPages,
  layoutValue,
  NO_LAYOUT,
  pageSlots,
  slotOf,
  variableAddItems,
  variableField
} from '../../app/composables/layoutEditor'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = []): DocNode => ({ id, type, props, style: {}, children })

function main(): Layout {
  return {
    id: 'main',
    name: 'Main',
    root: n('l-root', 'Page', {}, [n('l-title', 'Heading', { text: 'Site', level: '1' }), n('l-main', 'Container'), n('l-foot', 'Container')]),
    slots: [{ id: 'children', name: 'Content', nodeId: 'l-main' }, { id: 'footer', name: 'Footer', nodeId: 'l-foot' }],
    variables: [{ id: 'title', name: 'Title', kind: 'text', bindings: [{ nodeId: 'l-title', prop: 'text' }] }]
  }
}

/** Home and Pricing use "main"; About uses none; "blank" is unused. */
function project(): Project {
  const p = createProject('Demo')
  p.layouts = [main(), { ...main(), id: 'blank', name: 'Blank', variables: [] }]
  p.pages[0]!.layoutId = 'main'
  p.pages[0]!.root.children = [n('fill', 'SlotFill', { slot: 'footer' })]
  p.pages.push({ id: 'about', name: 'About', slug: 'about', root: n('r2', 'Page') })
  p.pages.push({ id: 'pricing', name: 'Pricing', slug: 'pricing', root: n('r3', 'Page'), layoutId: 'main', layoutValues: { title: 'Plans' } })
  return p
}

describe('layoutEntries and layoutPages', () => {
  it('lists layouts matching the search with the pages that use each', () => {
    const entries = layoutEntries(project(), '')
    expect(entries.map(e => [e.layout.id, e.pages.map(p => p.name)])).toEqual([['main', ['Home', 'Pricing']], ['blank', []]])
    expect(layoutEntries(project(), 'bla').map(e => e.layout.id)).toEqual(['blank'])
    expect(layoutPages(project(), 'blank')).toEqual([])
  })
})

describe('layoutDeleteConfirm', () => {
  it('names the pages that will detach', () => {
    const p = project()
    expect(layoutDeleteConfirm(p.layouts[0]!, layoutPages(p, 'main'))).toEqual({
      title: 'Delete "Main"?',
      description: 'Used by 2 pages. They keep their content and lose the layout; undo brings it back.',
      items: ['Home', 'Pricing'],
      confirmLabel: 'Delete layout',
      danger: true
    })
    expect(layoutDeleteConfirm(p.layouts[1]!, [])).toEqual({ title: 'Delete "Blank"?', description: 'No page uses it. Undo brings it back.', items: [], confirmLabel: 'Delete layout', danger: true })
  })
})

describe('layoutItems', () => {
  it('offers None first, then every layout with the number of pages using it', () => {
    expect(layoutItems(project())).toEqual([{ label: 'None', value: NO_LAYOUT }, { label: 'Main', value: 'main', pages: 2 }, { label: 'Blank', value: 'blank', pages: 0 }])
  })
})

describe('layoutChoiceHint', () => {
  it('counts the pages, then what a page can set in the layout', () => {
    const p = project()
    expect(layoutChoiceHint(p.layouts[0]!, 2)).toBe('2 pages · 1 slot, 1 variable')
    expect(layoutChoiceHint(p.layouts[1]!, 0)).toBe('No pages · 1 slot')
    expect(layoutChoiceHint({ ...main(), slots: [main().slots[0]!], variables: [] }, 1)).toBe('1 page · No slots or variables')
  })
})

describe('childrenSlotNode', () => {
  it('finds the node of the children slot, where the page content shows', () => {
    expect(childrenSlotNode(main())).toBe('l-main')
    expect(childrenSlotNode({ ...main(), slots: [] })).toBeNull()
    expect(childrenSlotNode(null)).toBeNull()
  })
})

describe('layoutSelection', () => {
  const page = () => ({ id: 'p', name: 'Home', slug: 'home', root: n('root', 'Page', {}, [n('nav', 'Row', {}, [n('logo', 'Text')]), n('body', 'Text'), n('foot', 'Container')]) })

  it('takes top-level layers of a page without a layout, in page order', () => {
    expect(layoutSelection(page(), ['foot', 'nav'])).toEqual({ nodeIds: ['nav', 'foot'] })
  })

  it('says why the selection cannot become a layout', () => {
    expect(layoutSelection(page(), [])).toEqual({ reason: 'Select the layers to share, such as a nav and a footer' })
    expect(layoutSelection(page(), ['root'])).toEqual({ reason: 'Select top-level layers of the page' })
    expect(layoutSelection(page(), ['nav', 'logo'])).toEqual({ reason: 'Select top-level layers of the page' })
    expect(layoutSelection({ ...page(), layoutId: 'main' }, ['nav'])).toEqual({ reason: 'The page already has a layout' })
  })
})

describe('layoutCommands', () => {
  const ctx = (mode: 'build' | 'data' = 'build') => ({ editor: { mode, page: { id: 'p', root: n('r', 'Page') } } }) as unknown as CommandContext
  const actions = () => ({ create: vi.fn(), createFromSelection: vi.fn(), edit: vi.fn(), setPageLayout: vi.fn() })

  it('creates a layout, from the selection when it can, and opens each layout', () => {
    const a = actions()
    const commands = layoutCommands(project(), { editingId: 'blank', pageLayoutId: 'main', fromSelection: false }, a)
    expect(commands.find(c => c.id === 'layout:new')!.label).toBe('New layout')
    commands.find(c => c.id === 'layout:new')!.run(ctx())
    expect(a.create).toHaveBeenCalled()
    const fromSelection = commands.find(c => c.id === 'layout:from-selection')!
    expect([fromSelection.label, fromSelection.enabled(ctx())]).toEqual(['Create layout from selection', false])
    expect(layoutCommands(project(), { editingId: null, pageLayoutId: undefined, fromSelection: true }, a).find(c => c.id === 'layout:from-selection')!.enabled(ctx())).toBe(true)

    const edit = commands.filter(c => c.id.startsWith('layout:edit:'))
    expect(edit.map(c => [c.label, c.enabled(ctx())])).toEqual([['Edit layout Main', true], ['Edit layout Blank', false]])
    edit[0]!.run(ctx())
    expect(a.edit).toHaveBeenCalledWith('main')
  })

  it('sets the page layout, the current one disabled', () => {
    const a = actions()
    const set = layoutCommands(project(), { editingId: null, pageLayoutId: 'main', fromSelection: false }, a).filter(c => c.id.startsWith('layout:set:'))
    expect(set.map(c => [c.label, c.enabled(ctx())])).toEqual([['Set page layout › None', true], ['Set page layout › Main', false], ['Set page layout › Blank', true]])
    expect(set[1]!.enabled(ctx('data'))).toBe(false)
    set[0]!.run(ctx())
    set[2]!.run(ctx())
    expect(a.setPageLayout.mock.calls).toEqual([[null], ['blank']])
  })
})

describe('variableField and layoutValue', () => {
  it('turns a variable into a prop field keyed by its id, defaulting to the bound prop', () => {
    const layout = main()
    expect(variableField(layout, layout.variables[0]!)).toMatchObject({ name: 'title', label: 'Title', kind: 'text', default: 'Site' })
    const p = project()
    expect(layoutValue(p.pages[2]!, layout.variables[0]!)).toBe('Plans')
    expect(layoutValue(p.pages[0]!, layout.variables[0]!)).toBeUndefined()
  })
})

describe('slotOf, pageSlots and variableAddItems', () => {
  it('finds the slot bound to a node', () => {
    expect(slotOf(main(), 'l-main')?.id).toBe('children')
    expect(slotOf(main(), 'l-title')).toBeUndefined()
  })

  it('lists the named slots of a page layout and whether the page fills each', () => {
    const p = project()
    expect(pageSlots(main(), p.pages[0]!)).toEqual([{ slot: main().slots[1], filled: true }])
    expect(pageSlots(main(), p.pages[2]!)).toEqual([{ slot: main().slots[1], filled: false }])
  })

  it('offers the node props as variables, disabling the bound ones', () => {
    const items = variableAddItems(main(), main().root.children[0]!)
    expect(items.find(i => i.id === 'text')).toMatchObject({ disabled: true, hint: 'Already a variable' })
    expect(items.find(i => i.id === 'level')).toMatchObject({ disabled: false })
    expect(variableAddItems(main(), n('x', 'Instance', { component: 'c' }))).toEqual([])
  })

  it('does not count a style binding as a bound prop of the same name', () => {
    const layout = main()
    layout.variables = [{ id: 'size', name: 'Size', kind: 'select', bindings: [{ nodeId: 'l-title', prop: 'text', target: 'style' }] }]
    expect(variableAddItems(layout, layout.root.children[0]!).find(i => i.id === 'text')).toMatchObject({ disabled: false })
  })
})

describe('variableField with a style binding', () => {
  it('defaults to the bound style key of the layout node', () => {
    const layout = main()
    layout.root.children[0]!.style = { bg: 'muted' }
    const variable = { id: 'bar', name: 'Bar', kind: 'select' as const, bindings: [{ nodeId: 'l-title', prop: 'bg', target: 'style' as const }] }
    expect(variableField(layout, variable)).toMatchObject({ name: 'bar', kind: 'select', default: 'muted' })
  })
})
