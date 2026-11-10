import { describe, expect, it } from 'vitest'
import { applyOperation, applyOperations, OperationError } from '#shared/document/operations'
import type { Operation } from '#shared/document/operations'
import { createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'
import type { DocNode, Layout, Project } from '#shared/document/schema'
import { componentUsages } from '#shared/document/usages'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = []): DocNode => ({ id, type, props, style: {}, children })

/** A header (title variable bound to its text), a `children` slot and a footer slot with default content. */
function main(): Layout {
  return {
    id: 'main',
    name: 'Main',
    root: n('l-root', 'Page', {}, [
      n('l-title', 'Heading', { text: 'Site' }),
      n('l-main', 'Container'),
      n('l-foot', 'Container', {}, [n('l-copy', 'Text')])
    ]),
    slots: [{ id: 'children', name: 'Content', nodeId: 'l-main' }, { id: 'footer', name: 'Footer', nodeId: 'l-foot' }],
    variables: [{ id: 'title', name: 'Title', kind: 'text', default: 'Site', bindings: [{ nodeId: 'l-title', prop: 'text' }] }]
  }
}

/** Home uses "main" with a title value and its own footer; About has no layout. */
function setup(): Project {
  const project = createProject('L')
  project.layouts = [main()]
  const home = project.pages[0]!
  home.layoutId = 'main'
  home.layoutValues = { title: 'Home' }
  home.root.children = [n('h1', 'Heading'), n('fill', 'SlotFill', { slot: 'footer' }, [n('f1', 'Text')])]
  project.pages.push({ id: 'about', name: 'About', slug: 'about', root: n('r2', 'Page') })
  return ProjectSchema.parse(project)
}

/** Applies `op`, checks the result parses, then applies the inverse and expects the original back. */
function roundTrip(project: Project, op: Operation): Project {
  const before = structuredClone(project)
  const inverse = applyOperation(project, op)
  expect(ProjectSchema.safeParse(project).success).toBe(true)
  const after = structuredClone(project)
  applyOperation(project, inverse)
  expect(project).toEqual(before)
  return after
}

