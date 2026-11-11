import type { PropertyDef } from '../document/schema'
import { isStyleBinding } from '../document/schema'

/**
 * Human labels for component properties and layout variables, Framer's
 * "Text", "Toggle", "Option": a property row's label says what it sets,
 * never the raw kind (`select`). A style property names its style key.
 */

const KIND_LABELS: Record<PropertyDef['kind'], string> = {
  text: 'Text',
  textarea: 'Text',
  number: 'Number',
  boolean: 'Toggle',
  select: 'Option',
  link: 'Link',
  image: 'Image',
  icon: 'Icon',
  collection: 'Collection',
  field: 'Field',
  slot: 'Slot'
}

export function propertyLabel(property: Pick<PropertyDef, 'kind' | 'bindings'>): string {
  const binding = property.bindings[0]
  if (property.kind !== 'slot' && binding && isStyleBinding(binding)) return `Style · ${binding.prop}`
  return KIND_LABELS[property.kind]
}

/** A bound node in a tooltip: its type, or its layer name with the type (`Footer (Container)`). */
export function targetLabel(node: { type: string, name?: string }): string {
  return node.name ? `${node.name} (${node.type})` : node.type
}
