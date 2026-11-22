import type { ComponentFile, ModelNode, Value } from '../model/schemas.ts'
import { A2UI_VERSION, BASIC_CATALOG_ID } from './wire.ts'
import type { A2uiAction, A2uiComponent, A2uiCreateSurface, A2uiDynamic } from './wire.ts'

/**
 * A bildr tree as an A2UI v1.0 surface: nested nodes become a flat component
 * list in the Basic Catalog's vocabulary, and an Instance becomes its project
 * component (see `componentCatalog`). What A2UI can't hold (style tokens,
 * visibility, most interactions, Grid and Form semantics) is reported in `lost`
 * rather than dropped silently.
 */

export interface A2uiLoss {
  nodeId: string
  kind: 'node' | 'prop' | 'style' | 'interaction' | 'binding'
  detail: string
}

export interface ToA2uiOptions {
  surfaceId: string
  /** The project's components, so an Instance becomes its component; without them an Instance is left out. */
  components?: readonly ComponentFile[]
  /** Set on project components (`@catalogId`) when the surface's default is the Basic Catalog. */
  projectCatalogId?: string
}

export interface ToA2uiResult {
  message: A2uiCreateSurface
  lost: A2uiLoss[]
}

const JUSTIFY: Record<string, string> = { start: 'start', center: 'center', end: 'end', between: 'spaceBetween', around: 'spaceAround', evenly: 'spaceEvenly', stretch: 'stretch' }
const ALIGN: Record<string, string> = { start: 'start', center: 'center', end: 'end', stretch: 'stretch' }
/** Types drawn as a Column; Grid and Form lose what makes them one. */
const AS_COLUMN: Record<string, string | undefined> = {
  Page: undefined,
  Container: undefined,
  Column: undefined,
  Grid: 'Grid becomes a Column: its columns and spans are lost',
  Form: 'Form becomes a Column: its action and fields are lost',
  // Outside an Instance, a SlotFill is the page's content for a layout slot; the layout itself isn't on the surface.
  SlotFill: 'The layout slot becomes a Column: the layout is not on the surface'
}

type Expr = Record<string, unknown>
const isExpr = (value: unknown): value is Expr => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A UAX #31 id from a bildr local id (`n_page-1` → `n_page_1`). */
const safeId = (id: string): string => {
  const cleaned = id.replace(/[^\p{XID_Continue}]/gu, '_')
  return /^[\p{XID_Start}_]/u.test(cleaned) ? cleaned : `_${cleaned}`
}

