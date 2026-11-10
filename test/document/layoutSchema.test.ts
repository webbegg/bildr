import { describe, expect, it } from 'vitest'
import { LayoutSchema, PageSchema, ProjectSchema } from '#shared/document/schema'
import type { ComponentDefinition, DocNode, Layout } from '#shared/document/schema'
import { createProject } from '#shared/document/factory'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })

/** A layout with a header (title variable), a main `children` slot and a footer slot with default content. */
function main(overrides: Partial<Layout> = {}): Layout {
  return {
    id: 'main',
    name: 'Main',
    root: n('l-root', 'Page', {}, [
      n('l-title', 'Heading', { text: '{{ layout.Title }}' }),
      n('l-main', 'Container'),
      n('l-foot', 'Container', {}, [n('l-copy', 'Text', { text: '© bildr' })])
    ]),
    slots: [
      { id: 'children', name: 'Content', nodeId: 'l-main' },
      { id: 'footer', name: 'Footer', nodeId: 'l-foot' }
    ],
    variables: [
      { id: 'title', name: 'Title', kind: 'text', default: 'Site', bindings: [] },
      { id: 'count', name: 'Count', kind: 'number', bindings: [] }
    ],
    ...overrides
  }
}

function withLayout(layouts: Layout[], page: { layoutId?: string, layoutValues?: Record<string, string | number | boolean>, children?: DocNode[] } = {}) {
  const project = createProject('P')
  project.layouts = layouts
  const home = project.pages[0]!
  if (page.layoutId !== undefined) home.layoutId = page.layoutId
  if (page.layoutValues) home.layoutValues = page.layoutValues
  home.root.children = page.children ?? []
  return project
}

function problems(project: unknown): string[] {
  const result = ProjectSchema.safeParse(project)
  return result.success ? [] : result.error.issues.map(i => i.message)
}

const expectProblem = (project: unknown, fragment: string) =>
  expect(problems(project).some(p => p.includes(fragment)), `${fragment} in ${JSON.stringify(problems(project))}`).toBe(true)

describe('layouts: schema', () => {
  it('parses a project saved before layouts existed', () => {
    const { layouts: _layouts, ...legacy } = createProject('Old')
    expect(ProjectSchema.parse(legacy).layouts).toEqual([])
  })

  it('leaves a page without a layout as it was', () => {
    const project = createProject('P')
    const page = project.pages[0]!
    expect(PageSchema.parse(page)).toEqual(page)
    expect(ProjectSchema.parse(project).pages[0]).toEqual(page)
  })

  it('defaults slots and variables to empty lists', () => {
    const parsed = LayoutSchema.parse({ id: 'x', name: 'X', root: n('r', 'Page') })
    expect(parsed.slots).toEqual([])
    expect(parsed.variables).toEqual([])
  })

  it('accepts a page that uses a layout with values and slot content', () => {
    const project = withLayout([main()], {
      layoutId: 'main',
      layoutValues: { title: 'Home', count: 3 },
      children: [n('h', 'Heading', { text: 'Hi' }), n('f', 'SlotFill', { slot: 'footer' }, [n('ft', 'Text', { text: 'Own footer' })])]
    })
    expect(problems(project)).toEqual([])
    const parsed = ProjectSchema.parse(project)
    expect(parsed.layouts).toEqual([main()])
    expect(parsed.pages[0]!.layoutId).toBe('main')
    expect(parsed.pages[0]!.layoutValues).toEqual({ title: 'Home', count: 3 })
  })
})

