import type { InjectionKey } from 'vue'

export interface RuntimeContext {
  /** Path prefix that page-slug links resolve under, e.g. `/p/shop`. */
  base: string
  /** True inside the editor canvas: links don't navigate, empty containers show a drop hint. */
  editable: boolean
}

export const RUNTIME_KEY: InjectionKey<RuntimeContext> = Symbol('bildr-runtime')

export function useRuntime(): RuntimeContext {
  return inject(RUNTIME_KEY, { base: '', editable: false })
}
