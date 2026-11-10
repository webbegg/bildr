import { describe, expect, it, vi } from 'vitest'
import { createNode, createProject } from '#shared/document/factory'
import type { ComponentDefinition, DocNode, Project } from '#shared/document/schema'
import type { CommandContext } from '#shared/editor/commands'
import {
  componentCommands,
  componentFolders,
  insertableComponents,
  instanceDragPayload,
  outsideInstance,
  parseInstancePayload,
  propertyField,
  uniqueComponentName
} from '../../app/composables/componentEditor'

const node = (type: string, props: Record<string, string | number | boolean> = {}, children: DocNode[] = []): DocNode =>
  ({ ...createNode(type, props), children })
const instance = (componentId: string, children: DocNode[] = []) => node('Instance', { component: componentId }, children)

function def(id: string, name: string, root: DocNode, extra: Partial<ComponentDefinition> = {}): ComponentDefinition {
  return { id, name, root, properties: [], variants: [], ...extra }
}

/** Home holds two Buttons/Primary and one Card; Card's definition nests a Buttons/Primary. */
function project(): Project {
  const p = createProject('Demo')
  p.components = [
    def('cmp_btn', 'Buttons/Primary', node('Button')),
    def('cmp_card', 'Card', node('Card', {}, [instance('cmp_btn')])),
    def('cmp_ghost', 'Buttons/Ghost', node('Button'))
  ]
  p.pages[0]!.root.children = [instance('cmp_btn'), instance('cmp_card'), instance('cmp_btn')]
  return p
}

describe('componentFolders', () => {
  it('groups components by the folder in their name, with their usages', () => {
    const folders = componentFolders(project(), '')
    expect(folders.map(f => [f.name, f.entries.map(e => e.label)])).toEqual([
      ['', ['Card']],
      ['Buttons', ['Primary', 'Ghost']]
    ])
    const primary = folders[1]!.entries[0]!
    expect(primary.def.id).toBe('cmp_btn')
    expect(primary.usages.map(u => u.where)).toEqual(['page "Home"', 'page "Home"', 'component "Card"'])
    expect(folders[1]!.entries[1]!.usages).toEqual([])
  })

  it('filters by name, folder included', () => {
    expect(componentFolders(project(), 'ghost').flatMap(f => f.entries.map(e => e.def.id))).toEqual(['cmp_ghost'])
    expect(componentFolders(project(), 'buttons').flatMap(f => f.entries.map(e => e.def.id))).toEqual(['cmp_btn', 'cmp_ghost'])
    expect(componentFolders(project(), 'zzz')).toEqual([])
  })
})

describe('insertableComponents', () => {
  it('offers every component on a page', () => {
    expect(insertableComponents(project(), null).map(c => c.id)).toEqual(['cmp_btn', 'cmp_card', 'cmp_ghost'])
  })

  it('leaves out, in a component view, that component and the ones that use it (a cycle)', () => {
    expect(insertableComponents(project(), 'cmp_btn').map(c => c.id)).toEqual(['cmp_ghost'])
    expect(insertableComponents(project(), 'cmp_card').map(c => c.id)).toEqual(['cmp_btn', 'cmp_ghost'])
  })
})

describe('instance drag payload', () => {
  it('round-trips a component id and ignores other payloads', () => {
    expect(parseInstancePayload(instanceDragPayload('cmp_btn'))).toBe('cmp_btn')
    expect(parseInstancePayload(JSON.stringify({ kind: 'component', type: 'Text' }))).toBeNull()
    expect(parseInstancePayload('not json')).toBeNull()
  })
})

describe('outsideInstance', () => {
  it('turns a target inside an Instance into the place right after it', () => {
    const p = project()
    const root = p.pages[0]!.root
    const card = root.children[1]!
    expect(outsideInstance(root, { parentId: card.id, index: 0 })).toEqual({ parentId: root.id, index: 2 })
    expect(outsideInstance(root, { parentId: root.id, index: 1 })).toEqual({ parentId: root.id, index: 1 })
  })
})

describe('propertyField', () => {
  it('describes a property as a prop field, its default from the bound prop', () => {
    const button = node('Button', { label: 'Buy', color: 'primary' })
    const card = def('cmp_x', 'X', node('Card', {}, [button]))
    const label = { id: 'prop_label', name: 'Label', kind: 'text' as const, bindings: [{ nodeId: button.id, prop: 'label' }] }
    const color = { id: 'prop_color', name: 'Color', kind: 'select' as const, default: 'error', bindings: [{ nodeId: button.id, prop: 'color' }] }
    expect(propertyField(card, label)).toMatchObject({ name: 'prop_label', label: 'Label', kind: 'text', default: 'Buy' })
    const field = propertyField(card, color)
    expect(field).toMatchObject({ name: 'prop_color', kind: 'select', default: 'error' })
    expect(field.options).toContain('primary')
  })
})

describe('uniqueComponentName', () => {
  it('numbers a taken name', () => {
    const components = project().components
    expect(uniqueComponentName('Card', components)).toBe('Card 2')
    expect(uniqueComponentName('Hero', components)).toBe('Hero')
  })
})

describe('componentCommands', () => {
  const ctx = (mode: 'build' | 'data' = 'build') => ({ editor: { mode, page: { id: 'p', root: node('Container') } } }) as unknown as CommandContext

  it('inserts and opens components, and creates one from the selection', () => {
    const actions = { insert: vi.fn(), edit: vi.fn(), create: vi.fn() }
    const commands = componentCommands(project(), { editingId: 'cmp_card', canCreate: false }, actions)
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
    expect(componentCommands(project(), { editingId: null, canCreate: true }, actions).find(c => c.id === 'component:create')!.enabled(ctx())).toBe(true)
  })
})
