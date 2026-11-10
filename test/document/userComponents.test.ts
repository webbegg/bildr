import { describe, expect, it } from 'vitest'
import { ComponentDefinitionSchema, ProjectSchema } from '#shared/document/schema'
import type { ComponentDefinition, DocNode } from '#shared/document/schema'
import { COMPONENTS, getComponent, isContainerType } from '#shared/document/components'
import { createProject } from '#shared/document/factory'

const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = [], style: DocNode['style'] = {}): DocNode =>
  ({ id, type, props, style, children })

/** A card with a title text and a body container: one text property, one slot property. */
function card(overrides: Partial<ComponentDefinition> = {}): ComponentDefinition {
  return {
    id: 'card',
    name: 'Card',
    root: n('c-root', 'Card', {}, [n('c-title', 'Heading', { text: 'T' }), n('c-body', 'Container')]),
    properties: [
      { id: 'title', name: 'Title', kind: 'text', default: 'Hi', bindings: [{ nodeId: 'c-title', prop: 'text' }] },
      { id: 'body', name: 'Body', kind: 'slot', bindings: [{ nodeId: 'c-body', prop: 'children' }] }
    ],
    variants: [{ id: 'dark', name: 'Dark', overrides: { 'c-title': { props: { text: 'Dark' }, style: { color: 'primary' } } } }],
    ...overrides
  }
}

function withComponents(components: ComponentDefinition[], pageChildren: DocNode[] = []) {
  const project = createProject('P')
  project.components = components
  project.pages[0]!.root.children = pageChildren
  return project
}

function problems(project: unknown): string[] {
  const result = ProjectSchema.safeParse(project)
  return result.success ? [] : result.error.issues.map(i => i.message)
}

const expectProblem = (project: unknown, fragment: string) =>
  expect(problems(project).some(p => p.includes(fragment)), `${fragment} in ${JSON.stringify(problems(project))}`).toBe(true)

describe('component definitions: schema', () => {
  it('parses a project saved before components existed', () => {
    const { components: _components, ...legacy } = createProject('Old')
    const parsed = ProjectSchema.parse(legacy)
    expect(parsed.components).toEqual([])
  })

  it('accepts a valid definition and keeps it', () => {
    const project = withComponents([card()])
    expect(problems(project)).toEqual([])
    expect(ProjectSchema.parse(project).components).toEqual([card()])
  })

  it('defaults properties and variants to empty lists', () => {
    const parsed = ComponentDefinitionSchema.parse({ id: 'x', name: 'X', root: n('r', 'Container') })
    expect(parsed.properties).toEqual([])
    expect(parsed.variants).toEqual([])
  })
})

describe('Instance and SlotFill node types', () => {
  it('are registered but not offered as palette inserts', () => {
    expect(getComponent('Instance')).toBeDefined()
    expect(getComponent('SlotFill')).toBeDefined()
    expect(COMPONENTS.map(c => c.type)).not.toContain('Instance')
    expect(COMPONENTS.map(c => c.type)).not.toContain('SlotFill')
  })

  it('are containers', () => {
    expect(isContainerType('Instance')).toBe(true)
    expect(isContainerType('SlotFill')).toBe(true)
  })
})

describe('component definitions: ids and properties', () => {
  it('rejects duplicate definition ids', () => {
    expectProblem(withComponents([card(), card()]), 'Duplicate component id "card"')
  })

  it('rejects duplicate property ids and reserved instance keys', () => {
    const dup = card()
    dup.properties.push({ ...dup.properties[0]! })
    expectProblem(withComponents([dup]), 'Duplicate property id "title"')
    const reserved = card()
    reserved.properties[0]!.id = 'component'
    expectProblem(withComponents([reserved]), 'reserved')
  })

  it('rejects duplicate variant ids', () => {
    const dup = card()
    dup.variants.push({ ...dup.variants[0]! })
    expectProblem(withComponents([dup]), 'Duplicate variant id "dark"')
  })

  it('validates the definition tree like a page tree', () => {
    expectProblem(withComponents([card({ root: n('c-root', 'Nope') })]), 'Unknown component type "Nope"')
    expectProblem(withComponents([card({ root: n('c-root', 'Heading', {}, [n('x', 'Text')]) })]), 'cannot have children')
  })

  it('keeps node ids unique inside a definition but separate from pages', () => {
    const dup = card({ root: n('c-root', 'Card', {}, [n('c-root', 'Container')]), properties: [], variants: [] })
    expectProblem(withComponents([dup]), 'Duplicate node id "c-root"')
    const sharedWithPage = withComponents([card()], [n('c-root', 'Container')])
    expect(problems(sharedWithPage)).toEqual([])
  })
})

