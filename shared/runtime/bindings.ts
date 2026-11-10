import type { DataRecord, RecordValue } from '../data/records'
import type { EnvValues } from '../env/variables'

/**
 * `{{ item.<field> }}` bindings in string props, resolved per record inside
 * a List, and `{{ env.NAME }}` project variables (public ones only in the
 * browser). Any other `{{ … }}` stays literal so a typo shows up on the
 * page instead of vanishing.
 */

/** A record as bindings see it: its values plus `id`, `createdAt` and `updatedAt`. */
export type BindingItem = Record<string, RecordValue | undefined>

export interface BindingScope {
  /** The current record; item bindings render empty without one. */
  item?: BindingItem | null
  /** Public variables; without them env refs stay as written. */
  env?: EnvValues
  /** A name missing from `env`: kept as written (the editor, the default) or rendered empty (published apps). */
  onMissingEnv?: 'keep' | 'empty'
}

const BINDING = /\{\{\s*item\.([A-Za-z_]\w*)\s*\}\}/g
const ANY_BINDING = /\{\{\s*(item|env)\.([A-Za-z_]\w*)\s*\}\}/g

export function hasBindings(value: string): boolean {
  return new RegExp(BINDING.source).test(value)
}

/**
 * Replaces each item binding with the record value as a string, or '' when
 * missing or null, and each env ref with the scope's variable (see
 * `BindingScope`). One pass, so values are never resolved again.
 */
export function resolveBindings(value: string, scope: BindingScope): string {
  if (!value.includes('{{')) return value
  return value.replace(ANY_BINDING, (ref, kind: string, key: string) => {
    if (kind === 'env') {
      const env = scope.env
      if (!env) return ref
      if (Object.hasOwn(env, key)) return env[key]!
      return scope.onMissingEnv === 'empty' ? '' : ref
    }
    const item = scope.item
    const resolved = item && Object.hasOwn(item, key) ? item[key] : undefined
    return resolved === undefined || resolved === null ? '' : String(resolved)
  })
}

export function bindingItem(record: DataRecord): BindingItem {
  return { ...record.values, id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt }
}
