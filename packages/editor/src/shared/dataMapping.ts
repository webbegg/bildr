import type { Row } from '@bildr/codegen/query'
import type { DataField, FieldType } from './dataModel.ts'

/**
 * The mapping of a REST response to an entity's fields: the rows of the hosted `DataMappingTable`
 * (`include`, key, type, path) over the model's field `name` and `remote` key (a top-level key of
 * each item: the generated adapter reads one key per field), and the preview of the first items.
 * Editing the mapping of an existing entity becomes `entity_field_*` steps (`fieldSteps`).
 */

/** One field of a mapping: whether it is kept, and its name, type and the key it is read from in each item. */
export interface MappingRow {
  include: boolean
  /** The saved field's id, when the row is one the entity has. */
  id?: string
  name: string
  type: FieldType
  remote: string
}

/** A field `datasource_preview` proposes. */
export interface InferredField {
  name: string
  type: FieldType
  remote: string
}

export const mappingRow = (field: InferredField): MappingRow => ({ include: true, name: field.name, type: field.type, remote: field.remote })

export const mappingRowOf = (field: DataField): MappingRow => ({ include: true, id: field.id, name: field.name, type: field.type, remote: field.remote ?? field.name })

const FIELD_NAME = /^[a-z][A-Za-z0-9]*$/

/** Why each row cannot be saved, `''` when it can (or is left out). */
export function mappingProblems(rows: MappingRow[]): string[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    if (!row.include) return ''
    const name = row.name.trim()
    if (!name) return 'Add a name'
    if (!FIELD_NAME.test(name)) return 'Use letters and digits, starting with a lowercase letter, like servedFrom'
    if (seen.has(name)) return `"${name}" is used twice`
    seen.add(name)
    const remote = row.remote.trim()
    if (!remote) return 'Add the key of the field in each item'
    if (remote.includes('.')) return 'Map a top-level key of each item, not a path like origin.name'
    return ''
  })
}

/** The included rows as the fields `entity_create` takes. */
export const mappingFields = (rows: MappingRow[]): InferredField[] =>
  rows.filter(row => row.include).map(row => ({ name: row.name.trim(), type: row.type, remote: row.remote.trim() }))

/** The first items mapped with the fields being edited: each field reads its remote key. */
export function mapPreview(items: unknown[], rows: MappingRow[]): Row[] {
  const included = rows.filter(row => row.include)
  return items.map((item) => {
    const source = typeof item === 'object' && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : {}
    return Object.fromEntries(included.map(row => [row.name.trim(), source[row.remote.trim()] ?? null]))
  })
}

export type FieldStep
  = | { name: 'entity_field_remove', input: { entity: string, field: string } }
    | { name: 'entity_field_update', input: { entity: string, field: string, name?: string, type?: FieldType, remote?: string } }
    | { name: 'entity_field_add', input: { entity: string, name: string, type: FieldType, remote: string } }

/** The edits that turn the entity's saved fields into the mapping: removals, then changes, then fields added by hand. */
export function fieldSteps(entity: string, saved: DataField[], rows: MappingRow[]): FieldStep[] {
  const removes: FieldStep[] = []
  const updates: FieldStep[] = []
  const adds: FieldStep[] = []
  for (const row of rows) {
    const current = saved.find(field => field.id === row.id)
    if (!current) {
      if (row.include) adds.push({ name: 'entity_field_add', input: { entity, name: row.name.trim(), type: row.type, remote: row.remote.trim() } })
      continue
    }
    if (!row.include) {
      removes.push({ name: 'entity_field_remove', input: { entity, field: current.id } })
      continue
    }
    const name = row.name.trim()
    const remote = row.remote.trim()
    const changed = {
      ...(name !== current.name ? { name } : {}),
      ...(row.type !== current.type ? { type: row.type } : {}),
      ...(remote !== (current.remote ?? current.name) ? { remote } : {})
    }
    if (Object.keys(changed).length) updates.push({ name: 'entity_field_update', input: { entity, field: current.id, ...changed } })
  }
  return [...removes, ...updates, ...adds]
}
