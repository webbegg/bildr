import { z } from 'zod'
import { ArtifactIdSchema, LAYOUT_VARIABLE_KINDS, LocalIdSchema, ValueSchema } from '../model/schemas.ts'
import type { LayoutFile, ModelNode, PageFile, Value } from '../model/schemas.ts'
import { camel, defineEdit, fail, kebab, snake, uniqueName } from './core.ts'
import type { Draft, Tree } from './core.ts'
import { addProperty, patchProperty, PropertyPatchFields, propertyInput } from './components.ts'
import { moveNode, nodeIn, removeNode } from './nodes.ts'
import { isContainerType } from './palette.ts'
import { PageRef } from './pages.ts'
import { cloneWithNewIds, containsNode, findNode } from './tree.ts'

/** Layout files (their slots and variables) and the pages' use of them: `layout`, `layoutValues` and SlotFills at the page root. */

const LayoutRef = ArtifactIdSchema.describe('A layout id, e.g. "lay_main"')
const NameSchema = z.string().trim().min(1).max(100)
/** The slot a layout fills with the page's own content. */
export const CHILDREN_SLOT = 'children'

const layoutName = (draft: Draft, given: string, except?: string): string => {
  const name = kebab(given)
  if (!/^[a-z][a-z0-9-]*$/.test(name)) fail('invalid', `"${given}" can't be a layout name: start with a letter, like "main"`)
  const taken = draft.model.layouts.find(layout => layout.name === name && layout.id !== except)
  if (taken) fail('invalid', `A layout is already named "${name}"`)
  return name
}

const defaultName = (draft: Draft, base: string) => uniqueName(base, draft.model.layouts.map(layout => layout.name), '-')

const addLayout = (draft: Draft, layout: Omit<LayoutFile, 'id'>, after?: LayoutFile): { layout: LayoutFile, filePath: string } => {
  const added = { id: draft.mint('lay', layout.name), ...layout } as LayoutFile
  const list = draft.model.layouts
  list.splice(after ? list.indexOf(after) + 1 : list.length, 0, added)
  return { layout: added, filePath: draft.place(added.id, '.bildr/layouts', layout.name) }
}

const slotNode = (draft: Draft): ModelNode => ({ id: draft.nodeId('Container'), type: 'Container', props: { tag: 'main' }, children: [] })
const shellStyle = () => ({ display: 'flex', direction: 'col', minH: 'screen' })

const pagesUsing = (draft: Draft, id: string): PageFile[] => draft.pages().filter(page => page.layout === id).sort((a, b) => (a.id < b.id ? -1 : 1))

/** The page's own content for its layout's named slots (SlotFills at its root), optionally only for `slot`. */
const fillsOf = (page: PageFile, slot?: string) => (page.root.children ?? []).filter(child => child.type === 'SlotFill' && (slot === undefined || child.props?.slot === slot))

const pageTree = (draft: Draft, page: PageFile): Tree => draft.tree(page.id)

const slotIn = (layout: LayoutFile, id: string) => layout.slots.find(slot => slot.id === id) ?? fail('not_found', `Layout ${layout.name} has no slot "${id}"`)

/** Refuses a slot node that isn't a container of the layout, is another slot's, or sits inside or around one. */
const checkSlotNode = (layout: LayoutFile, nodeId: string, except?: string) => {
  const node = findNode(layout.root, nodeId) ?? fail('not_found', `Node "${nodeId}" not found in ${layout.id}`)
  if (!isContainerType(node.type)) fail('invalid', `A ${node.type} cannot hold slot content`)
  for (const slot of layout.slots) {
    if (slot.id === except) continue
    if (slot.nodeId === nodeId) fail('invalid', `Node "${nodeId}" is already the slot "${slot.name}"`)
    const other = findNode(layout.root, slot.nodeId)
    if (other && containsNode(other, nodeId)) fail('invalid', `Node "${nodeId}" is inside the slot "${slot.name}"`)
    if (containsNode(node, slot.nodeId)) fail('invalid', `Node "${nodeId}" holds the slot "${slot.name}"`)
  }
}

