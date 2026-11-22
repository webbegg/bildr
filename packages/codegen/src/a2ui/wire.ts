/**
 * The slice of the A2UI v1.0 wire format this spike reads and writes
 * (https://github.com/a2ui-project/a2ui, `specification/v1_0/`): a surface's
 * flat component list, its dynamic values and the `createSurface` message.
 * Spike code: not exported from the package yet.
 */

export const A2UI_VERSION = '1.0'
export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'

export type A2uiPath = { '@path': string }
export type A2uiCall = { '@call': string, 'args'?: Record<string, unknown> }
export type A2uiDynamic = string | number | boolean | A2uiPath | A2uiCall
export type A2uiChildList = string[] | { path: string, componentId: string }
export type A2uiAction = { event: { name: string, context?: Record<string, unknown> } } | { functionCall: A2uiCall }

/** One entry of a surface's flat component list: `{ id, component, ...props }`. */
export interface A2uiComponent {
  id: string
  component: string
  [prop: string]: unknown
}

export interface A2uiCreateSurface {
  version: typeof A2UI_VERSION
  createSurface: { surfaceId: string, catalogId: string, components: A2uiComponent[] }
}

export const isPath = (value: unknown): value is A2uiPath =>
  typeof value === 'object' && value !== null && typeof (value as A2uiPath)['@path'] === 'string'
export const isCall = (value: unknown): value is A2uiCall =>
  typeof value === 'object' && value !== null && typeof (value as A2uiCall)['@call'] === 'string'

/** Identifiers: the catalog guide's UAX #31 rule, which also applies to component ids. */
export const UAX31_ID = /^[\p{XID_Start}_][\p{XID_Continue}]*$/u

/** The ids a component references: `child`, `children`, a template's `componentId`, a Modal's `trigger`/`content`, a Tab's `child`. */
export const referencedIds = (component: A2uiComponent): string[] => {
  const ids: string[] = []
  for (const key of ['child', 'trigger', 'content']) if (typeof component[key] === 'string') ids.push(component[key])
  const children = component.children
  if (Array.isArray(children)) ids.push(...children.filter((id): id is string => typeof id === 'string'))
  else if (children && typeof children === 'object' && typeof (children as { componentId?: unknown }).componentId === 'string') ids.push((children as { componentId: string }).componentId)
  if (Array.isArray(component.tabs)) for (const tab of component.tabs) if (typeof tab?.child === 'string') ids.push(tab.child)
  return ids
}

export interface SurfaceError {
  componentId?: string
  message: string
}

/**
 * The structural checks a renderer makes before it draws a surface: UAX #31 and
 * unique ids, references that resolve, and a `root`. Not a JSON Schema check of
 * each component's props.
 */
export const checkSurface = (components: A2uiComponent[]): SurfaceError[] => {
  const errors: SurfaceError[] = []
  const ids = new Set<string>()
  for (const component of components) {
    if (!UAX31_ID.test(component.id)) errors.push({ componentId: component.id, message: `Id "${component.id}" is not a UAX #31 identifier` })
    if (ids.has(component.id)) errors.push({ componentId: component.id, message: `Id "${component.id}" is defined twice` })
    ids.add(component.id)
  }
  for (const component of components) {
    for (const ref of referencedIds(component)) {
      if (!ids.has(ref)) errors.push({ componentId: component.id, message: `Component "${component.id}" references "${ref}", which is not defined` })
    }
  }
  if (!ids.has('root')) errors.push({ message: 'No component has id "root"' })
  return errors
}
