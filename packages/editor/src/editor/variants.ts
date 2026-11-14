import type { ComponentFile, Value } from '@bildr/codegen/model'

/** The variants UI's pure parts (the hosted `componentVariants.ts` and `variantBoard.ts`, over `ComponentFile`). */

/** One node's `component_variant_set_override` change: null resets a prop or token, `unset` removes primary tokens. */
export interface OverridePatch {
  props?: Record<string, Value | null>
  style?: Record<string, string | null>
  unset?: string[]
}

export type NodeOverridePatch = OverridePatch & { nodeId: string }

const hasChange = ({ props, style, unset }: OverridePatch) => !!(props && Object.keys(props).length) || !!(style && Object.keys(style).length) || !!unset?.length

/**
 * The `component_variant_set_override` input for per-node patches (without
 * the component and variant): the single form for one node, a batch
 * (`overrides`, one undo step) for several; null when none changes anything.
 */
export const overrideInput = (patches: NodeOverridePatch[]): NodeOverridePatch | { overrides: NodeOverridePatch[] } | null => {
  const changes = patches.filter(hasChange)
  if (!changes.length) return null
  return changes.length === 1 ? changes[0]! : { overrides: changes }
}

/** `Variant N`, N one more than the variants there are, or the next free number. */
export const newVariantName = (component: Pick<ComponentFile, 'variants'>): string => {
  const taken = new Set(component.variants.map(variant => variant.name))
  let n = component.variants.length + 1
  while (taken.has(`Variant ${n}`)) n++
  return `Variant ${n}`
}

/** Whether the variant board shows: the remembered choice, else on with 2 or more variants (the primary and `variantCount` others). */
export const boardShown = (remembered: boolean | undefined, variantCount: number): boolean => remembered ?? variantCount + 1 >= 2