export const toA2ui = (root: ModelNode, options: ToA2uiOptions): ToA2uiResult => {
  const out: A2uiComponent[] = []
  const lost: A2uiLoss[] = []
  const used = new Set<string>(['root'])
  const byComponentId = new Map((options.components ?? []).map(component => [component.id, component]))

  const fresh = (base: string): string => {
    let id = safeId(base)
    for (let n = 2; used.has(id); n++) id = `${safeId(base)}_${n}`
    used.add(id)
    return id
  }
  const lose = (nodeId: string, kind: A2uiLoss['kind'], detail: string) => lost.push({ nodeId, kind, detail })

  /** A dot path as a JSON Pointer: relative to the innermost List item when it starts with its `as`. */
  const pointer = (path: string, scopes: string[], nodeId: string): string => {
    const [head, ...rest] = path.split('.')
    if (scopes.length && head === scopes.at(-1)) return rest.join('/')
    if (scopes.slice(0, -1).includes(head!)) lose(nodeId, 'binding', `"${path}" reads an outer List item, which A2UI can't address`)
    return `/${path.split('.').join('/')}`
  }

  /** A prop value as an A2UI dynamic value, or undefined (and a loss) when it has none. */
  const dynamic = (value: Value | undefined, scopes: string[], nodeId: string, key: string): A2uiDynamic | undefined => {
    if (value === undefined || value === null) return undefined
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    if (isExpr(value) && typeof value.$bind === 'string') return { '@path': pointer(value.$bind, scopes, nodeId) }
    if (isExpr(value) && typeof value.$template === 'string') {
      const template = value.$template.replace(/\{([^{}]+)\}/g, (_, path: string) => `\${${pointer(path.trim(), scopes, nodeId)}}`)
      return { '@call': 'formatString', 'args': { value: template } }
    }
    lose(nodeId, 'binding', `${key}: ${JSON.stringify(value)}`)
    return undefined
  }

  /** The A2UI action of a node's click: a runAction step becomes an event named after the action. */
  const clickAction = (node: ModelNode, handled: Set<number>): A2uiAction | undefined => {
    const index = (node.interactions ?? []).findIndex(interaction => interaction.on === 'click')
    if (index < 0) return undefined
    const steps = node.interactions![index]!.do
    const run = steps.find(step => step.kind === 'runAction')
    if (!run || typeof run.action !== 'string') return undefined
    handled.add(index)
    const rest = steps.filter(step => step !== run || run.args !== undefined)
    if (rest.length) lose(node.id, 'interaction', `click: ${rest.map(step => step === run ? 'runAction args' : step.kind).join(', ')}`)
    return { event: { name: run.action } }
  }

  /** The id of one component holding `children`: the only child, or a Column wrapping them. */
  const single = (node: ModelNode, suffix: string, scopes: string[]): string => {
    const children = node.children ?? []
    if (children.length === 1) return emit(children[0]!, scopes) ?? emitEmpty(node, suffix)
    const id = fresh(`${node.id}_${suffix}`)
    const slot = out.length
    out.push({ id, component: 'Column', children: [] })
    out[slot]!.children = children.map(child => emit(child, scopes)).filter((child): child is string => child !== undefined)
    return id
  }
  const emitEmpty = (node: ModelNode, suffix: string): string => {
    const id = fresh(`${node.id}_${suffix}`)
    out.push({ id, component: 'Column', children: [] })
    return id
  }
  const textLabel = (node: ModelNode, text: A2uiDynamic): string => {
    const id = fresh(`${node.id}_label`)
    out.push({ id, component: 'Text', text })
    return id
  }

  /** Emits `node` (and its subtree), returning its A2UI id; undefined when A2UI has no counterpart. */
  const emit = (node: ModelNode, scopes: string[], isRoot = false): string | undefined => {
    const id = isRoot ? 'root' : fresh(node.id)
    const props: Record<string, Value> = { ...node.props }
    const style: Record<string, string> = { ...node.style }
    const handled = new Set<number>()
    const take = (key: string): Value | undefined => {
      const value = props[key]
      Reflect.deleteProperty(props, key)
      return value
    }
    const takeStyle = (key: string, map: Record<string, string>): string | undefined => {
      const value = style[key]
      if (value === undefined || map[value] === undefined) return undefined
      Reflect.deleteProperty(style, key)
      return map[value]
    }
    const component: A2uiComponent = { id, component: '' }
    const slot = out.length
    const set = (key: string, value: unknown) => {
      if (value !== undefined) component[key] = value
    }
    const flex = () => {
      set('justify', takeStyle('justify', JUSTIFY))
      set('align', takeStyle('items', ALIGN))
    }
    const children = (list: ModelNode[] = node.children ?? [], inner = scopes) =>
      list.map(child => emit(child, inner)).filter((child): child is string => child !== undefined)

    switch (node.type) {
      case 'Row':
        component.component = 'Row'
        out.push(component)
        flex()
        component.children = children()
        break
      case 'Card':
        component.component = 'Card'
        out.push(component)
        component.child = single(node, 'body', scopes)
        break
      case 'Heading': {
        component.component = 'Text'
        out.push(component)
        const level = take('level')
        const hashes = '#'.repeat(typeof level === 'number' && level >= 1 && level <= 6 ? level : 2)
        const text = dynamic(take('text'), scopes, node.id, 'text')
        if (typeof text === 'string') component.text = `${hashes} ${text}`
        else if (text !== undefined && typeof text === 'object' && '@path' in text) component.text = { '@call': 'formatString', 'args': { value: `${hashes} \${${text['@path']}}` } }
        else if (text !== undefined && typeof text === 'object') component.text = { '@call': 'formatString', 'args': { value: `${hashes} ${String(text.args?.value ?? '')}` } }
        else component.text = hashes
        break
      }
      case 'Text':
        component.component = 'Text'
        out.push(component)
        component.text = dynamic(take('text'), scopes, node.id, 'text') ?? ''
        break
      case 'Image':
        component.component = 'Image'
        out.push(component)
        component.url = dynamic(take('src'), scopes, node.id, 'src') ?? ''
        set('description', dynamic(take('alt'), scopes, node.id, 'alt'))
        break
      case 'Button': {
        component.component = 'Button'
        out.push(component)
        component.child = textLabel(node, dynamic(take('text'), scopes, node.id, 'text') ?? '')
        const href = take('href')
        component.action = typeof href === 'string'
          ? { functionCall: { '@call': 'openUrl', 'args': { url: href } } }
          : clickAction(node, handled) ?? { event: { name: node.id } }
        break
      }
      case 'Link': {
        component.component = 'Button'
        component.variant = 'borderless'
        out.push(component)
        const text = take('text')
        take('icon')
        component.child = node.children?.length ? single(node, 'content', scopes) : textLabel(node, dynamic(text, scopes, node.id, 'text') ?? '')
        const href = take('href')
        const to = take('to')
        if (typeof href === 'string') component.action = { functionCall: { '@call': 'openUrl', 'args': { url: href } } }
        else if (isExpr(to) && typeof to.page === 'string') {
          component.action = { event: { name: 'navigate', context: { page: to.page } } }
          if (to.params) lose(node.id, 'prop', 'to.params')
        } else component.action = { event: { name: node.id } }
        break
      }
      case 'Input': {
        component.component = 'TextField'
        out.push(component)
        component.label = dynamic(take('label'), scopes, node.id, 'label') ?? ''
        const field = take('field')
        component.value = typeof field === 'string' ? { '@path': `/form/${field}` } : ''
        set('placeholder', dynamic(take('placeholder'), scopes, node.id, 'placeholder'))
        if (take('multiline') === true) component.variant = 'longText'
        break
      }
      case 'Checkbox': {
        component.component = 'CheckBox'
        out.push(component)
        component.label = dynamic(take('label'), scopes, node.id, 'label') ?? ''
        const field = take('field')
        component.value = typeof field === 'string' ? { '@path': `/form/${field}` } : dynamic(take('value'), scopes, node.id, 'value') ?? false
        break
      }
      case 'List': {
        component.component = 'List'
        out.push(component)
        const items = take('items')
        const as = take('as')
        const name = typeof as === 'string' ? as : 'item'
        if (isExpr(items) && typeof items.$bind === 'string') {
          component.children = { path: pointer(items.$bind, scopes, node.id), componentId: single(node, 'item', [...scopes, name]) }
        } else {
          lose(node.id, 'binding', `items: ${JSON.stringify(items)}`)
          component.children = []
        }
        break
      }
      case 'Instance': {
        const file = byComponentId.get(String(take('component')))
        if (!file) {
          lose(node.id, 'node', 'An Instance needs the project components: left out')
          return undefined
        }
        component.component = file.name
        if (options.projectCatalogId) component['@catalogId'] = options.projectCatalogId
        out.push(component)
        const values = take('values')
        for (const [propertyId, value] of Object.entries(isExpr(values) ? values : {})) {
          const property = file.properties.find(candidate => candidate.id === propertyId)
          if (property) set(property.name, dynamic(value as Value, scopes, node.id, property.name))
        }
        if (take('variant') !== undefined) lose(node.id, 'prop', 'variant')
        for (const fill of node.children ?? []) {
          const property = file.properties.find(candidate => candidate.id === fill.props?.slot)
          if (property) component[property.name] = children(fill.children)
        }
        break
      }
      default: {
        if (!(node.type in AS_COLUMN)) {
          lose(node.id, 'node', `${node.type} has no A2UI component: left out`)
          return undefined
        }
        component.component = 'Column'
        out.push(component)
        const why = AS_COLUMN[node.type]
        if (why) lose(node.id, 'node', why)
        if (node.type === 'Form') {
          take('action')
          take('fields')
        }
        if (node.type === 'SlotFill') take('slot')
        flex()
        component.children = children()
      }
    }

    // The component goes out before its children (streaming order), so its props were filled in place.
    out[slot] = component
    const leftProps = Object.keys(props)
    if (leftProps.length) lose(node.id, 'prop', leftProps.join(', '))
    const leftStyle = Object.keys(style)
    if (leftStyle.length) lose(node.id, 'style', leftStyle.join(', '))
    const leftInteractions = (node.interactions ?? []).filter((_, index) => !handled.has(index))
    if (leftInteractions.length) lose(node.id, 'interaction', leftInteractions.map(interaction => `${interaction.on}: ${interaction.do.map(step => step.kind).join(', ')}`).join('; '))
    return id
  }

  emit(root, [], true)
  return {
    message: { version: A2UI_VERSION, createSurface: { surfaceId: options.surfaceId, catalogId: BASIC_CATALOG_ID, components: out } },
    lost
  }
}
