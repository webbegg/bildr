import type { InjectionKey } from 'vue'
import type { DataRecord } from '#shared/data/records'
import type { EnvValues } from '#shared/env/variables'
import { resolveEnv } from '#shared/env/variables'
import type { BindingItem } from '#shared/runtime/bindings'
import { resolveBindings } from '#shared/runtime/bindings'

export interface RuntimeContext {
  /** Path prefix that page-slug links resolve under, e.g. `/p/shop`. */
  base: string
  /** True inside the editor canvas: links don't navigate, empty containers show a drop hint. */
  editable: boolean
  /**
   * Records per List query (`listKey`). A query without an entry has no known
   * collection: the canvas shows a hint, published apps render nothing.
   */
  lists: Record<string, DataRecord[]>
  /**
   * Adds a record from a Form (published apps); rejects with a message to show.
   * Absent in the canvas, where forms never submit.
   */
  submitForm?: (collection: string, values: Record<string, string>) => Promise<void>
  /** Public variables for `{{ env.NAME }}`; without them env refs stay as written. */
  env?: EnvValues
  /** A missing variable: kept as written (the canvas and the draft preview) or rendered empty (published apps). */
  onMissingEnv?: 'keep' | 'empty'
}

/**
 * A string prop with its bindings resolved: item ones against the List's
 * record (outside a List the canvas shows them as written, published apps
 * empty) and env ones from the runtime's public variables, in one pass.
 */
export function bindValue(value: string, runtime: Pick<RuntimeContext, 'editable' | 'env' | 'onMissingEnv'>, item?: BindingItem | null): string {
  const scope = { env: runtime.env, onMissingEnv: runtime.onMissingEnv }
  if (item) return resolveBindings(value, { item, ...scope })
  if (!runtime.editable) return resolveBindings(value, scope)
  return runtime.env ? resolveEnv(value, runtime.env, { onMissing: runtime.onMissingEnv ?? 'keep' }) : value
}

export const RUNTIME_KEY: InjectionKey<RuntimeContext> = Symbol('bildr-runtime')

export function useRuntime(): RuntimeContext {
  return inject(RUNTIME_KEY, { base: '', editable: false, lists: {} })
}

/** One repetition of a List's children. The innermost List's item shadows outer ones. */
export interface ListItemContext {
  /** The record, or null for the canvas placeholder of an empty collection. */
  item: BindingItem | null
  /** True for every repetition but the first; the canvas keeps outlines and drops on the first. */
  copy: boolean
}

export const LIST_ITEM_KEY: InjectionKey<ListItemContext> = Symbol('bildr-list-item')

export function useListItem(): ListItemContext | undefined {
  return inject(LIST_ITEM_KEY, undefined)
}
