/**
 * `insert` typed over the selection `start`–`end` of `text` (either order,
 * clamped to the text), with the caret after it.
 */
export function insertAt(text: string, start: number, end: number, insert: string): { text: string, caret: number } {
  const clamp = (n: number) => Math.min(Math.max(n, 0), text.length)
  const from = clamp(Math.min(start, end))
  const to = clamp(Math.max(start, end))
  return { text: text.slice(0, from) + insert + text.slice(to), caret: from + insert.length }
}

export const envRef = (name: string) => `{{ env.${name} }}`
