/**
 * A select's options as people type them on one line: commas separate them,
 * and an option in double quotes may hold a comma (`small, "1,000 or more"`),
 * with `""` for a quote inside. A quote that does not open the option is text
 * (`6" pipe`), and a quote never closed runs to the end of the line.
 */

/** The options in `text`: trimmed (a quoted one keeps its spaces), with no empty one. */
export function parseOptions(text: string): string[] {
  const options: string[] = []
  let at = 0
  while (at <= text.length) {
    while (text[at] === ' ' || text[at] === '\t') at++
    let option: string
    if (text[at] === '"') {
      option = ''
      at++
      while (at < text.length) {
        if (text[at] === '"') {
          if (text[at + 1] === '"') {
            option += '"'
            at += 2
            continue
          }
          at++
          break
        }
        option += text[at++]
      }
      // Anything between the closing quote and the next comma is kept, as typed.
      const end = text.indexOf(',', at)
      option += text.slice(at, end === -1 ? text.length : end).trim()
      at = end === -1 ? text.length + 1 : end + 1
    } else {
      const end = text.indexOf(',', at)
      option = text.slice(at, end === -1 ? text.length : end).trim()
      at = end === -1 ? text.length + 1 : end + 1
    }
    if (option !== '') options.push(option)
  }
  return options
}

/** `options` on one line, as `parseOptions` reads them back: quoted only when one holds a comma, opens with a quote, or has spaces around it. */
export const formatOptions = (options: readonly string[]): string =>
  options.map(option => /,|^"|^\s|\s$/.test(option) ? `"${option.replace(/"/g, '""')}"` : option).join(', ')
