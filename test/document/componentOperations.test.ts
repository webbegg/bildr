import { describe, expect, it } from 'vitest'
import { applyOperation, applyOperations, OperationError } from '#shared/document/operations'
import type { Operation } from '#shared/document/operations'
import { createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'
import type { ComponentDefinition, DocNode, Project } from '#shared/document/schema'
import { componentUsages } from '#shared/document/usages'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })

function card(): ComponentDefinition {
  return {
    id: 'card',
    name: 'Card',
    root: n('c-root', 'Card', {}, [n('c-title', 'Heading', { text: 'T', level: '2' }), n('c-body', 'Container')]),
    properties: [
      { id: 'title', name: 'Title', kind: 'text', default: 'Hi', bindings: [{ nodeId: 'c-title', prop: 'text' }] },
      { id: 'body', name: 'Body', kind: 'slot', bindings: [{ nodeId: 'c-body', prop: 'children' }] }
    ],
    variants: [{ id: 'dark', name: 'Dark', overrides: {} }]
  }
}

function setup(pageChildren: DocNode[] = []): { project: Project, pageId: string } {
  const project = createProject('Demo')
  project.components = [card()]
  project.pages[0]!.root.children = pageChildren
  return { project, pageId: project.pages[0]!.id }
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

describe('component definition operations', () => {
  it('adds a component and its inverse removes it', () => {
    const { project } = setup()
    const def = { ...card(), id: 'other', name: 'Other' }
    const after = roundTrip(project, { op: 'addComponent', index: 0, component: def })
    expect(after.components.map(c => c.id)).toEqual(['other', 'card'])
  })

  it('refuses an invalid or duplicate component', () => {
    const { project } = setup()
    expect(() => applyOperation(project, { op: 'addComponent', index: 0, component: card() })).toThrow('Duplicate component id "card"')
    const broken = { ...card(), id: 'x', properties: [{ id: 'p', name: 'P', kind: 'text' as const, bindings: [{ nodeId: 'missing', prop: 'text' }] }] }
    expect(() => applyOperation(project, { op: 'addComponent', index: 0, component: broken })).toThrow('bound to the missing node "missing"')
  })

  it('removes an unused component and restores it at its index', () => {
    const { project } = setup()
    project.components.push({ ...card(), id: 'b', name: 'B' })
    const after = roundTrip(project, { op: 'removeComponent', componentId: 'card' })
    expect(after.components.map(c => c.id)).toEqual(['b'])
  })

  it('refuses to remove a component in use and names the usages', () => {
    const { project } = setup([n('i1', 'Instance', { component: 'card' })])
    expect(() => applyOperation(project, { op: 'removeComponent', componentId: 'card' })).toThrow(OperationError)
    expect(() => applyOperation(project, { op: 'removeComponent', componentId: 'card' })).toThrow('"Card" is used by 1 instance: page "Home" (i1)')
  })

  it('renames a component', () => {
    const { project } = setup()
    const after = roundTrip(project, { op: 'updateComponent', componentId: 'card', name: 'Cards/Card' })
    expect(after.components[0]!.name).toBe('Cards/Card')
    expect(() => applyOperation(project, { op: 'updateComponent', componentId: 'card', name: '  ' })).toThrow('Component name cannot be empty')
    expect(() => applyOperation(project, { op: 'updateComponent', componentId: 'nope', name: 'X' })).toThrow('Component "nope" not found')
  })

  it('adds, updates and removes a property with inverses', () => {
    const { project } = setup()
    const property = { id: 'level', name: 'Level', kind: 'select' as const, default: '3', bindings: [{ nodeId: 'c-title', prop: 'level' }] }
    const added = roundTrip(project, { op: 'addProperty', componentId: 'card', index: 99, property })
    expect(added.components[0]!.properties.map(p => p.id)).toEqual(['title', 'body', 'level'])

    const updated = roundTrip(project, { op: 'updateProperty', componentId: 'card', propertyId: 'title', name: 'Heading', default: null })
    expect(updated.components[0]!.properties[0]).toEqual({ id: 'title', name: 'Heading', kind: 'text', bindings: [{ nodeId: 'c-title', prop: 'text' }] })

    const removed = roundTrip(project, { op: 'removeProperty', componentId: 'card', propertyId: 'title' })
    expect(removed.components[0]!.properties.map(p => p.id)).toEqual(['body'])
  })

  it('validates property values against the bound props', () => {
    const { project } = setup()
    const bad = { id: 'level', name: 'Level', kind: 'select' as const, default: '9', bindings: [{ nodeId: 'c-title', prop: 'level' }] }
    expect(() => applyOperation(project, { op: 'addProperty', componentId: 'card', index: 0, property: bad })).toThrow('"level" must be one of 1, 2, 3, 4')
    expect(() => applyOperation(project, { op: 'updateProperty', componentId: 'card', propertyId: 'title', default: 3 })).toThrow('"title" must be a string')
    expect(project.components[0]).toEqual(card())
  })

  it('refuses to remove a property an instance still sets', () => {
    const { project } = setup([n('i1', 'Instance', { component: 'card', title: 'Hello' })])
    expect(() => applyOperation(project, { op: 'removeProperty', componentId: 'card', propertyId: 'title' })).toThrow('"Card" has no property "title"')
    expect(project.components[0]).toEqual(card())
  })

  it('adds and removes a variant', () => {
    const { project } = setup()
    const after = roundTrip(project, { op: 'addVariant', componentId: 'card', index: 99, variant: { id: 'big', name: 'Big', overrides: {} } })
    expect(after.components[0]!.variants.map(v => v.id)).toEqual(['dark', 'big'])
    roundTrip(project, { op: 'removeVariant', componentId: 'card', variantId: 'dark' })
  })

  it('renames a variant, and the inverse restores the old name', () => {
    const { project } = setup()
    const after = roundTrip(project, { op: 'updateVariant', componentId: 'card', variantId: 'dark', name: '  Night ' })
    expect(after.components[0]!.variants[0]).toEqual({ id: 'dark', name: 'Night', overrides: {} })
    expect(() => applyOperation(project, { op: 'updateVariant', componentId: 'card', variantId: 'dark', name: ' ' })).toThrow('Variant name cannot be empty')
    expect(() => applyOperation(project, { op: 'updateVariant', componentId: 'card', variantId: 'nope', name: 'x' })).toThrow('Variant "nope" not found')
    expect(project.components[0]).toEqual(card())
  })

  it('stores only overridden values and drops an override when it is reset', () => {
    const { project } = setup()
    const set = { op: 'setOverride' as const, componentId: 'card', variantId: 'dark', nodeId: 'c-title', props: { text: 'Dark', level: '2' }, style: { color: 'primary' } }
    const after = roundTrip(project, set)
    // level 2 is the primary value, so nothing is stored for it.
    expect(after.components[0]!.variants[0]!.overrides).toEqual({ 'c-title': { props: { text: 'Dark' }, style: { color: 'primary' } } })

    applyOperation(project, set)
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', props: { text: null } })
    expect(project.components[0]!.variants[0]!.overrides).toEqual({ 'c-title': { style: { color: 'primary' } } })
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { color: null } })
    expect(project.components[0]!.variants[0]!.overrides).toEqual({})
  })

  it('refuses overrides that do not fit the node', () => {
    const { project } = setup()
    expect(() => applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', props: { level: '9' } })).toThrow('"level" must be one of')
    expect(() => applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'gone', props: { text: 'x' } })).toThrow('Node "gone" not found')
    expect(() => applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'nope', nodeId: 'c-title', props: { text: 'x' } })).toThrow('Variant "nope" not found')
  })
})

