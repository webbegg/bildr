import type { PropDef, PropKind, PropValue } from '../document/components'

/**
 * How the inspector groups a component's props: what it says (Content),
 * what it does (Behaviour), how it looks (Appearance), then the rest
 * (Advanced). A prop's name decides first, then its kind.
 */

export const PROP_GROUPS = ['Content', 'Behaviour', 'Appearance', 'Advanced'] as const

export type PropGroup = typeof PROP_GROUPS[number]

const BY_NAME: Record<string, PropGroup> = {
  text: 'Content', label: 'Content', message: 'Content', successMessage: 'Content', placeholder: 'Content', alt: 'Content',
  action: 'Behaviour', inputType: 'Behaviour', limit: 'Behaviour', sortField: 'Behaviour', sortDir: 'Behaviour',
  filterField: 'Behaviour', filterValue: 'Behaviour', resetOnSuccess: 'Behaviour',
  variant: 'Appearance', color: 'Appearance', size: 'Appearance', level: 'Appearance', layout: 'Appearance', wrap: 'Appearance'
}

const BY_KIND: Partial<Record<PropKind, PropGroup>> = {
  textarea: 'Content', image: 'Content',
  link: 'Behaviour', collection: 'Behaviour', field: 'Behaviour',
  icon: 'Appearance'
}

export function propGroup(def: PropDef): PropGroup {
  return BY_NAME[def.name] ?? BY_KIND[def.kind] ?? 'Advanced'
}

/** The non-empty groups in panel order, each keeping the component's prop order. */
export function groupedProps(defs: PropDef[]): { group: PropGroup, props: PropDef[] }[] {
  return PROP_GROUPS
    .map(group => ({ group, props: defs.filter(def => propGroup(def) === group) }))
    .filter(entry => entry.props.length)
}

/** Whether a node's props leave `def` at the component default (unset counts as the default). */
export function isDefaultProp(def: PropDef, props: Record<string, PropValue>): boolean {
  return props[def.name] === undefined || props[def.name] === def.default
}
