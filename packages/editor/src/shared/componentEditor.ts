import type { ComponentFile, Model, ModelNode } from '@bildr/codegen/model'
import { insertableComponents } from '../editor/drop.ts'
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