/** A project whose card title sets `color` and `p` in the primary. */
function styled(): Project {
  const { project } = setup()
  project.components[0]!.root.children[0]!.style = { color: 'muted', p: '4' }
  return project
}

describe('removed tokens in a variant (unset)', () => {
  it('the schema accepts the optional unset list of a node override', () => {
    const project = styled()
    project.components[0]!.variants[0]!.overrides = { 'c-title': { unset: ['color'] } }
    expect(ProjectSchema.safeParse(project).success).toBe(true)
  })

  it('the schema rejects a malformed unset list', () => {
    const parse = (override: unknown) => {
      const project = styled() as unknown as { components: { variants: { overrides: Record<string, unknown> }[] }[] }
      project.components[0]!.variants[0]!.overrides = { 'c-title': override }
      const result = ProjectSchema.safeParse(project)
      return result.success ? '' : result.error.issues.map(i => i.message).join('; ')
    }
    expect(parse({ unset: 'color' })).not.toBe('')
    expect(parse({ unset: [3] })).not.toBe('')
    expect(parse({ unset: ['nope'] })).toContain('Unknown style token "nope"')
    expect(parse({ unset: ['xl:p'] })).toContain('Unknown breakpoint "xl"')
    expect(parse({ unset: ['color', 'color'] })).toContain('Variant "Dark" removes "color" twice on "c-title"')
    expect(parse({ style: { color: 'primary' }, unset: ['color'] })).toContain('Variant "Dark" both overrides and removes "color" on "c-title"')
  })

  it('old documents without the marker parse to the same bytes', () => {
    const project = styled()
    project.components[0]!.variants[0]!.overrides = { 'c-title': { props: { text: 'Dark' }, style: { color: 'primary' } } }
    const parsed = ProjectSchema.parse(structuredClone(project))
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(project))
  })

  it('removes a primary token in the variant, and a reset (null) restores the primary', () => {
    const project = styled()
    const after = roundTrip(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', unset: ['color'] })
    expect(after.components[0]!.variants[0]!.overrides).toEqual({ 'c-title': { unset: ['color'] } })

    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { p: '8' }, unset: ['color'] })
    expect(project.components[0]!.variants[0]!.overrides).toEqual({ 'c-title': { style: { p: '8' }, unset: ['color'] } })
    // The inverse of a reset puts the marker back.
    roundTrip(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { color: null } })
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { color: null, p: null } })
    expect(project.components[0]!.variants[0]!.overrides).toEqual({})
  })

  it('a value replaces the marker, and removing replaces an overridden value', () => {
    const project = styled()
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', unset: ['color'] })
    roundTrip(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { color: 'primary' } })
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { color: 'primary' } })
    expect(project.components[0]!.variants[0]!.overrides).toEqual({ 'c-title': { style: { color: 'primary' } } })
    roundTrip(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', unset: ['color'] })
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', unset: ['color'] })
    expect(project.components[0]!.variants[0]!.overrides).toEqual({ 'c-title': { unset: ['color'] } })
  })

  it('stores no marker for a token the primary does not set, and refuses set-and-remove or an unknown key', () => {
    const project = styled()
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { bg: 'muted' } })
    applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', unset: ['bg'] })
    expect(project.components[0]!.variants[0]!.overrides).toEqual({})
    expect(() => applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', style: { color: 'primary' }, unset: ['color'] })).toThrow('"color" cannot be both set and removed')
    expect(() => applyOperation(project, { op: 'setOverride', componentId: 'card', variantId: 'dark', nodeId: 'c-title', unset: ['nope'] })).toThrow('Unknown style token "nope"')
    expect(project.components[0]!.variants[0]!.overrides).toEqual({})
  })
})