const slotName = (given: string) => {
  const name = camel(given)
  if (!/^[A-Za-z_][\w-]*$/.test(name)) fail('invalid', `"${given}" can't be a slot name: start with a letter`)
  return name
}

// ── Layout files ─────────────────────────────────────────────────────────

export const layoutCreate = defineEdit({
  input: z.object({ name: NameSchema.optional().describe('kebab-cased, unique; defaults to "layout", numbered when taken') }),
  apply: (draft, { name: given }) => {
    const name = given === undefined ? defaultName(draft, 'layout') : layoutName(draft, given)
    const root: ModelNode = { id: draft.nodeId('Container'), type: 'Container', style: shellStyle() }
    const slot = slotNode(draft)
    root.children = [slot]
    const { layout, filePath } = addLayout(draft, { name, slots: [{ id: CHILDREN_SLOT, name: CHILDREN_SLOT, nodeId: slot.id }], root })
    return { layoutId: layout.id, slotNodeId: slot.id, filePath }
  }
})

export const layoutCreateFromSelection = defineEdit({
  input: z.object({
    page: PageRef,
    nodeIds: z.array(LocalIdSchema).min(1).describe('Top-level layers of the page (children of its root), e.g. a header and a footer'),
    name: NameSchema.optional()
  }),
  apply: (draft, { page: pageId, nodeIds, name: given }) => {
    const { page } = draft.page(pageId)
    if (page.layout) fail('invalid', `Page "${page.name}" already uses the layout "${draft.layout(page.layout).name}"`)
    const tree = pageTree(draft, page)
    const ids = new Set(nodeIds)
    const top = page.root.children ?? []
    for (const id of ids) {
      if (top.some(child => child.id === id)) continue
      nodeIn(tree, id)
      fail('invalid', 'Only top-level layers of the page can become a layout')
    }
    const name = given === undefined ? defaultName(draft, 'layout') : layoutName(draft, given)
    const selected = top.filter(child => ids.has(child.id))
    // The slot goes where the page's own content starts.
    const firstKept = top.findIndex(child => !ids.has(child.id))
    const slotIndex = firstKept === -1 ? selected.length : top.slice(0, firstKept).length
    const root: ModelNode = { id: draft.nodeId('Container'), type: 'Container', style: shellStyle() }
    const chrome = selected.map(node => cloneWithNewIds(node, type => draft.nodeId(type)))
    const slot = slotNode(draft)
    root.children = [...chrome.slice(0, slotIndex), slot, ...chrome.slice(slotIndex)]
    const { layout, filePath } = addLayout(draft, { name, slots: [{ id: CHILDREN_SLOT, name: CHILDREN_SLOT, nodeId: slot.id }], root })
    for (const node of selected) removeNode(tree, node)
    page.layout = layout.id
    return { layoutId: layout.id, slotNodeId: slot.id, filePath }
  }
})

export const layoutRename = defineEdit({
  input: z.object({ layout: LayoutRef, name: NameSchema.describe('kebab-cased, unique') }),
  apply: (draft, { layout: id, name }) => {
    const layout = draft.layout(id)
    layout.name = layoutName(draft, name, id)
    return {}
  }
})

export const layoutDuplicate = defineEdit({
  input: z.object({ layout: LayoutRef, name: NameSchema.optional().describe('Defaults to "<name>-copy", numbered when taken') }),
  apply: (draft, { layout: id, name: given }) => {
    const layout = draft.layout(id)
    const name = given === undefined ? defaultName(draft, `${layout.name}-copy`) : layoutName(draft, given)
    const { id: _id, $schema: _schema, ...copy } = structuredClone(layout)
    copy.variables?.forEach((variable) => {
      variable.id = draft.mint('prop', variable.id.replace(/^prop_/, '').replace(/_\d+$/, ''))
    })
    const { layout: added, filePath } = addLayout(draft, { ...copy, name }, layout)
    return { layoutId: added.id, filePath }
  }
})

