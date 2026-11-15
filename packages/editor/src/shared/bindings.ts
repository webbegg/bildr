import type { Value } from '@bildr/codegen/model'

/**
 * How a text field reads and writes a prop that can be bound to data (the hosted fields held
 * `{{ item.title }}` in their text; the model holds expressions): a prop is a plain string, `{ $bind: 'post.title' }`
 * (the whole text is one name) or `{ $template: 'By {post.author}' }` (names inside text). The
 * field shows a binding as `{name}` text and gives the text back as the shape it means, so the
 * fields never see `{{ }}` and a name only binds when it is one the node can read (`names`).
 */

export const isExpression = (value: unknown): value is Record<string, Value> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A `{ $bind }` or `{ $template }`: the values the text fields show as `{name}` text. */
export const isTextBinding = (value: unknown): value is { $bind: string } | { $template: string } =>
  isExpression(value) && (typeof value.$bind === 'string' || typeof value.$template === 'string')

/** The `{name}` tokens of a text: the whole token, and the path in it. */
const TOKEN = /\{([\w$]+(?:\.[\w$]+)*)\}/g

/** What a text field shows for a prop value: plain text as it is, a binding as `{name}` text, anything else empty. */
export function valueText(value: Value | undefined): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (isExpression(value)) {
    if (typeof value.$bind === 'string') return `{${value.$bind}}`
    if (typeof value.$template === 'string') return value.$template
  }
  return ''
}

/** The names `text` binds: the paths of its `{name}` tokens whose first part is a name in `scope`. */
export function boundPaths(text: string, scope: readonly string[]): string[] {
  return [...text.matchAll(TOKEN)].map(match => match[1]!).filter(path => scope.includes(path.split('.')[0]!))
}

/**
 * The prop value a text field's `text` means: one `{name}` alone is `{ $bind }`, names among other
 * text are a `{ $template }`, anything else is plain text. `scope` are the root names the node can
 * read (`ScopeName.name`); a `{word}` that is none of them stays literal text. Empty is `null`
 * (the prop is removed).
 */
export function textValue(text: string, scope: readonly string[]): Value | null {
  if (text === '') return null
  const paths = boundPaths(text, scope)
  if (!paths.length) return text
  const only = text.match(/^\{([\w$]+(?:\.[\w$]+)*)\}$/)
  return only && paths.length === 1 ? { $bind: only[1]! } : { $template: text }
}

/** `text` with the `{name}` token of `path` added at its end (a binding menu with no caret to type at). */
export const withPath = (text: string, path: string): string => `${text}{${path}}`

/** The token that binds `path` in a text field. */
export const pathToken = (path: string): string => `{${path}}`

/**
 * `insert` typed over the selection `start`–`end` of `text` (either order, clamped to the
 * text), with the caret after it (the hosted `shared/env/insert.ts`).
 */
export function insertAt(text: string, start: number, end: number, insert: string): { text: string, caret: number } {
  const clamp = (n: number) => Math.min(Math.max(n, 0), text.length)
  const from = clamp(Math.min(start, end))
  const to = clamp(Math.max(start, end))
  return { text: text.slice(0, from) + insert + text.slice(to), caret: from + insert.length }
}
