/**
 * What the raw editor says of text that is not JSON: the engine's message with the place it names as a line and a column
 * (counted from 1), whichever way the engine words it: a character `position` (V8), a `line` and `column` (Firefox), or
 * nothing but that the text ended too soon. An engine that names no place (V8 for an unexpected token) is asked where
 * the text stops being the start of any JSON.
 */

/** Whether the engine's message says the text is cut short, not wrong: the start of some JSON. */
const CUT_SHORT = /end of (?:JSON|data)|unterminated|incomplete/i

/** The index of the first character that no JSON can follow the text before it with: the shortest prefix that is wrong, found by halving (a prefix of a prefix of JSON is one too). */
const firstWrongCharacter = (text: string): number | undefined => {
  const startsJson = (length: number) => {
    try {
      JSON.parse(text.slice(0, length))
      return true
    } catch (caught) {
      return CUT_SHORT.test(caught instanceof Error ? caught.message : String(caught))
    }
  }
  // The text is fine as far as it goes: the error is not about it.
  if (startsJson(text.length)) return undefined
  let ok = 0
  let wrong = text.length
  while (wrong - ok > 1) {
    const middle = Math.floor((ok + wrong) / 2)
    if (startsJson(middle)) ok = middle
    else wrong = middle
  }
  return wrong - 1
}

export function jsonErrorMessage(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const clean = message
    .replace(/\s*(?:in JSON )?at position \d+(?: \(line \d+ column \d+\))?/, '')
    .replace(/\s*at line \d+ column \d+ of the JSON data/, '')
    .trim()
  const place = /line (\d+) column (\d+)/.exec(message)
  if (place) return `Invalid JSON at line ${place[1]}, column ${place[2]}: ${clean}`
  const at = /position (\d+)/.exec(message)
  const position = at ? Number(at[1]) : CUT_SHORT.test(message) ? text.length : firstWrongCharacter(text)
  if (position === undefined) return `Invalid JSON: ${clean}`
  const before = text.slice(0, position)
  const line = before.split('\n').length
  const column = position - (before.lastIndexOf('\n') + 1) + 1
  return `Invalid JSON at line ${line}, column ${column}: ${clean}`
}
