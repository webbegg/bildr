import { parse } from 'vue/compiler-sfc'
import type { PlanChild } from '../../src/canvas/render.ts'

/**
 * What the generated app's DOM is made of, element by element: the generated
 * SFCs (`generateUi`) parsed with Vue's compiler and walked the way Vue
 * renders them with given data (v-if chains, v-for, slots, layouts, component
 * props and fallthrough classes), down to each element's tag (an HTML tag or
 * a Nuxt UI component) and classes. The parity tests compare it with the
 * canvas's render plan for the same model file and data.
 */

// @vue/compiler-core node types.
const ELEMENT = 1
const ATTRIBUTE = 6
const DIRECTIVE = 7

interface AstProp { type: number, name: string, value?: { content: string }, arg?: { content: string }, exp?: { content: string }, rawName?: string }
interface AstNode { type: number, tag: string, props: AstProp[], children: AstNode[] }

export interface Sfc {
  children: AstNode[]
  /** Script constants (class maps), defaults of `withDefaults`, the page's layout and layout values. */
  consts: Record<string, unknown>
  defaults: Record<string, unknown>
  layout?: string
  layoutValues: Record<string, unknown>
  layoutDefaults: Record<string, unknown>
  interactive: boolean
}

const evaluate = (code: string, scope: Record<string, unknown>): unknown => {
  const proxy = new Proxy(scope, {
    has: () => true,
    get: (target, key) => (key === Symbol.unscopables ? undefined : key in target ? target[key as string] : (globalThis as Record<PropertyKey, unknown>)[key])
  })
  return new Function('__scope', `with (__scope) { return (${code}) }`)(proxy)
}

const literal = (code: string): unknown => evaluate(code, {})

export function loadSfc(content: string): Sfc {
  const { descriptor } = parse(content)
  const script = descriptor.scriptSetup?.content ?? ''
  const consts: Record<string, unknown> = {}
  for (const match of script.matchAll(/const (\w+)(?:: Record<string, string>)? = (\{\n[\s\S]*?\n\})(?: as const)?/g)) consts[match[1]!] = literal(match[2]!)
  const defaults = /withDefaults\(defineProps<\{[\s\S]*?\}>\(\), (\{.*\})\)/.exec(script)
  const meta = /definePageMeta\(\{([\s\S]*?)\}\)\n/.exec(script)?.[1] ?? ''
  const layoutDefaults = /computed\(\(\) => \(\{ (.*), \.\.\.route\.meta\.layoutValues \}\)/.exec(script)
  return {
    children: (descriptor.template!.ast as unknown as AstNode).children,
    consts,
    defaults: defaults ? literal(defaults[1]!) as Record<string, unknown> : {},
    layout: /layout: '([\w-]+)'/.exec(meta)?.[1],
    layoutValues: literal(/layoutValues: (\{[^}]*\})/.exec(meta)?.[1] ?? '{}') as Record<string, unknown>,
    layoutDefaults: layoutDefaults ? literal(`{ ${layoutDefaults[1]} }`) as Record<string, unknown> : {},
    interactive: script.includes('useVariantState(')
  }
}

export interface Element { tag: string, classes: string[] }

interface Slot { nodes: AstNode[], scope: Record<string, unknown> }

export interface App {
  /** By tag: `BlogPostCard` → its SFC; layouts by name. */
  components: Record<string, Sfc>
  layouts: Record<string, Sfc>
}

const directive = (node: AstNode, name: string) => node.props.find(prop => prop.type === DIRECTIVE && prop.name === name)
const attribute = (node: AstNode, name: string) => node.props.find(prop => prop.type === ATTRIBUTE && prop.name === name)?.value?.content

const classList = (value: unknown): string[] => {
  if (!value) return []
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  if (Array.isArray(value)) return value.flatMap(classList)
  if (typeof value === 'object') return Object.entries(value).filter(([, on]) => on).map(([name]) => name)
  return []
}

const classesOf = (node: AstNode, scope: Record<string, unknown>) => {
  const bound = node.props.find(prop => prop.type === DIRECTIVE && prop.name === 'bind' && prop.arg?.content === 'class')
  return [...classList(attribute(node, 'class')), ...(bound ? classList(evaluate(bound.exp!.content, scope)) : [])]
}

/** The props an element passes a component: static attributes and bound ones (`:post`), camelCased. */
const propsOf = (node: AstNode, scope: Record<string, unknown>) => {
  const camel = (name: string) => name.replace(/-(\w)/g, (_, char: string) => char.toUpperCase())
  const props: Record<string, unknown> = {}
  for (const prop of node.props) {
    if (prop.type === ATTRIBUTE && prop.name !== 'class') props[camel(prop.name)] = prop.value?.content ?? true
    if (prop.type === DIRECTIVE && prop.name === 'bind' && prop.arg && prop.arg.content !== 'class' && prop.arg.content !== 'key') props[camel(prop.arg.content)] = evaluate(prop.exp!.content, scope)
  }
  return props
}