describe('node operations in a component definition', () => {
  it('insert, setProps, setStyle, move and remove edit the definition tree with inverses', () => {
    const { project } = setup()
    const componentId = 'card'
    const inserted = roundTrip(project, { op: 'insert', componentId, parentId: 'c-root', index: 99, node: n('c-note', 'Text', { text: 'Note' }) })
    expect(inserted.components[0]!.root.children.map(c => c.id)).toEqual(['c-title', 'c-body', 'c-note'])

    applyOperation(project, { op: 'insert', componentId, parentId: 'c-root', index: 99, node: n('c-note', 'Text', { text: 'Note' }) })
    expect(roundTrip(project, { op: 'setProps', componentId, nodeId: 'c-note', props: { text: 'Edited' } }).components[0]!.root.children[2]!.props.text).toBe('Edited')
    expect(roundTrip(project, { op: 'setStyle', componentId, nodeId: 'c-note', style: { mt: '4' } }).components[0]!.root.children[2]!.style).toEqual({ mt: '4' })
    expect(roundTrip(project, { op: 'move', componentId, nodeId: 'c-note', parentId: 'c-body', index: 0 }).components[0]!.root.children[1]!.children[0]!.id).toBe('c-note')
    expect(roundTrip(project, { op: 'remove', componentId, nodeId: 'c-note' }).components[0]!.root.children).toHaveLength(2)
  })

  it('definition ids are their own namespace: a page id may repeat inside a definition', () => {
    const { project } = setup([n('shared-id', 'Text')])
    roundTrip(project, { op: 'insert', componentId: 'card', parentId: 'c-root', index: 0, node: n('shared-id', 'Text') })
    expect(() => applyOperation(project, { op: 'insert', componentId: 'card', parentId: 'c-root', index: 0, node: n('c-title', 'Text') })).toThrow('Duplicate node id "c-title"')
  })

  it('refuses to remove the definition root, a bound node, or to nest a component in itself', () => {
    const { project } = setup()
    expect(() => applyOperation(project, { op: 'remove', componentId: 'card', nodeId: 'c-root' })).toThrow('The component root cannot be removed')
    expect(() => applyOperation(project, { op: 'remove', componentId: 'card', nodeId: 'c-title' })).toThrow('bound to the missing node "c-title"')
    expect(() => applyOperation(project, { op: 'insert', componentId: 'card', parentId: 'c-root', index: 0, node: n('self', 'Instance', { component: 'card' }) })).toThrow('contains itself')
    expect(project.components[0]).toEqual(card())
  })

  it('an edit to the definition reaches every instance (they reference it)', () => {
    const { project } = setup([n('i1', 'Instance', { component: 'card' }), n('i2', 'Instance', { component: 'card' })])
    applyOperation(project, { op: 'setStyle', componentId: 'card', nodeId: 'c-root', style: { p: '8' } })
    expect(project.components[0]!.root.style).toEqual({ p: '8' })
    expect(project.pages[0]!.root.children.map(c => c.props.component)).toEqual(['card', 'card'])
  })
})