export const layoutDelete = defineEdit({
  input: z.object({ layout: LayoutRef }),
  apply: (draft, { layout: id }) => {
    const layout = draft.layout(id)
    const pages = pagesUsing(draft, id)
    if (pages.length) fail('forbidden', `Layout "${layout.name}" is used by ${pages.length} page${pages.length === 1 ? '' : 's'}: ${pages.map(page => page.id).join(', ')}. Give them another layout first`)
    draft.model.layouts.splice(draft.model.layouts.indexOf(layout), 1)
    return {}
  }
})

// ── Slots ────────────────────────────────────────────────────────────────

export const layoutSlotAdd = defineEdit({
  input: z.object({
    layout: LayoutRef,
    name: NameSchema.describe('camelCased: the slot name pages fill, e.g. "sideBar"'),
    nodeId: LocalIdSchema.describe('A container node of the layout: its children are the default content'),
    index: z.int().nonnegative().optional()
  }),
  apply: (draft, { layout: id, name: given, nodeId, index }) => {
    const layout = draft.layout(id)
    const name = slotName(given)
    if (layout.slots.some(slot => slot.name === name)) fail('invalid', `Layout ${layout.name} already has a slot "${name}"`)
    checkSlotNode(layout, nodeId)
    const slot = { id: uniqueName(snake(name) || 'slot', layout.slots.map(entry => entry.id), '_'), name, nodeId }
    layout.slots.splice(index === undefined ? layout.slots.length : Math.min(index, layout.slots.length), 0, slot)
    return { slotId: slot.id }
  }
})

export const layoutSlotUpdate = defineEdit({
  input: z.object({ layout: LayoutRef, slot: LocalIdSchema, name: NameSchema.optional(), nodeId: LocalIdSchema.optional() }),
  apply: (draft, { layout: id, slot: slotId, name, nodeId }) => {
    const layout = draft.layout(id)
    const slot = slotIn(layout, slotId)
    if (name !== undefined) {
      if (slot.id === CHILDREN_SLOT) fail('forbidden', 'The children slot keeps its name')
      const value = slotName(name)
      if (layout.slots.some(other => other !== slot && other.name === value)) fail('invalid', `Layout ${layout.name} already has a slot "${value}"`)
      slot.name = value
    }
    if (nodeId !== undefined) {
      checkSlotNode(layout, nodeId, slot.id)
      slot.nodeId = nodeId
    }
    return {}
  }
})

export const layoutSlotRemove = defineEdit({
  input: z.object({ layout: LayoutRef, slot: LocalIdSchema }),
  apply: (draft, { layout: id, slot: slotId }) => {
    const layout = draft.layout(id)
    const slot = slotIn(layout, slotId)
    if (slot.id === CHILDREN_SLOT) fail('forbidden', 'The children slot cannot be removed: it holds the page content')
    for (const page of pagesUsing(draft, id)) for (const fill of fillsOf(page, slotId)) removeNode(pageTree(draft, page), fill)
    layout.slots.splice(layout.slots.indexOf(slot), 1)
    return {}
  }
})

// ── Variables ────────────────────────────────────────────────────────────

const VariableRef = ArtifactIdSchema.describe('A layout variable id, e.g. "prop_title"')
const variableIn = (layout: LayoutFile, id: string) => layout.variables?.find(variable => variable.id === id) ?? fail('not_found', `Layout ${layout.name} has no variable "${id}"`)

export const layoutVariableAdd = defineEdit({
  input: z.object({ layout: LayoutRef, ...propertyInput(LAYOUT_VARIABLE_KINDS) }),
  apply: (draft, { layout: id, ...input }) => {
    const layout = draft.layout(id)
    const variables = layout.variables ??= []
    return { variableId: addProperty(draft, variables, `Layout ${layout.name}`, input).id }
  }
})