describe('layout operations', () => {
  it('adds, renames and removes an unused layout with inverses', () => {
    const project = setup()
    const other = { ...main(), id: 'blank', name: 'Blank' }
    expect(roundTrip(project, { op: 'addLayout', index: 0, layout: other }).layouts.map(l => l.id)).toEqual(['blank', 'main'])
    applyOperation(project, { op: 'addLayout', index: 9, layout: other })
    expect(roundTrip(project, { op: 'removeLayout', layoutId: 'blank' }).layouts.map(l => l.id)).toEqual(['main'])
    expect(roundTrip(project, { op: 'updateLayout', layoutId: 'main', name: 'Site' }).layouts[0]!.name).toBe('Site')
    expect(() => applyOperation(project, { op: 'updateLayout', layoutId: 'main', name: ' ' })).toThrow('Layout name cannot be empty')
  })

  it('refuses an invalid layout, a duplicate and one without a children slot', () => {
    const project = setup()
    expect(() => applyOperation(project, { op: 'addLayout', index: 0, layout: main() })).toThrow('Duplicate layout id "main"')
    expect(() => applyOperation(project, { op: 'addLayout', index: 0, layout: { ...main(), id: 'x', slots: [] } })).toThrow('must have exactly one children slot')
    expect(project.layouts).toHaveLength(1)
  })

  it('refuses to remove a layout pages use, naming them', () => {
    const project = setup()
    expect(() => applyOperation(project, { op: 'removeLayout', layoutId: 'main' })).toThrow(OperationError)
    expect(() => applyOperation(project, { op: 'removeLayout', layoutId: 'main' })).toThrow('"Main" is used by 1 page: Home')
  })

  it('adds, updates and removes slots', () => {
    const project = setup()
    project.layouts[0]!.root.children.push(n('l-side', 'Container'))
    const added = roundTrip(project, { op: 'addLayoutSlot', layoutId: 'main', index: 9, slot: { id: 'side', name: 'Side', nodeId: 'l-side' } })
    expect(added.layouts[0]!.slots.map(s => s.id)).toEqual(['children', 'footer', 'side'])
    applyOperation(project, { op: 'addLayoutSlot', layoutId: 'main', index: 9, slot: { id: 'side', name: 'Side', nodeId: 'l-side' } })
    expect(roundTrip(project, { op: 'updateLayoutSlot', layoutId: 'main', slotId: 'side', name: 'Aside' }).layouts[0]!.slots[2]!.name).toBe('Aside')
    expect(roundTrip(project, { op: 'removeLayoutSlot', layoutId: 'main', slotId: 'side' }).layouts[0]!.slots).toHaveLength(2)
  })

  it('refuses a second children slot, removing it, and slots pages still fill', () => {
    const project = setup()
    expect(() => applyOperation(project, { op: 'addLayoutSlot', layoutId: 'main', index: 0, slot: { id: 'children', name: 'X', nodeId: 'l-title' } })).toThrow('exactly one children slot')
    expect(() => applyOperation(project, { op: 'removeLayoutSlot', layoutId: 'main', slotId: 'children' })).toThrow('The children slot cannot be removed')
    expect(() => applyOperation(project, { op: 'removeLayoutSlot', layoutId: 'main', slotId: 'footer' })).toThrow('Layout "Main" has no slot "footer"')
    expect(project.layouts[0]!.slots).toHaveLength(2)
  })

  it('adds, updates and removes variables, checked like component properties', () => {
    const project = setup()
    const variable = { id: 'count', name: 'Count', kind: 'number' as const, bindings: [] }
    expect(roundTrip(project, { op: 'addLayoutVariable', layoutId: 'main', index: 9, variable }).layouts[0]!.variables.map(v => v.id)).toEqual(['title', 'count'])
    expect(roundTrip(project, { op: 'updateLayoutVariable', layoutId: 'main', variableId: 'title', name: 'Heading', default: null }).layouts[0]!.variables[0]).toMatchObject({ name: 'Heading' })
    expect(() => applyOperation(project, { op: 'addLayoutVariable', layoutId: 'main', index: 0, variable: { ...variable, kind: 'slot' } })).toThrow('cannot be a slot')
    expect(() => applyOperation(project, { op: 'updateLayoutVariable', layoutId: 'main', variableId: 'title', default: 3 })).toThrow('must be a string')
    expect(() => applyOperation(project, { op: 'removeLayoutVariable', layoutId: 'main', variableId: 'title' })).toThrow('has no variable "title"')
    delete project.pages[0]!.layoutValues
    expect(roundTrip(project, { op: 'removeLayoutVariable', layoutId: 'main', variableId: 'title' }).layouts[0]!.variables).toEqual([])
  })

  it('sets a page layout and its values exactly, and undoes it', () => {
    const project = setup()
    const attached = roundTrip(project, { op: 'setPageLayout', pageId: 'about', layoutId: 'main', layoutValues: { title: 'About' } })
    expect(attached.pages[1]).toMatchObject({ layoutId: 'main', layoutValues: { title: 'About' } })
    const values = roundTrip(project, { op: 'setLayoutValues', pageId: project.pages[0]!.id, values: { title: 'Welcome' } })
    expect(values.pages[0]!.layoutValues).toEqual({ title: 'Welcome' })
    const cleared = roundTrip(project, { op: 'setLayoutValues', pageId: project.pages[0]!.id, values: { title: null } })
    expect(cleared.pages[0]!.layoutValues).toBeUndefined()
  })

  it('refuses unknown layouts and values that do not fit', () => {
    const project = setup()
    const homeId = project.pages[0]!.id
    expect(() => applyOperation(project, { op: 'setPageLayout', pageId: 'about', layoutId: 'nope' })).toThrow('uses the unknown layout "nope"')
    expect(() => applyOperation(project, { op: 'setLayoutValues', pageId: homeId, values: { title: 4 } })).toThrow('must be a string')
    expect(() => applyOperation(project, { op: 'setLayoutValues', pageId: homeId, values: { nope: 'x' } })).toThrow('has no variable "nope"')
    // Its footer SlotFill needs the layout.
    expect(() => applyOperation(project, { op: 'setPageLayout', pageId: homeId, layoutId: null })).toThrow('SlotFill "fill" must be directly under an Instance')
    expect(project.pages[0]).toMatchObject({ layoutId: 'main', layoutValues: { title: 'Home' } })
  })

  it('edits the layout tree with layoutId node operations, in its own id namespace', () => {
    const project = setup()
    // "h1" is a page id; layout ids are their own namespace.
    const after = roundTrip(project, { op: 'insert', layoutId: 'main', parentId: 'l-root', index: 0, node: n('h1', 'Text') })
    expect(after.layouts[0]!.root.children[0]!.id).toBe('h1')
    roundTrip(project, { op: 'setProps', layoutId: 'main', nodeId: 'l-copy', props: { text: '©' } })
    roundTrip(project, { op: 'move', layoutId: 'main', nodeId: 'l-copy', parentId: 'l-root', index: 0 })
    expect(() => applyOperation(project, { op: 'remove', layoutId: 'main', nodeId: 'l-root' })).toThrow('The layout root cannot be removed')
    expect(() => applyOperation(project, { op: 'remove', layoutId: 'main', nodeId: 'l-main' })).toThrow('bound to the missing node "l-main"')
    expect(() => applyOperation(project, { op: 'remove', layoutId: 'nope', nodeId: 'x' })).toThrow('Layout "nope" not found')
  })

  it('applies the delete-layout steps as one all-or-nothing batch that undo restores exactly', () => {
    const project = setup()
    const before = structuredClone(project)
    const homeId = project.pages[0]!.id
    const inverses = applyOperations(project, [
      { op: 'remove', pageId: homeId, nodeId: 'fill' },
      { op: 'setPageLayout', pageId: homeId, layoutId: null },
      { op: 'removeLayout', layoutId: 'main' }
    ])
    expect(ProjectSchema.safeParse(project).success).toBe(true)
    expect(project.pages[0]!.layoutId).toBeUndefined()
    expect(project.pages[0]!.layoutValues).toBeUndefined()
    applyOperations(project, inverses)
    expect(project).toEqual(before)
  })
})

