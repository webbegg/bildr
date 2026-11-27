import { tidyClasses } from '../../design/classes.ts'
import { customColorNames } from '../../design/theme.ts'
import { displayFallback, orderedStyleTokens, styleClasses, styleInline, styleTokenProblem } from '../../design/tokens.ts'
import type { ModelNode } from '../../model/schemas.ts'
import { animatedProperties } from '../../render/rules.ts'
import { camel, pascal, tsString } from '../text.ts'
import type { Env } from './env.ts'
import { bindPath, fail, variantRead } from './env.ts'
import type { Attr } from './markup.ts'
import { boundAttr, staticAttr } from './markup.ts'

export interface StyleOptions {
  /** The display class of the type (`displayOf`); a base `display` token replaces it. */
  display?: string
  /** The token fallbacks of the type (render rules); a token of the same key replaces each. */
  fallback?: Record<string, string>
  /** Fixed classes of the type, before the tokens. */
  classes?: string[]
  /** The style keys this element takes (a Card splits its style between the card and its inner stack). */
  pick?: (key: string) => boolean
  /** The class map name's part for this element, e.g. `Stack` for `cardStackVariants`. */
  part?: string
}

/** The node's classes, checked against the token registry: an unknown token is an error, not a silent drop. */
export const styleAttrs = (env: Env, node: ModelNode, { display = '', fallback = {}, classes: fixed = [], pick = () => true, part = '' }: StyleOptions = {}): Attr[] => {
  const style = node.style ?? {}
  const custom = customColorNames(env.model.theme)
  for (const [key, value] of Object.entries(style)) {
    const problem = styleTokenProblem(key, value, custom, env.base)
    if (problem) fail(env, node, problem)
  }
  const mine = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([key]) => pick(key)))
  const full = mine({ ...fallback, ...style })
  const variant = env.variants?.get(node.id)
  const bound = (env.styleBindings?.get(node.id) ?? []).filter(binding => pick(binding.key))
  const keys = variant
    ? [...new Set([...variant.styles.flatMap(([, entry]) => changedKeys(style, entry)), ...[...variant.pointer.values()].flat().flatMap(state => state.keys)])].filter(pick)
    : []
  if (bound.some(binding => keys.includes(binding.key))) fail(env, node, 'a style a property drives is also overridden by a variant')
  const excluded = new Set([...keys, ...bound.map(binding => binding.key)])
  const own = Object.fromEntries(Object.entries(full).filter(([key]) => !excluded.has(key)))
  // An interactive component animates what its variants change, with the timing of the variant it goes to.
  const timings = variant?.timing && keys.length ? [...variant.timing.values()] : []
  const animated = timings.some(Boolean) ? animatedProperties(keys) : []
  const sharedTiming = animated.length && new Set(timings).size === 1 ? timings[0]! : ''
  const rootClasses = env.root?.id === node.id && !part ? env.root.classes : []
  const only = (entries: Record<string, string>, subset = keys) => Object.fromEntries(subset.filter(key => keys.includes(key) && entries[key] !== undefined).map(key => [key, entries[key]!]))
  const perVariant = variant && keys.length
    ? variant.styles.map(([name, entry]): [string, string] => [name, tidyClasses([
        styleClasses(only({ ...fallback, ...entry })),
        ...(variant.pointer.get(name) ?? []).flatMap(state => [prefixedClasses(only({ ...fallback, ...state.style }, state.keys), state.prefix), animated.length && state.timing ? state.timing : '']),
        animated.length && !sharedTiming ? variant.timing!.get(name) || 'duration-0' : ''
      ])])
    : []
  // Only the default (its states are classes): no map.
  const unmapped = perVariant.length === 1 ? perVariant[0]![1] : ''
  const classes = tidyClasses([...fixed, display ? displayFallback(display, style) : '', ...rootClasses, animated.length ? `transition-[${animated.join(',')}]` : '', sharedTiming, styleClasses(own), unmapped])
  const inline = Object.entries(styleInline(own)).map(([property, value]) => `${property}: ${value}`).join('; ')
  const maps: string[] = []
  if (variant && perVariant.length > 1) {
    // Variant overrides become a class map; the default entry holds what the node renders without one.
    const map = `${variant.base}${part}Variants`
    env.variantLines.push('', `const ${map} = {`, perVariant.map(([name, value]) => `  ${name}: ${tsString(value)}`).join(',\n'), '} as const')
    maps.push(`${map}[${variantRead(env)}]`)
  }
  for (const binding of bound) {
    // A style a property drives: a class map of the values it can take, indexed by the property.
    const map = `${camel(node.id.replace(/^n_/, ''))}${pascal(binding.key.replace(/[^A-Za-z0-9]+/g, ' ').replace(/\s+(\w)/g, (_, char: string) => char.toUpperCase()))}Classes`
    const entries = binding.values.map(value => [value, styleClasses({ [binding.key]: value })] as const).filter(([, value]) => value)
    const quote = entries.some(([value]) => !/^[A-Za-z_$][\w$]*$/.test(value))
    const typed = binding.select && binding.hasDefault
    env.variantLines.push('', typed ? `const ${map} = {` : `const ${map}: Record<string, string> = {`, entries.map(([value, classes]) => `  ${quote ? tsString(value) : value}: ${tsString(classes)}`).join(',\n'), typed ? '} as const' : '}')
    const value = bindPath(env, node, binding.path, 'template')
    const fallbackValue = full[binding.key]
    maps.push(`${map}[${value}${binding.hasDefault ? '' : ` ?? ${tsString(fallbackValue ?? '')}`}]`)
  }
  return [
    ...(classes ? [staticAttr('class', classes)] : []),
    ...(maps.length ? [boundAttr('class', maps.length === 1 ? maps[0]! : `[${maps.join(', ')}]`)] : []),
    ...(inline ? [staticAttr('style', inline)] : [])
  ]
}

/** The keys whose values differ between two styles. */
export const changedKeys = (a: Record<string, string>, b: Record<string, string>) => Object.keys({ ...a, ...b }).filter(key => a[key] !== b[key])

/** A style's classes under a state variant: `group-hover/card:p-4` or `hover:p-4`, after the breakpoint (`md:group-hover/card:p-4`). */
export const prefixedClasses = (style: Record<string, string>, prefix: string) => orderedStyleTokens(style).filter(token => token.className)
  .map(token => token.breakpoint ? `${token.breakpoint}:${prefix}${token.className.slice(token.breakpoint.length + 1)}` : `${prefix}${token.className}`).join(' ')
