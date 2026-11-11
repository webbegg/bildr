import { describe, expect, it, vi } from 'vitest'
import { createNode, createProject } from '#shared/document/factory'
import type { ComponentDefinition, DocNode, Project } from '#shared/document/schema'
import type { CommandContext } from '#shared/editor/commands'
import {
  componentCommands,
  componentDeleteConfirm,
  componentFolders,
  insertableComponents,
  instanceDragPayload,
  outsideInstance,
  parseInstancePayload,
  bindingLabel,
  boundProperty,
  propBindingAdd,
  propertyField,
  styleBindingAdd,
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

describe('componentDeleteConfirm', () => {
  it('lists each place once, counting the instances there', () => {
    const primary = componentFolders(project(), '')[1]!.entries[0]!
    expect(componentDeleteConfirm(primary.def, primary.usages)).toEqual({
      title: 'Delete "Buttons/Primary"?',
      description: 'Used by 3 instances. Deleting the component deletes them too; undo brings everything back.',
      items: ['page "Home" (2 instances)', 'component "Card"'],
      confirmLabel: 'Delete with 3 instances',
      danger: true
    })
    expect(componentDeleteConfirm(primary.def, [])).toEqual({ title: 'Delete "Buttons/Primary"?', description: 'No instance uses it. Undo brings it back.', items: [], confirmLabel: 'Delete component', danger: true })
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

  it('takes a style binding\'s default and options from the bound style key, not the prop of the same name', () => {
    const heading = { ...node('Heading', { text: 'Hi' }), style: { text: '2xl', color: 'muted' } }
    const card = def('cmp_x', 'X', node('Card', {}, [heading]))
    const size = { id: 'prop_size', name: 'Size', kind: 'select' as const, bindings: [{ nodeId: heading.id, prop: 'text', target: 'style' as const }] }
    const field = propertyField(card, size)
    expect(field).toMatchObject({ name: 'prop_size', kind: 'select', default: '2xl' })
    expect(field.options).toEqual(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'])
    const tone = { id: 'prop_tone', name: 'Tone', kind: 'select' as const, default: 'error', bindings: [{ nodeId: heading.id, prop: 'color', target: 'style' as const }] }
    expect(propertyField(card, tone)).toMatchObject({ default: 'error' })
    expect(propertyField(card, tone).options).toContain('primary')
  })
})

describe('propBindingAdd and styleBindingAdd', () => {
  it('turns a node prop into a property named after it, bound to it, without a stored default', () => {
    const button = { ...node('Button'), id: 'b1' }
    expect(propBindingAdd([{ name: 'Label' }], button, 'label')).toEqual({ name: 'Label 2', kind: 'text', bindings: [{ nodeId: 'b1', prop: 'label' }] })
    expect(propBindingAdd([], button, 'nope')).toBeUndefined()
  })

  it('turns a style key into a select property bound to that key', () => {
    expect(styleBindingAdd([], 'b1', 'md:p')).toEqual({ name: 'Padding', kind: 'select', bindings: [{ nodeId: 'b1', prop: 'md:p', target: 'style' }] })
    expect(styleBindingAdd([{ name: 'Background' }], 'b1', 'bg').name).toBe('Background 2')
  })
})

describe('boundProperty and bindingLabel', () => {
  const props = [
    { id: 'p_text', name: 'Title', kind: 'text' as const, bindings: [{ nodeId: 'n1', prop: 'text' }] },
    { id: 'p_size', name: 'Size', kind: 'select' as const, bindings: [{ nodeId: 'n1', prop: 'text', target: 'style' as const }] }
  ]

  it('tells a prop binding from a style binding of the same name', () => {
    expect(boundProperty(props, 'n1', 'text', 'prop')?.id).toBe('p_text')
    expect(boundProperty(props, 'n1', 'text', 'style')?.id).toBe('p_size')
    expect(boundProperty(props, 'n2', 'text', 'style')).toBeUndefined()
    expect(boundProperty(props, 'n1', 'bg', 'style')).toBeUndefined()
  })

  it('names what a binding drives', () => {
    const root = node('Card', {}, [{ ...node('Heading'), id: 'n1' }])
    expect(bindingLabel(root, props[0]!.bindings[0])).toBe('Heading · text')
    expect(bindingLabel(root, props[1]!.bindings[0])).toBe('Heading · style text')
    expect(bindingLabel(root, { nodeId: 'n1', prop: 'children' })).toBe('Heading')
    expect(bindingLabel(root, { nodeId: 'gone', prop: 'text' })).toBe('Missing node')
    expect(bindingLabel(root, undefined)).toBe('Not bound')
  })

  it('names a bound layer by its layer name, a slot as its container', () => {
    const root = node('Card', {}, [{ ...node('Container'), id: 'n_foot', name: 'Footer' }])
    expect(bindingLabel(root, { nodeId: 'n_foot', prop: 'children' })).toBe('Footer (Container)')
    expect(bindingLabel(root, { nodeId: 'n_foot', prop: 'bg', target: 'style' })).toBe('Footer (Container) · style bg')
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

  it('previews the interactions of the component being edited, with ⌘P', () => {
    const actions = { insert: vi.fn(), edit: vi.fn(), create: vi.fn(), previewInteractions: vi.fn() }
    const preview = componentCommands(project(), { editingId: 'cmp_card', canCreate: false }, actions).find(c => c.id === 'component:preview-interactions')!
    expect(preview).toMatchObject({ group: 'actions', label: 'Preview interactions', shortcut: ['meta', 'p'] })
    expect(preview.enabled(ctx())).toBe(true)
    expect(preview.enabled(ctx('data'))).toBe(false)
    preview.run(ctx())
    expect(actions.previewInteractions).toHaveBeenCalledWith('cmp_card')
    expect(componentCommands(project(), { editingId: null, canCreate: false }, actions).find(c => c.id === 'component:preview-interactions')).toBeUndefined()
  })
})