export const layoutVariableUpdate = defineEdit({
  input: z.object({ layout: LayoutRef, variable: VariableRef, name: NameSchema.optional(), ...PropertyPatchFields, index: z.int().nonnegative().optional() }),
  apply: (draft, { layout: id, variable: variableId, ...patch }) => {
    const layout = draft.layout(id)
    patchProperty(layout.variables!, variableIn(layout, variableId), `Layout ${layout.name}`, patch)
    return {}
  }
})

export const layoutVariableRemove = defineEdit({
  input: z.object({ layout: LayoutRef, variable: VariableRef }),
  apply: (draft, { layout: id, variable: variableId }) => {
    const layout = draft.layout(id)
    const variable = variableIn(layout, variableId)
    for (const page of pagesUsing(draft, id)) {
      if (!page.layoutValues || !(variableId in page.layoutValues)) continue
      Reflect.deleteProperty(page.layoutValues, variableId)
      if (!Object.keys(page.layoutValues).length) delete page.layoutValues
    }
    layout.variables!.splice(layout.variables!.indexOf(variable), 1)
    if (!layout.variables!.length) delete layout.variables
    return {}
  }
})

// ── Pages in a layout ────────────────────────────────────────────────────

const layoutOf = (draft: Draft, page: PageFile): LayoutFile => (page.layout ? draft.layout(page.layout) : fail('invalid', `Page "${page.name}" has no layout`))

export const pageSetLayout = defineEdit({
  input: z.object({ page: PageRef, layout: LayoutRef.nullable().describe('A layout id, or null for none') }),
  apply: (draft, { page: pageId, layout }) => {
    const { page } = draft.page(pageId)
    if ((page.layout ?? null) === layout) return {}
    if (layout) draft.layout(layout)
    const tree = pageTree(draft, page)
    for (const fill of fillsOf(page)) removeNode(tree, fill)
    delete page.layoutValues
    if (layout) page.layout = layout
    else delete page.layout
    return {}
  }
})

export const pageSetLayoutValues = defineEdit({
  input: z.object({ page: PageRef, values: z.record(ArtifactIdSchema, ValueSchema.nullable()).describe('Variable id → value (static); null removes one, so its default applies') }),
  apply: (draft, { page: pageId, values }) => {
    const { page } = draft.page(pageId)
    const layout = layoutOf(draft, page)
    const next: Record<string, Value> = { ...page.layoutValues }
    for (const [id, value] of Object.entries(values)) {
      if (!layout.variables?.some(variable => variable.id === id)) fail('invalid', `Layout ${layout.name} has no variable "${id}"`)
      if (value === null) Reflect.deleteProperty(next, id)
      else next[id] = value
    }
    if (Object.keys(next).length) page.layoutValues = next
    else delete page.layoutValues
    return {}
  }
})

export const pageSetSlot = defineEdit({
  input: z.object({
    page: PageRef,
    slot: LocalIdSchema.describe('A named slot id of the page\'s layout'),
    filled: z.boolean().describe('true: the page gives the slot its own content (a SlotFill at its root); false: the layout\'s default content shows'),
    nodeIds: z.array(LocalIdSchema).min(1).optional().describe('With filled: page nodes to move into the slot, in order')
  }),
  apply: (draft, { page: pageId, slot: slotId, filled, nodeIds = [] }) => {
    const { page } = draft.page(pageId)
    const layout = layoutOf(draft, page)
    const slot = slotIn(layout, slotId)
    if (slot.id === CHILDREN_SLOT) fail('invalid', 'The children slot always shows the page content')
    const tree = pageTree(draft, page)
    const [existing] = fillsOf(page, slotId)
    if (!filled) {
      if (nodeIds.length) fail('invalid', 'nodeIds needs filled: true')
      if (existing) removeNode(tree, existing)
      return { fillId: null }
    }
    const fill = existing ?? { id: draft.nodeId('SlotFill'), type: 'SlotFill', props: { slot: slotId } }
    if (!existing) (page.root.children ??= []).push(fill)
    for (const id of nodeIds) moveNode(tree, id, fill.id, fill.children?.length ?? 0)
    return { fillId: fill.id }
  }
})
