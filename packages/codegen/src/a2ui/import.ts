import type { ComponentFile, ModelNode, Value } from '../model/schemas.ts'
import { isCall, isPath } from './wire.ts'
import type { A2uiComponent } from './wire.ts'

/**
 * An A2UI v1.0 surface (Basic Catalog) as a bildr tree: the flat list is nested
 * from `root`, paths become `$bind` dot paths, a List template becomes a List
 * with `as`, and a Button event becomes a runAction step when it names one of
 * the page's actions (its context the step's args). A project component (by
 * name) becomes an Instance, its slots SlotFills. Components bildr has no node
 * for are left out with a warning. Ids are kept (a caller inserting the tree gives it fresh ones).
 */

export interface A2uiImportWarning {
  componentId: string
  message: string
}

export interface FromA2uiOptions {
  /** The action ids an event may name (`act_publish_post`); other events are left out. */
  actions?: readonly string[]
  /** The project's components: a surface component of one's name becomes an Instance of it. */
  components?: readonly ComponentFile[]
}

export interface FromA2uiResult {
  root: ModelNode
  warnings: A2uiImportWarning[]
}

const JUSTIFY: Record<string, string> = { start: 'start', center: 'center', end: 'end', spaceBetween: 'between', spaceAround: 'around', spaceEvenly: 'evenly', stretch: 'stretch' }
const ALIGN: Record<string, string> = { start: 'start', center: 'center', end: 'end', stretch: 'stretch' }
const HEADING = /^(#{1,6}) ([\s\S]*)$/

export const fromA2ui = (components: readonly A2uiComponent[], options: FromA2uiOptions = {}): FromA2uiResult => {
  const byId = new Map(components.map(component => [component.id, component]))
  const warnings: A2uiImportWarning[] = []
  const actions = new Set(options.actions ?? [])
  const projectComponents = new Map((options.components ?? []).map(component => [component.name, component]))
  const warn = (componentId: string, message: string) => warnings.push({ componentId, message })
  const visiting = new Set<string>()

  /** A JSON Pointer as a dot path: a relative one reads the innermost List item. */
  const dotPath = (pointer: string, scopes: string[]): string => {
    const segments = pointer.split('/').filter(Boolean)
    if (pointer.startsWith('/')) return segments.join('.')
    const item = scopes.at(-1) ?? 'item'
    return [item, ...segments].join('.')
  }

  const value = (dynamic: unknown, scopes: string[], componentId: string): Value | undefined => {
    if (dynamic === undefined) return undefined
    if (typeof dynamic === 'string' || typeof dynamic === 'number' || typeof dynamic === 'boolean') return dynamic
    if (isPath(dynamic)) return { $bind: dotPath(dynamic['@path'], scopes) }
    if (isCall(dynamic) && dynamic['@call'] === 'formatString' && typeof dynamic.args?.value === 'string') {
      const template = dynamic.args.value
      const whole = /^\$\{([^{}]+)\}$/.exec(template)
      if (whole) return { $bind: dotPath(whole[1]!, scopes) }
      return { $template: template.replace(/\$\{([^{}]+)\}/g, (_, path: string) => `{${dotPath(path, scopes)}}`) }
    }
    warn(componentId, `${JSON.stringify(dynamic)} has no bildr expression: left out`)
    return undefined
  }

  const props = (entries: Record<string, Value | undefined>): Record<string, Value> | undefined => {
    const kept = Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry !== undefined)) as Record<string, Value>
    return Object.keys(kept).length ? kept : undefined
  }

  const node = (id: string, type: string, nodeProps?: Record<string, Value>, extra: Partial<ModelNode> = {}): ModelNode => {
    const built: ModelNode = { id, type }
    if (nodeProps) built.props = nodeProps
    return Object.assign(built, extra)
  }

  const childList = (ids: unknown, scopes: string[]): ModelNode[] =>
    (Array.isArray(ids) ? ids : []).map(id => build(String(id), scopes)).filter((child): child is ModelNode => child !== undefined)

  /** A Button's label: the text of its Text child. */
  const label = (childId: unknown, scopes: string[], componentId: string): Value | undefined => {
    const child = byId.get(String(childId))
    if (child?.component === 'Text') return value(child.text, scopes, child.id)
    warn(componentId, 'Only a Text child becomes a button label: left out')
    return undefined
  }

  const flexStyle = (component: A2uiComponent): Record<string, string> | undefined => {
    const style: Record<string, string> = {}
    if (typeof component.justify === 'string' && JUSTIFY[component.justify]) style.justify = JUSTIFY[component.justify]!
    if (typeof component.align === 'string' && ALIGN[component.align]) style.items = ALIGN[component.align]!
    return Object.keys(style).length ? style : undefined
  }

  const build = (id: string, scopes: string[]): ModelNode | undefined => {
    const component = byId.get(id)
    if (!component) {
      warn(id, 'Not defined: left out')
      return undefined
    }
    if (visiting.has(id)) {
      warn(id, 'Is its own ancestor: left out')
      return undefined
    }
    visiting.add(id)
    try {
      switch (component.component) {
        case 'Column':
        case 'Row': {
          const built = node(id, component.component)
          const style = flexStyle(component)
          if (style) built.style = style
          if (Array.isArray(component.children)) built.children = childList(component.children, scopes)
          else if (component.children) return list(component, scopes, component.component)
          else built.children = []
          return built
        }
        case 'List':
          if (Array.isArray(component.children)) return node(id, 'Column', undefined, { children: childList(component.children, scopes) })
          return list(component, scopes, 'List')
        case 'Card':
          return node(id, 'Card', undefined, { children: childList([component.child], scopes) })
        case 'Text': {
          const text = value(component.text, scopes, id)
          if (typeof text === 'string') {
            const heading = HEADING.exec(text)
            if (heading) return node(id, 'Heading', { level: heading[1]!.length, text: heading[2]! })
          }
          const template = typeof text === 'object' && text !== null && !Array.isArray(text) ? (text as Record<string, unknown>).$template : undefined
          if (typeof template === 'string') {
            const heading = HEADING.exec(template)
            if (heading) {
              const bound = /^\{([^{}]+)\}$/.exec(heading[2]!)
              return node(id, 'Heading', { level: heading[1]!.length, text: bound ? { $bind: bound[1]! } : { $template: heading[2]! } })
            }
          }
          return node(id, 'Text', props({ text }))
        }
        case 'Image':
          return node(id, 'Image', props({ src: value(component.url, scopes, id), alt: value(component.description, scopes, id) }))
        case 'Button':
          return button(component, scopes)
        case 'TextField': {
          const bound = isPath(component.value) ? component.value['@path'] : undefined
          const field = bound?.startsWith('/form/') ? bound.slice('/form/'.length) : undefined
          if (!field) warn(id, 'A TextField becomes an Input of a Form field (/form/<field id>): its value binding is left out')
          return node(id, 'Input', props({
            label: value(component.label, scopes, id),
            field,
            placeholder: value(component.placeholder, scopes, id),
            multiline: component.variant === 'longText' ? true : undefined
          }))
        }
        case 'CheckBox': {
          const bound = isPath(component.value) ? component.value['@path'] : undefined
          if (bound?.startsWith('/form/')) return node(id, 'Checkbox', props({ label: value(component.label, scopes, id), field: bound.slice('/form/'.length) }))
          return node(id, 'Checkbox', props({ label: value(component.label, scopes, id), value: value(component.value, scopes, id) }))
        }
        default: {
          const file = projectComponents.get(component.component)
          if (file) return instance(component, file, scopes)
          warn(id, `${component.component} has no bildr node type: left out`)
          return undefined
        }
      }
    } finally {
      visiting.delete(id)
    }
  }

  const list = (component: A2uiComponent, scopes: string[], type: string): ModelNode | undefined => {
    const template = component.children as { path?: unknown, componentId?: unknown }
    if (typeof template.path !== 'string' || typeof template.componentId !== 'string') {
      warn(component.id, 'A child template needs a path and a componentId: left out')
      return undefined
    }
    const as = scopes.length ? `item${scopes.length + 1}` : 'item'
    const items = { $bind: dotPath(template.path, scopes) }
    const child = build(template.componentId, [...scopes, as])
    const built = node(component.id, 'List', { items, as }, { children: child ? [child] : [] })
    if (type !== 'List') warn(component.id, `A ${type} with a child template becomes a List`)
    return built
  }

  /** A project component: its values by property id, each slot a SlotFill of the components it lists. */
  const instance = (component: A2uiComponent, file: ComponentFile, scopes: string[]): ModelNode => {
    const values: Record<string, Value> = {}
    const fills: ModelNode[] = []
    for (const property of file.properties) {
      const given = component[property.name]
      if (given === undefined) continue
      if (property.kind === 'slot') {
        if (!Array.isArray(given)) warn(component.id, `${property.name}: only a list of ids fills a slot: left out`)
        else fills.push(node(`${component.id}_${property.name}`, 'SlotFill', { slot: property.id }, { children: childList(given, scopes) }))
        continue
      }
      const converted = value(given, scopes, component.id)
      if (converted !== undefined) values[property.id] = converted
    }
    const known = new Set(['id', 'component', '@catalogId', ...file.properties.map(property => property.name)])
    const unknown = Object.keys(component).filter(key => !known.has(key))
    if (unknown.length) warn(component.id, `${file.name} has no ${unknown.join(', ')}: left out`)
    return node(component.id, 'Instance', { component: file.id, values }, fills.length ? { children: fills } : {})
  }

  /** An event context as the args of a runAction step. */
  const args = (context: Record<string, unknown> | undefined, scopes: string[], componentId: string): Record<string, Value> | undefined => {
    if (!context || !Object.keys(context).length) return undefined
    return props(Object.fromEntries(Object.entries(context).map(([key, entry]) => [key, value(entry, scopes, componentId)])))
  }

  const button = (component: A2uiComponent, scopes: string[]): ModelNode => {
    const id = component.id
    const text = label(component.child, scopes, id)
    const action = component.action as { event?: { name?: unknown, context?: Record<string, unknown> }, functionCall?: { '@call'?: unknown, 'args'?: Record<string, unknown> } } | undefined
    const link = component.variant === 'borderless'
    if (action?.functionCall?.['@call'] === 'openUrl' && typeof action.functionCall.args?.url === 'string') {
      return node(id, link ? 'Link' : 'Button', props({ text, href: action.functionCall.args.url }))
    }
    const name = action?.event?.name
    if (name === 'navigate' && typeof action?.event?.context?.page === 'string') {
      return node(id, 'Link', props({ text, to: { page: action.event.context.page } }))
    }
    const built = node(id, 'Button', props({ text }))
    if (typeof name === 'string' && actions.has(name)) {
      const given = args(action?.event?.context, scopes, id)
      built.interactions = [{ on: 'click', do: [{ kind: 'runAction', action: name, ...(given ? { args: given } : {}) }] }]
    } else if (typeof name === 'string') warn(id, `Event "${name}" is not an action of the page: left out`)
    else if (action) warn(id, 'Only an event or openUrl becomes a bildr interaction: left out')
    return built
  }

  const root = build('root', [])
  if (!root) {
    warn('root', 'No usable root: an empty Column instead')
    return { root: { id: 'root', type: 'Column', children: [] }, warnings }
  }
  return { root, warnings }
}