describe('layout validation', () => {
  it('refuses a slot nested inside another slot\'s node', () => {
    const project = setup()
    project.layouts[0]!.root.children[1]!.children.push(n('l-inner', 'Container'))
    expect(() => applyOperation(project, { op: 'addLayoutSlot', layoutId: 'main', index: 9, slot: { id: 'inner', name: 'Inner', nodeId: 'l-inner' } }))
      .toThrow('Slot "Inner" of "Main" is inside slot "Content"')
  })

  it('refuses two slots bound to the same node', () => {
    const project = setup()
    expect(() => applyOperation(project, { op: 'addLayoutSlot', layoutId: 'main', index: 9, slot: { id: 'again', name: 'Again', nodeId: 'l-foot' } }))
      .toThrow('Slots "Footer" and "Again" of "Main" are bound to the same node "l-foot"')
  })
})

describe('component usages in layouts', () => {
  it('lists instances inside layouts and refuses removing their component', () => {
    const project = setup()
    project.components = [{ id: 'nav', name: 'Nav', root: n('c-root', 'Row'), properties: [], variants: [] }]
    project.layouts[0]!.root.children.unshift(n('l-nav', 'Instance', { component: 'nav' }))
    expect(componentUsages(project, 'nav')).toEqual([{ layoutId: 'main', nodeId: 'l-nav', where: 'layout "Main"' }])
    expect(() => applyOperation(project, { op: 'removeComponent', componentId: 'nav' })).toThrow('"Nav" is used by 1 instance: layout "Main" (l-nav)')
  })

  it('refuses a component edit that breaks an instance inside a layout', () => {
    const project = setup()
    project.components = [{ id: 'nav', name: 'Nav', root: n('c-root', 'Heading'), properties: [{ id: 'label', name: 'Label', kind: 'text', bindings: [{ nodeId: 'c-root', prop: 'text' }] }], variants: [] }]
    project.layouts[0]!.root.children.unshift(n('l-nav', 'Instance', { component: 'nav', label: 'Hi' }))
    expect(() => applyOperation(project, { op: 'removeProperty', componentId: 'nav', propertyId: 'label' })).toThrow('"Nav" has no property "label"')
  })
})