describe('layouts: validation', () => {
  it('refuses an unknown layout id', () => {
    expectProblem(withLayout([main()], { layoutId: 'nope' }), 'Page "Home" uses the unknown layout "nope"')
  })

  it('refuses slot content for a slot the layout does not have', () => {
    expectProblem(withLayout([main()], { layoutId: 'main', children: [n('f', 'SlotFill', { slot: 'aside' })] }), 'Layout "Main" has no slot "aside"')
  })

  it('refuses a SlotFill for the children slot, which takes the page content', () => {
    expectProblem(withLayout([main()], { layoutId: 'main', children: [n('f', 'SlotFill', { slot: 'children' })] }), 'The children slot of layout "Main" takes the page content')
  })

  it('refuses a slot filled twice', () => {
    const fills = [n('f1', 'SlotFill', { slot: 'footer' }), n('f2', 'SlotFill', { slot: 'footer' })]
    expectProblem(withLayout([main()], { layoutId: 'main', children: fills }), 'Slot "footer" of page "Home" is filled more than once')
  })

  it('refuses slot content on a page without a layout', () => {
    expectProblem(withLayout([main()], { children: [n('f', 'SlotFill', { slot: 'footer' })] }), 'SlotFill "f" must be directly under an Instance')
  })

  it('refuses SlotFills deeper than the page root', () => {
    expectProblem(withLayout([main()], { layoutId: 'main', children: [n('c', 'Container', {}, [n('f', 'SlotFill', { slot: 'footer' })])] }), 'SlotFill "f" must be directly under an Instance')
  })

  it('type-checks layout variable values', () => {
    expectProblem(withLayout([main()], { layoutId: 'main', layoutValues: { count: 'many' } }), 'Page "Home": "count" must be a number')
    expectProblem(withLayout([main()], { layoutId: 'main', layoutValues: { title: 4 } }), 'Page "Home": "title" must be a string')
  })

  it('refuses values for unknown variables and values without a layout', () => {
    expectProblem(withLayout([main()], { layoutId: 'main', layoutValues: { nope: 'x' } }), 'Layout "Main" has no variable "nope"')
    expectProblem(withLayout([main()], { layoutValues: { title: 'x' } }), 'Page "Home" has layout values but no layout')
  })

  it('needs exactly one children slot', () => {
    const none = main({ slots: [{ id: 'footer', name: 'Footer', nodeId: 'l-foot' }] })
    expectProblem(withLayout([none]), 'Layout "Main" must have exactly one children slot')
    const two = main({ slots: [{ id: 'children', name: 'A', nodeId: 'l-main' }, { id: 'children', name: 'B', nodeId: 'l-foot' }] })
    expectProblem(withLayout([two]), 'Layout "Main" must have exactly one children slot')
  })

  it('refuses duplicate slot ids and slots bound to missing or non-container nodes', () => {
    const dup = main({ slots: [...main().slots, { id: 'footer', name: 'Again', nodeId: 'l-main' }] })
    expectProblem(withLayout([dup]), 'Duplicate slot id "footer" in "Main"')
    expectProblem(withLayout([main({ slots: [...main().slots, { id: 'side', name: 'Side', nodeId: 'gone' }] })]), 'Slot "Side" is bound to the missing node "gone"')
    expectProblem(withLayout([main({ slots: [...main().slots, { id: 'side', name: 'Side', nodeId: 'l-title' }] })]), 'Slot "Side" must bind a container node, not "Heading"')
  })

  it('checks variables like component properties', () => {
    const slotVar = main({ variables: [{ id: 'v', name: 'V', kind: 'slot', bindings: [] }] })
    expectProblem(withLayout([slotVar]), 'Variable "V" of layout "Main" cannot be a slot')
    const badDefault = main({ variables: [{ id: 'v', name: 'V', kind: 'number', default: 'x', bindings: [] }] })
    expectProblem(withLayout([badDefault]), '"v" must be a number')
    const badBinding = main({ variables: [{ id: 'v', name: 'V', kind: 'text', bindings: [{ nodeId: 'gone', prop: 'text' }] }] })
    expectProblem(withLayout([badBinding]), 'Variable "V" is bound to the missing node "gone"')
    const dup = main({ variables: [...main().variables, { id: 'title', name: 'Again', kind: 'text', bindings: [] }] })
    expectProblem(withLayout([dup]), 'Duplicate variable id "title" in "Main"')
  })

  it('checks the layout tree: a Page root, known types, component instances', () => {
    expectProblem(withLayout([main({ root: n('l-root', 'Container', {}, [n('l-main', 'Container')]), slots: [{ id: 'children', name: 'C', nodeId: 'l-main' }] })]), 'Layout root must be a Page node')
    const unknown = main()
    unknown.root.children.push(n('i', 'Instance', { component: 'ghost' }))
    expectProblem(withLayout([unknown]), 'Instance "i" uses the unknown component "ghost"')
  })

  it('accepts component instances in the layout tree', () => {
    const nav: ComponentDefinition = { id: 'nav', name: 'Nav', root: n('nr', 'Container'), properties: [], variants: [] }
    const layout = main()
    layout.root.children.unshift(n('i', 'Instance', { component: 'nav' }))
    const project = withLayout([layout], { layoutId: 'main' })
    project.components = [nav]
    expect(problems(project)).toEqual([])
  })

  it('keeps layout node ids in their own namespace', () => {
    const project = withLayout([main()], { layoutId: 'main', children: [n('l-title', 'Heading', { text: 'Same id as the layout node' })] })
    expect(problems(project)).toEqual([])
  })

  it('refuses duplicate layout ids', () => {
    expectProblem(withLayout([main(), main()]), 'Duplicate layout id "main"')
  })
})
