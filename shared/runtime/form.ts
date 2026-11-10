import type { RecordValue } from '../data/records'
import type { ComponentDefinition, DocNode, Field, FieldType } from '../document/schema'
import { findNode, pathTo } from '../document/tree'
import { walkResolved } from './instances'

/**
 * Forms: a Form node adds a record to its collection; each Input inside it
 * names the field it fills (`field`), and renders as a form control with
 * that name, so a submit reads the values from the form's entries.
 */

export const FORM_TYPE = 'Form'

/** Field → value from a form's entries (e.g. `new FormData(form)`); unnamed and non-text entries are skipped. */
export function formValues(entries: Iterable<[string, unknown]>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [field, value] of entries) {
    if (field && typeof value === 'string') values[field] = value
  }
  return values
}

/** The fields the Inputs inside `form` fill (those of component instances too), in document order, once each. */
export function formFields(form: DocNode, components: ComponentDefinition[] = []): string[] {
  const fields = new Set<string>()
  walkResolved(form, components, (node) => {
    if (node.type === 'Input' && typeof node.props.field === 'string' && node.props.field) fields.add(node.props.field)
  })
  return [...fields]
}

/** The nearest Form above node `id` (not the node itself), if any. */
export function enclosingForm(root: DocNode, id: string): DocNode | undefined {
  const ancestors = pathTo(root, id).slice(0, -1).reverse()
  for (const ancestorId of ancestors) {
    const node = findNode(root, ancestorId)
    if (node?.type === FORM_TYPE) return node
  }
  return undefined
}

const SAMPLES: Record<FieldType, (field: Field, now: Date) => RecordValue> = {
  text: field => `Test ${field.label.toLowerCase()}`,
  number: () => 1,
  boolean: () => true,
  date: (_field, now) => now.toISOString().slice(0, 10),
  image: () => 'https://placehold.co/600x400'
}

/** A value of the right type for each field (only `keys`, when given), for the editor's test submit. */
export function sampleValues(fields: Field[], now: Date, keys?: string[]): Record<string, RecordValue> {
  const chosen = keys ? fields.filter(f => keys.includes(f.key)) : fields
  return Object.fromEntries(chosen.map(field => [field.key, SAMPLES[field.type](field, now)]))
}
