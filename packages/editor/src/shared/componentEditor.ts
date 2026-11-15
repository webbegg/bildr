import { parseStyleKey } from '@bildr/codegen/design'
import type { ComponentFile, Model, ModelNode, PropertyDef } from '@bildr/codegen/model'
import { STRUCTURAL_PROPS } from '@bildr/codegen/render'
import { findNode } from '../design/tree.ts'
import { insertableComponents } from '../editor/drop.ts'
import { isStyleBinding } from './bindingDot.ts'
import { propDefsOf } from './nodeProps.ts'
import type { PropDef } from './nodeProps.ts'
import { targetLabel } from './propertyLabels.ts'
import { matches } from './sidebar.ts'
import type { Command, CommandContext } from './commands.ts'
import { shortcutKeys } from './commands.ts'

/**
 * The component editor's pure parts (the hosted `composables/componentEditor.ts`, over
 * the model's files): the Assets list of components (by folder, with where each is
 * used), which components can replace which, and the quick actions. The editor
 * (`useEditor`) and the panels call these; actions do the edits. The instance
 * payload and `insertableComponents` live in `editor/drop.ts`.
 */

/** One Instance of a component: the file it is in (`file` is what node actions take), its node id, and where that is, for messages. */
export interface ComponentUsage {
  file: string
  kind: 'page' | 'component' | 'layout'
  nodeId: string
  where: string
}

export interface ComponentEntry {
  def: ComponentFile
  /** The name after its folder, e.g. `Primary` for `Buttons/Primary`. */
  label: string
  usages: ComponentUsage[]
}

export interface ComponentFolder {
  /** `''` for components outside a folder, listed first. */
  name: string
  entries: ComponentEntry[]
}

const componentsOf = (model: Pick<Model, 'modules'>): ComponentFile[] => Object.values(model.modules).flatMap(entry => entry.components)

/**
 * Every Instance of component `componentId` on the pages, in the other
 * components and in the layouts, in document order, with its node and whether it
 * sits inside another instance of the same component (in that one's slot content).
 */
export function componentInstances(model: Pick<Model, 'modules' | 'layouts'>, componentId: string): (ComponentUsage & { nested: boolean })[] {
  const found: (ComponentUsage & { nested: boolean })[] = []
  const visit = (node: ModelNode, at: Pick<ComponentUsage, 'file' | 'kind' | 'where'>, nested: boolean) => {
    const match = node.type === 'Instance' && node.props?.component === componentId
    if (match) found.push({ ...at, nodeId: node.id, nested })
    node.children?.forEach(child => visit(child, at, nested || match))
  }
  for (const page of Object.values(model.modules).flatMap(entry => entry.pages)) visit(page.root, { file: page.id, kind: 'page', where: `page "${page.name}"` }, false)
  for (const component of componentsOf(model)) {
    if (component.id !== componentId) visit(component.root, { file: component.id, kind: 'component', where: `component "${component.name}"` }, false)
  }
  for (const layout of model.layouts) visit(layout.root, { file: layout.id, kind: 'layout', where: `layout "${layout.name}"` }, false)
  return found
}

/** Where component `componentId` is used: its instances, leaving out the ones inside another instance of it, which go with the outer one. */
export function componentUsages(model: Pick<Model, 'modules' | 'layouts'>, componentId: string): ComponentUsage[] {
  return componentInstances(model, componentId).filter(instance => !instance.nested).map(({ nested: _nested, ...usage }) => usage)
}

/** The components whose name matches `query`, grouped by the folder before the last `/` of their name. */
export function componentFolders(model: Pick<Model, 'modules' | 'layouts'>, query: string): ComponentFolder[] {
  const folders = new Map<string, ComponentEntry[]>([['', []]])
  for (const def of componentsOf(model)) {
    if (!matches(query, def.name)) continue
    const at = def.name.lastIndexOf('/')
    const folder = at < 0 ? '' : def.name.slice(0, at)
    if (!folders.has(folder)) folders.set(folder, [])
    folders.get(folder)!.push({ def, label: def.name.slice(at + 1), usages: componentUsages(model, def.id) })
  }
  return [...folders].filter(([, entries]) => entries.length).map(([name, entries]) => ({ name, entries }))
}