describe('instance operations', () => {
  it('setProps on an Instance sets and removes property values and the variant', () => {
    const { project, pageId } = setup([n('i1', 'Instance', { component: 'card' })])
    const after = roundTrip(project, { op: 'setProps', pageId, nodeId: 'i1', props: { title: 'Hello', variant: 'dark' } })
    expect(after.pages[0]!.root.children[0]!.props).toEqual({ component: 'card', title: 'Hello', variant: 'dark' })
  })

  it('setProps on an Instance type-checks values and refuses unknown properties', () => {
    const { project, pageId } = setup([n('i1', 'Instance', { component: 'card' })])
    expect(() => applyOperation(project, { op: 'setProps', pageId, nodeId: 'i1', props: { title: 5 } })).toThrow('"title" must be a string')
    expect(() => applyOperation(project, { op: 'setProps', pageId, nodeId: 'i1', props: { nope: 'x' } })).toThrow('"Card" has no property "nope"')
    expect(() => applyOperation(project, { op: 'setProps', pageId, nodeId: 'i1', props: { variant: 'nope' } })).toThrow('unknown variant "nope"')
    expect(project.pages[0]!.root.children[0]!.props).toEqual({ component: 'card' })
  })

  it('inserting an Instance checks it against its definition', () => {
    const { project, pageId } = setup()
    const rootId = project.pages[0]!.root.id
    expect(() => applyOperation(project, { op: 'insert', pageId, parentId: rootId, index: 0, node: n('i1', 'Instance', { component: 'ghost' }) })).toThrow('unknown component "ghost"')
    expect(() => applyOperations(project, [{ op: 'insert', pageId, parentId: rootId, index: 0, node: n('i1', 'Instance', { component: 'card' }, [n('f1', 'SlotFill', { slot: 'body' })]) }])).not.toThrow()
  })
})

describe('componentUsages', () => {
  it('lists the instances of a component on pages and in other definitions, outermost first', () => {
    const { project, pageId } = setup([n('i1', 'Instance', { component: 'card' }), n('row', 'Row', {}, [n('i2', 'Instance', { component: 'card' })])])
    project.components.push({ id: 'grid', name: 'Grid', root: n('g-root', 'Grid', {}, [n('g-card', 'Instance', { component: 'card' })]), properties: [], variants: [] })
    expect(componentUsages(project, 'card')).toEqual([
      { pageId, nodeId: 'i1', where: 'page "Home"' },
      { pageId, nodeId: 'i2', where: 'page "Home"' },
      { componentId: 'grid', nodeId: 'g-card', where: 'component "Grid"' }
    ])
    expect(componentUsages(project, 'grid')).toEqual([])
  })
})
