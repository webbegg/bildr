import type { PropDef, PropKind, PropValue } from '../document/components'

/**
 * How the inspector groups a component's props: what it says (Content),
 * what it does (Behaviour), how it looks (Appearance), then the rest
 * (Advanced). A prop's name decides first, then its kind. The order follows
 * the node: an actionable one (a Button or Link, or anything with an action
 * or a link-to prop) leads with Behaviour, as Framer puts Link first.
 */

export const PROP_GROUPS = ['Content', 'Behaviour', 'Appearance', 'Advanced'] as const

export type PropGroup = typeof PROP_GROUPS[number]

const BY_NAME: Record<string, PropGroup> = {
  text: 'Content', label: 'Content', message: 'Content', successMessage: 'Content', placeholder: 'Content', alt: 'Content',
  action: 'Behaviour', inputType: 'Behaviour', limit: 'Behaviour', sortField: 'Behaviour', sortDir: 'Behaviour',
  filterField: 'Behaviour', filterValue: 'Behaviour', loadMore: 'Behaviour', resetOnSuccess: 'Behaviour',
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

const ACTIONABLE_TYPES = ['Button', 'Link']
const LINK_PROPS = ['to', 'href']

/** Whether a node mainly does something when clicked: its Behaviour (action, link) comes first. */
export function isActionable(defs: PropDef[], type?: string): boolean {
  return (!!type && ACTIONABLE_TYPES.includes(type)) || defs.some(def => def.name === 'action' || (def.kind === 'link' && LINK_PROPS.includes(def.name)))
}

/** The group order for a node: Behaviour first on an actionable one. */
export function propGroupOrder(defs: PropDef[], type?: string): readonly PropGroup[] {
  return isActionable(defs, type) ? ['Behaviour', 'Content', 'Appearance', 'Advanced'] : PROP_GROUPS
}

/** The non-empty groups in the node's order (see `propGroupOrder`), each keeping the component's prop order. */
export function groupedProps(defs: PropDef[], type?: string): { group: PropGroup, props: PropDef[] }[] {
  return propGroupOrder(defs, type)
    .map(group => ({ group, props: defs.filter(def => propGroup(def) === group) }))
    .filter(entry => entry.props.length)
}

/** One-line explanations of the select options that need one, by prop name, then option. */
const OPTION_HINTS: Record<string, Record<string, string>> = {
  action: { link: 'Opens the Link to page or URL', submit: 'Sends the enclosing Form', toast: 'Shows the toast message' },
  inputType: { text: 'Any text', email: 'Checks for an email address', number: 'Numbers only', password: 'Hides what is typed' },
  layout: { stack: 'One record under another', grid: 'Records in columns (the Columns token)', row: 'Records side by side' }
}

/** A select prop's options as menu items, with a description where the option needs explaining (a two-line item). */
export function propOptions(def: PropDef): { label: string, value: string, description?: string }[] {
  const hints = OPTION_HINTS[def.name] ?? {}
  return (def.options ?? []).map(value => (hints[value] ? { label: value, value, description: hints[value] } : { label: value, value }))
}

/** Whether a node's props leave `def` at the component default (unset counts as the default). */
export function isDefaultProp(def: PropDef, props: Record<string, PropValue>): boolean {
  return props[def.name] === undefined || props[def.name] === def.default
}