/** The first delete confirm: it names nothing the module hasn't said, because the client's usage list can be stale (the module refuses a delete while an instance uses the component). */
export function componentDeleteAsk(def: Pick<ComponentFile, 'name'>): { title: string, description: string, items: string[], confirmLabel: string, danger: true } {
  return { title: `Delete "${def.name}"?`, description: 'Undo brings it back. If an instance uses it, you are asked again before they go too.', items: [], confirmLabel: 'Delete component', danger: true }
}

/** Whether the module refused `component_delete` because instances use the component (the only refusal `force` answers). */
export function isInUseRefusal(message: string | null): message is string {
  return !!message && /^Component ".*" is used by \d+ instances?:/.test(message)
}

/** The second confirm, after the module's "in use" refusal: it shows that refusal, and Delete with its instances sends `force`. */
export function componentForceConfirm(def: Pick<ComponentFile, 'name'>, refusal: string): { title: string, description: string, items: string[], confirmLabel: string, danger: true } {
  return { title: `Delete "${def.name}" and its instances?`, description: `${refusal}. Deleting the component deletes them too; undo brings everything back.`, items: [], confirmLabel: 'Delete with its instances', danger: true }
}

/** The delete confirm (EditorConfirm): one item per place the component is used, counting its instances there. */
export function componentDeleteConfirm(def: Pick<ComponentFile, 'name'>, usages: ComponentUsage[]): { title: string, description: string, items: string[], confirmLabel: string, danger: true } {
  const title = `Delete "${def.name}"?`
  if (!usages.length) return { title, description: 'No instance uses it. Undo brings it back.', items: [], confirmLabel: 'Delete component', danger: true }
  const counts = new Map<string, number>()
  for (const usage of usages) counts.set(usage.where, (counts.get(usage.where) ?? 0) + 1)
  const n = usages.length
  const instances = `${n} instance${n === 1 ? '' : 's'}`
  return {
    title,
    description: `Used by ${instances}. Deleting the component deletes ${n === 1 ? 'it' : 'them'} too; undo brings everything back.`,
    items: [...counts].map(([where, count]) => `${where}${count > 1 ? ` (${count} instances)` : ''}`),
    confirmLabel: `Delete with ${instances}`,
    danger: true
  }
}

export { insertableComponents }

/** A Replace with › item's second line: the usage count, and why it is disabled (`2 instances · The current component`). */
export function replaceChoiceHint(choice: Pick<ReplaceChoice, 'usages' | 'reason'>): string {
  const count = `${choice.usages} instance${choice.usages === 1 ? '' : 's'}`
  return choice.reason ? `${count} · ${choice.reason}` : count
}

export interface ReplaceChoice {
  def: ComponentFile
  /** Its instances (`componentUsages`). */
  usages: number
  disabled: boolean
  /** Why it is disabled: the current component, or the cycle it would make; '' when it isn't. */
  reason: string
}

/** Whether component `id` (through its own tree and the components in it) has an Instance of `target`. */
const contains = (all: readonly ComponentFile[], id: string, target: string, seen = new Set<string>()): boolean => {
  if (seen.has(id)) return false
  seen.add(id)
  const component = all.find(entry => entry.id === id)
  if (!component) return false
  const used: string[] = []
  const walk = (node: ModelNode) => {
    if (node.type === 'Instance' && typeof node.props?.component === 'string') used.push(node.props.component)
    node.children?.forEach(walk)
  }
  walk(component.root)
  return used.some(next => next === target || contains(all, next, target, seen))
}

/**
 * Why replacing instances that sit in the component `host` with `componentId` is refused: a
 * component would contain itself (a cycle). Undefined when it can; pages and layouts take any component.
 */
export function replaceProblem(model: Pick<Model, 'modules'>, hosts: readonly string[], componentId: string): string | undefined {
  const all = componentsOf(model)
  const name = (id: string) => all.find(entry => entry.id === id)?.name ?? id
  for (const host of hosts) {
    if (host === componentId) return `"${name(componentId)}" cannot contain itself: replacing would create a cycle`
    if (contains(all, componentId, host)) return `"${name(componentId)}" contains "${name(host)}": replacing would create a cycle`
  }
  return undefined
}

/**
 * "Replace with ›": every component, with its usage count, to replace
 * instances of `currentId` that sit in the components `hosts` with. The current
 * component and the ones that would make a component contain itself are
 * disabled, saying why.
 */
