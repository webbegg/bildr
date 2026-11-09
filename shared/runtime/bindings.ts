import type { DataRecord, RecordValue } from '../data/records'

/**
 * `{{ item.<field> }}` bindings in string props, resolved per record inside
 * a List. Only `item.*` placeholders are bindings; any other `{{ … }}` stays
 * literal so a typo shows up on the page instead of vanishing.
 */

/** A record as bindings see it: its values plus `id`, `createdAt` and `updatedAt`. */
export type BindingItem = Record<string, RecordValue | undefined>

export interface BindingScope {
  /** The current record; item bindings render empty without one. */
  item?: BindingItem | null
}

const BINDING = /\{\{\s*item\.([A-Za-z_]\w*)\s*\}\}/g

export function hasBindings(value: string): boolean {
  return new RegExp(BINDING.source).test(value)
}

/** Replaces each item binding with the record value as a string, or '' when missing or null. */
export function resolveBindings(value: string, scope: BindingScope): string {
  if (!value.includes('{{')) return value
  return value.replace(BINDING, (_, key: string) => {
    const item = scope.item
    const resolved = item && Object.hasOwn(item, key) ? item[key] : undefined
    return resolved === undefined || resolved === null ? '' : String(resolved)
  })
}

export function bindingItem(record: DataRecord): BindingItem {
  return { ...record.values, id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt }
}