describe('component definitions: bindings', () => {
  it('rejects a binding to a missing node', () => {
    const def = card()
    def.properties[0]!.bindings = [{ nodeId: 'ghost', prop: 'text' }]
    expectProblem(withComponents([def]), 'missing node "ghost"')
  })

  it('rejects a binding to a prop the node type does not declare', () => {
    const def = card()
    def.properties[0]!.bindings = [{ nodeId: 'c-title', prop: 'nope' }]
    expectProblem(withComponents([def]), 'no prop "nope"')
  })

  it('rejects a binding whose prop kind differs from the property kind', () => {
    const def = card()
    def.properties[0]!.kind = 'number'
    delete def.properties[0]!.default
    expectProblem(withComponents([def]), 'kind')
  })

  it('requires a slot property to bind exactly one container node', () => {
    const none = card()
    none.properties[1]!.bindings = []
    expectProblem(withComponents([none]), 'exactly one')
    const leaf = card()
    leaf.properties[1]!.bindings = [{ nodeId: 'c-title', prop: 'children' }]
    expectProblem(withComponents([leaf]), 'container')
  })

  it('refuses two slot properties bound to the same node', () => {
    const def = card()
    def.properties.push({ id: 'again', name: 'Again', kind: 'slot', bindings: [{ nodeId: 'c-body', prop: 'children' }] })
    expectProblem(withComponents([def]), 'Slots "Body" and "Again" of "Card" are bound to the same node "c-body"')
  })

  it('refuses a slot property inside another slot\'s container', () => {
    const def = card()
    def.root.children[1]!.children.push(n('c-inner', 'Container'))
    def.properties.push({ id: 'inner', name: 'Inner', kind: 'slot', bindings: [{ nodeId: 'c-inner', prop: 'children' }] })
    expectProblem(withComponents([def]), 'Slot "Inner" of "Card" is inside slot "Body"')
  })

  it('rejects a default that does not fit the property', () => {
    const def = card()
    def.properties[0]!.default = 5
    expectProblem(withComponents([def]), 'must be a string')
  })
})

describe('component definitions: variants', () => {
  it('rejects overrides of missing nodes', () => {
    const def = card()
    def.variants[0]!.overrides = { ghost: { props: { text: 'x' } } }
    expectProblem(withComponents([def]), 'missing node "ghost"')
  })

  it('validates override props and style tokens', () => {
    const badProp = card()
    badProp.variants[0]!.overrides = { 'c-title': { props: { level: '9' } } }
    expectProblem(withComponents([badProp]), 'must be one of')
    const unknownProp = card()
    unknownProp.variants[0]!.overrides = { 'c-title': { props: { nope: 'x' } } }
    expectProblem(withComponents([unknownProp]), 'no prop "nope"')
    const badStyle = card()
    badStyle.variants[0]!.overrides = { 'c-title': { style: { color: 'not-a-color' } } }
    expect(problems(withComponents([badStyle])).length).toBeGreaterThan(0)
  })
})

describe('Instance nodes', () => {
  const instance = (props: DocNode['props'] = {}, children: DocNode[] = []) => n('i1', 'Instance', { component: 'card', ...props }, children)

  it('accepts an instance with values, a variant and slot content', () => {
    const fill = n('f1', 'SlotFill', { slot: 'body' }, [n('t1', 'Text', { text: 'x' })])
    const project = withComponents([card()], [instance({ variant: 'dark', title: 'Hello' }, [fill])])
    expect(problems(project)).toEqual([])
  })

  it('rejects an unknown component or variant', () => {
    expectProblem(withComponents([card()], [n('i1', 'Instance', { component: 'ghost' })]), 'unknown component "ghost"')
    expectProblem(withComponents([card()], [instance({ variant: 'ghost' })]), 'unknown variant "ghost"')
  })

  it('rejects values that do not match the property kind and unknown keys', () => {
    expectProblem(withComponents([card()], [instance({ title: 5 })]), 'must be a string')
    expectProblem(withComponents([card()], [instance({ mystery: 'x' })]), 'no property "mystery"')
    expectProblem(withComponents([card()], [instance({ body: 'x' })]), 'no property "body"')
  })

  it('checks a value against the bound prop options', () => {
    const def = card()
    def.properties.push({ id: 'level', name: 'Level', kind: 'select', bindings: [{ nodeId: 'c-title', prop: 'level' }] })
    expect(problems(withComponents([def], [instance({ level: '3' })]))).toEqual([])
    expectProblem(withComponents([def], [instance({ level: '9' })]), 'must be one of')
  })

  it('allows only SlotFill children', () => {
    expectProblem(withComponents([card()], [instance({}, [n('t1', 'Text')])]), 'can only contain SlotFill')
  })

  it('allows SlotFill only under an Instance and for an existing slot property', () => {
    expectProblem(withComponents([card()], [n('f1', 'SlotFill', { slot: 'body' })]), 'directly under an Instance')
    expectProblem(withComponents([card()], [instance({}, [n('f1', 'SlotFill', { slot: 'ghost' })])]), 'no slot "ghost"')
    expectProblem(withComponents([card()], [instance({}, [n('f1', 'SlotFill', { slot: 'title' })])]), 'no slot "title"')
  })

  it('allows at most one fill per slot', () => {
    const fills = [n('f1', 'SlotFill', { slot: 'body' }), n('f2', 'SlotFill', { slot: 'body' })]
    expectProblem(withComponents([card()], [instance({}, fills)]), 'filled more than once')
  })

  it('validates instances inside a definition', () => {
    const outer = card({ id: 'outer', name: 'Outer', root: n('o-root', 'Container', {}, [n('o-i', 'Instance', { component: 'ghost' })]), properties: [], variants: [] })
    expectProblem(withComponents([outer]), 'unknown component "ghost"')
  })
})

describe('component cycles', () => {
  const holder = (id: string, target: string): ComponentDefinition => ({
    id,
    name: id,
    root: n(`${id}-root`, 'Container', {}, [n(`${id}-i`, 'Instance', { component: target })]),
    properties: [],
    variants: []
  })

  it('rejects a definition that contains itself', () => {
    expectProblem(withComponents([holder('a', 'a')]), 'cycle')
  })

  it('rejects a cycle through other definitions', () => {
    expectProblem(withComponents([holder('a', 'b'), holder('b', 'a')]), 'cycle')
  })

  it('accepts nesting without a cycle', () => {
    const leaf: ComponentDefinition = { id: 'b', name: 'b', root: n('b-root', 'Container'), properties: [], variants: [] }
    expect(problems(withComponents([holder('a', 'b'), leaf]))).toEqual([])
  })
})