export function replaceChoices(model: Pick<Model, 'modules' | 'layouts'>, currentId: string, hosts: readonly string[]): ReplaceChoice[] {
  return componentsOf(model).map((def) => {
    const reason = def.id === currentId ? 'The current component' : replaceProblem(model, hosts, def.id) ?? ''
    return { def, usages: componentUsages(model, def.id).length, disabled: !!reason, reason }
  })
}

export interface ComponentCommandActions {
  insert: (componentId: string) => unknown
  edit: (componentId: string) => unknown
  create: () => unknown
  /** Opens the interactive preview on a page showing the component (see `previewPageFor`). */
  previewInteractions?: (componentId: string) => unknown
}

const onCanvas = ({ editor }: CommandContext) => editor.mode === 'build' && !!editor.page

/**
 * The quick actions for user components: insert an instance of one (Insert;
 * not one that would contain itself), open one in the component view (Go
 * to), and "Create component" from the selection when `canCreate`.
 */
export function componentCommands(model: Model, state: { editingId: string | null, canCreate: boolean }, actions: ComponentCommandActions): Command<CommandContext>[] {
  return [
    ...insertableComponents(model, state.editingId).map((def): Command<CommandContext> => ({
      id: `insert:component:${def.id}`,
      group: 'insert',
      label: def.name,
      hint: 'Component',
      icon: 'i-lucide-component',
      keywords: ['component', 'instance'],
      enabled: onCanvas,
      run: () => actions.insert(def.id)
    })),
    {
      id: 'component:create',
      group: 'actions',
      label: 'Create component',
      icon: 'i-lucide-component',
      keywords: ['component', 'symbol', 'reuse'],
      shortcut: shortcutKeys('create-component'),
      enabled: c => onCanvas(c) && state.canCreate,
      run: () => actions.create()
    },
    ...(state.editingId && actions.previewInteractions
      ? [{
        id: 'component:preview-interactions',
        group: 'actions',
        label: 'Preview interactions',
        icon: 'i-lucide-zap',
        keywords: ['play', 'hover', 'pressed', 'click', 'variant', 'state', 'prototype'],
        shortcut: shortcutKeys('preview'),
        enabled: c => c.editor.mode === 'build',
        run: () => actions.previewInteractions!(state.editingId!)
      } satisfies Command<CommandContext>]
      : []),
    ...componentsOf(model).map((def): Command<CommandContext> => ({
      id: `component:${def.id}`,
      group: 'goto',
      label: def.name,
      hint: 'Component',
      icon: 'i-lucide-component',
      keywords: ['component', 'edit'],
      enabled: c => !(c.editor.mode === 'build' && state.editingId === def.id),
      run: () => actions.edit(def.id)
    }))
  ]
}

type PropertyBinding = NonNullable<PropertyDef['bindings']>[number]

/** Whether a binding drives `key` of node `nodeId`: a prop, or with `target` `style` a style key. */
export function bindsKey(binding: PropertyBinding, nodeId: string, key: string, target: 'prop' | 'style'): boolean {
  return binding.nodeId === nodeId && binding.prop === key && isStyleBinding(binding) === (target === 'style')
}

/** The property (or layout variable) that drives `key` of node `nodeId`, a prop or a style key; a prop and a style key can share a name (`text`). */
export function boundProperty(properties: readonly PropertyDef[], nodeId: string, key: string, target: 'prop' | 'style'): PropertyDef | undefined {
  return properties.find(property => (property.bindings ?? []).some(binding => bindsKey(binding, nodeId, key, target)))
}

/**
 * `base`, or `base 2`, `base 3`… when the list already has that name. Names compare as the module
 * keeps them (camelCased), so `Text` is taken by `text`.
 */
export function uniqueComponentName(base: string, taken: readonly { name: string }[]): string {
  const key = (name: string) => name.replace(/\s+/g, '').toLowerCase()
  const names = new Set(taken.map(entry => key(entry.name)))
  let name = base
  for (let n = 2; names.has(key(name)); n++) name = `${base} ${n}`
  return name
}

/** A record property (`entity`) or a list of them (`many`) the "+" menu adds, named after the entity. */
export interface EntityAdd {
  name: string
  kind: 'entity'
  entity: string
  many?: true
}

const lowerFirst = (name: string) => `${name[0]!.toLowerCase()}${name.slice(1)}`