/** The `<template #name>` children of a component element, as slots. */
const slotsOf = (node: AstNode, scope: Record<string, unknown>) => {
  const slots: Record<string, Slot> = {}
  for (const child of node.children) {
    const slot = child.type === ELEMENT && child.tag === 'template' ? directive(child, 'slot') : undefined
    if (slot) slots[slot.arg?.content ?? 'default'] = { nodes: child.children, scope }
  }
  return slots
}

/** The elements generated SFC markup renders with `scope`, in document order. */
export function renderGenerated(app: App, sfc: Sfc, scope: Record<string, unknown>): Element[] {
  const walk = (nodes: AstNode[], scope: Record<string, unknown>, slots: Record<string, Slot>, out: Element[]) => {
    let chain: 'none' | 'taken' | 'open' = 'none'
    for (const node of nodes) {
      if (node.type !== ELEMENT) continue
      const ifs = directive(node, 'if')
      const elseIf = directive(node, 'else-if')
      const isElse = directive(node, 'else')
      if (ifs) chain = evaluate(ifs.exp!.content, scope) ? 'taken' : 'open'
      else if (elseIf) {
        if (chain === 'taken') continue
        chain = evaluate(elseIf.exp!.content, scope) ? 'taken' : 'open'
      } else if (isElse) {
        const show = chain === 'open'
        chain = 'none'
        if (!show) continue
        renderOne(node, scope, slots, out)
        continue
      } else {
        chain = 'none'
        renderOne(node, scope, slots, out)
        continue
      }
      if (chain === 'taken') renderOne(node, scope, slots, out)
    }
  }
  const renderOne = (node: AstNode, scope: Record<string, unknown>, slots: Record<string, Slot>, out: Element[]) => {
    const loop = directive(node, 'for')
    if (loop) {
      const [, name, source] = /^(\w+) in (.+)$/.exec(loop.exp!.content)!
      for (const item of evaluate(source!, scope) as unknown[]) element(node, { ...scope, [name!]: item }, slots, out)
      return
    }
    element(node, scope, slots, out)
  }
  const element = (node: AstNode, scope: Record<string, unknown>, slots: Record<string, Slot>, out: Element[]) => {
    if (node.tag === 'template') return walk(node.children, scope, slots, out)
    if (node.tag === 'slot') {
      const given = slots[attribute(node, 'name') ?? 'default']
      return given ? walk(given.nodes, given.scope, {}, out) : walk(node.children, scope, slots, out)
    }
    if (node.tag === 'NuxtLayout') {
      const layout = app.layouts[attribute(node, 'name')!]!
      const values = (scope.$layoutValues ?? {}) as Record<string, unknown>
      return out.push(...renderGenerated(app, layout, { ...scope, layout: { ...layout.layoutDefaults, ...values }, $slots: slotsOf(node, scope) }))
    }
    const component = app.components[node.tag]
    if (component) {
      const props = { ...component.defaults, ...propsOf(node, scope) }
      const inner = renderGenerated(app, component, { ...scope, ...component.consts, props, variant: props.variant, $slots: slotsOf(node, scope), on: {} })
      // Fallthrough: the instance's classes join its component's root element.
      if (inner[0]) inner[0].classes.push(...classesOf(node, scope))
      return out.push(...inner)
    }
    out.push({ tag: node.tag, classes: classesOf(node, scope) })
    walk(node.children, scope, slots, out)
  }
  const out: Element[] = []
  const { $slots, ...rest } = scope as { $slots?: Record<string, Slot> }
  walk(sfc.children, { ...rest, ...sfc.consts }, $slots ?? {}, out)
  return out
}

/** A page with its layout: the page's markup in the layout's default slot (unless the page renders `<NuxtLayout>` itself). */
export function renderGeneratedPage(app: App, page: Sfc, scope: Record<string, unknown>): Element[] {
  if (!page.layout) return renderGenerated(app, page, { ...scope, $layoutValues: page.layoutValues })
  const layout = app.layouts[page.layout]!
  return renderGenerated(app, layout, {
    ...scope,
    layout: { ...layout.layoutDefaults, ...page.layoutValues },
    $slots: { default: { nodes: page.children, scope: { ...scope, ...page.consts } } }
  })
}

/** The canvas's render plan as the same element list: placeholders (canvas-only) left out. */
export function planElements(children: PlanChild[], out: Element[] = []): Element[] {
  for (const child of children) {
    if (typeof child === 'string') continue
    if (!child.placeholder) out.push({ tag: child.tag, classes: child.class.split(/\s+/).filter(Boolean) })
    planElements(child.children, out)
  }
  return out
}

/** One line per element, `tag: classes` with the classes sorted, so the comparison ignores class order. */
export const normalized = (elements: Element[]) => elements.map(({ tag, classes }) => `${tag}: ${[...new Set(classes)].sort().join(' ')}`)