/** The ids of the "+" menu's entity items: `entity:<id>` is one record, `entities:<id>` a list of them. */
export const ENTITY_ITEM = 'entity:'
export const ENTITIES_ITEM = 'entities:'

/**
 * The "+" menu's Record › and List › submenus, one item per entity of the model: the module's
 * entity properties, which an instance binds to a record in scope (no hosted equivalent: the
 * hosted editor's properties are bound to a node prop, a style key or a slot). Empty without entities.
 */
export function entityAddItems(model: Pick<Model, 'modules'> | null | undefined): { id: string, label: string, hint: string, children: { id: string, label: string }[] }[] {
  const entities = Object.values(model?.modules ?? {}).flatMap(entry => entry.entities)
  if (!entities.length) return []
  return [
    { id: 'record', label: 'Record', hint: 'An instance binds one record', children: entities.map(entity => ({ id: `${ENTITY_ITEM}${entity.id}`, label: entity.name })) },
    { id: 'list', label: 'List', hint: 'An instance binds a list of records', children: entities.map(entity => ({ id: `${ENTITIES_ITEM}${entity.id}`, label: entity.name })) }
  ]
}

/** The fields that add the entity property an `entityAddItems` item names; undefined for another item. */
export function entityBindingAdd(model: Pick<Model, 'modules'> | null | undefined, properties: readonly Pick<PropertyDef, 'name'>[], item: string): EntityAdd | undefined {
  const many = item.startsWith(ENTITIES_ITEM)
  if (!many && !item.startsWith(ENTITY_ITEM)) return undefined
  const id = item.slice(many ? ENTITIES_ITEM.length : ENTITY_ITEM.length)
  const entity = Object.values(model?.modules ?? {}).flatMap(entry => entry.entities).find(entry => entry.id === id)
  if (!entity) return undefined
  return { name: uniqueComponentName(many ? entity.plural : lowerFirst(entity.name), properties), kind: 'entity', entity: entity.id, ...(many ? { many: true as const } : {}) }
}

/** The `component_property_add` / `layout_variable_add` fields that turn a prop or style key into a property. */
export interface BindingAdd {
  name: string
  kind: PropertyDef['kind']
  bindings: PropertyBinding[]
  /** A select property's values (the module refuses a select without them). */
  options?: string[]
}

/**
 * The fields that turn prop `prop` of `node` into a property (or variable): named after the prop,
 * of its kind, bound to it. No stored default: the node's own value is the default, so editing
 * it reaches every instance (or page). Undefined for a prop no property can drive.
 */
export function propBindingAdd(properties: readonly Pick<PropertyDef, 'name'>[], node: ModelNode, prop: string): BindingAdd | undefined {
  const def = propDefsOf(node.type).find(entry => entry.name === prop)
  // A prop that shapes the generated markup (a tag, a level, a link target) can't be driven by a property.
  if (!def || def.kind === 'page' || def.numeric || STRUCTURAL_PROPS.includes(prop)) return undefined
  return { name: uniqueComponentName(def.label, properties), kind: def.kind, bindings: [{ nodeId: node.id, prop }], ...(def.kind === 'select' ? { options: def.options ?? [] } : {}) }
}

/** The same for style key `key` (`bg`, `md:p`) of node `nodeId`: a select property over the key's token scale, bound with `target: 'style'`. */
export function styleBindingAdd(properties: readonly Pick<PropertyDef, 'name'>[], nodeId: string, key: string): BindingAdd {
  const token = parseStyleKey(key)?.token
  return { name: uniqueComponentName(token?.label ?? key, properties), kind: 'select', bindings: [{ nodeId, prop: key, target: 'style' }], options: token ? [...token.values] : [] }
}

/** The `Primary` choice of the variant picker (select items cannot be empty). */
export const PRIMARY_VARIANT = '__primary'

/** How many props and design tokens a variant overrides, over all nodes. */
const overrideCount = (variant: ComponentFile['variants'][number]): number => Object.values(variant.overrides).reduce((n, entry) => n + Object.keys(entry.props ?? {}).length + Object.keys(entry.style ?? {}).length + (entry.unset?.length ?? 0), 0)

/** The variant choices of a component: Primary, then each variant, described (two-line menu items) by what it overrides. */
export function variantItems(def: Pick<ComponentFile, 'variants'>): { label: string, value: string, description: string }[] {
  const describe = (variant: ComponentFile['variants'][number]) => {
    const n = overrideCount(variant)
    return n ? `${n} override${n === 1 ? '' : 's'}` : 'Same as Primary'
  }
  return [
    { label: 'Primary', value: PRIMARY_VARIANT, description: 'The component as defined' },
    ...def.variants.map(variant => ({ label: variant.name, value: variant.id, description: describe(variant) }))
  ]
}

/** The `instance_set_values` variant for a chosen item: `''` for the primary. */
export const instanceVariantValue = (item: string): string => item === PRIMARY_VARIANT ? '' : item

/** The property kinds an instance (or a page, for a layout variable) sets with a prop field; `entity` and `field` have their own rows. */
const FIELD_KINDS: readonly PropertyDef['kind'][] = ['text', 'textarea', 'number', 'boolean', 'select', 'link', 'image', 'icon']

/**
 * A non-slot property as a prop field of its instances (the hosted `propertyField`): keyed by the
 * property id, its default and options from the first binding: a bound prop, or for a style
 * binding the bound style key (its token scale). Its description (the field's tooltip) and
 * placeholder come from the property. Null for the kinds without a field (`entity`, `field`, `slot`).
 */
export function propertyField(def: Pick<ComponentFile, 'name' | 'root'>, property: PropertyDef, noun = 'property', owner = def.name): PropDef | null {
  if (!FIELD_KINDS.includes(property.kind)) return null
  const binding = property.bindings?.[0]
  const target = binding ? findNode(def.root, binding.nodeId) : undefined
  const label = property.label ?? property.name
  const common = {
    name: property.id,
    label,
    kind: property.kind as PropDef['kind'],
    description: property.description ?? `${label}, a ${noun} of ${owner}`,
    ...(property.placeholder ? { placeholder: property.placeholder } : {})
  }
  if (binding && isStyleBinding(binding)) {
    const token = parseStyleKey(binding.prop)?.token
    return {
      ...common,
      default: property.default ?? target?.style?.[binding.prop] ?? '',
      ...(token && property.kind === 'select' ? { options: [...token.values] } : {})
    }
  }
  const targetDef = target && binding ? propDefsOf(target.type).find(entry => entry.name === binding.prop) : undefined
  const options = property.kind === 'select' ? property.options ?? targetDef?.options : targetDef?.options
  return {
    ...common,
    default: property.default ?? (target && binding ? target.props?.[binding.prop] : undefined) ?? targetDef?.default ?? '',
    ...(options ? { options } : {})
  }
}

/** What a binding drives, for a tooltip: `Heading · text`, `Heading · style text`, a slot's container alone; a named layer is `Footer (Container)`. */
export function bindingLabel(root: ModelNode, binding: PropertyBinding | undefined): string {
  if (!binding) return 'Not bound'
  const target = findNode(root, binding.nodeId)
  if (!target) return 'Missing node'
  const label = targetLabel(target)
  if (isStyleBinding(binding)) return `${label} · style ${binding.prop}`
  return binding.prop === 'children' ? label : `${label} · ${binding.prop}`
}

/** Style keys "+" offers besides the ones a node sets, so an unstyled node can still get a style property. */
const COMMON_STYLE_KEYS = ['bg', 'color']

/** The id prefix of `styleAddItems` items. */
export const STYLE_ITEM = 'style:'

/**
 * The style choices of the Properties (or Variables) "+" menu, as the binding dot offers on every
 * style row: each style key node `node` sets, then Background and Text color. A key some property
 * already drives is disabled. Ids are `style:<key>`.
 */
export function styleAddItems(properties: readonly PropertyDef[], node: ModelNode, noun = 'property'): { id: string, label: string, disabled: boolean, hint: string }[] {
  if (node.type === 'Instance' || node.type === 'SlotFill') return []
  const keys = [...new Set([...Object.keys(node.style ?? {}), ...COMMON_STYLE_KEYS])]
  return keys.flatMap((key) => {
    const parsed = parseStyleKey(key)
    if (!parsed) return []
    const bound = !!boundProperty(properties, node.id, key, 'style')
    const label = `Style · ${parsed.token.label}${parsed.breakpoint ? ` (${parsed.breakpoint})` : ''}`
    return [{ id: `${STYLE_ITEM}${key}`, label, disabled: bound, hint: bound ? `Already a ${noun}` : noun === 'property' ? 'Instances can set it' : 'Each page can set it' }]
  })
}
