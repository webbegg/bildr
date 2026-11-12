/** Import lines in the golden fixture's order: type-only names first, then values, each in code-unit order. */

const byCodeUnit = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export interface ImportName {
  name: string
  type?: boolean
}

/** `import { a, type B } from 'x'`; all-type imports become `import type { … }`. */
export const importLine = (from: string, names: Array<string | ImportName>): string => {
  const entries = [...new Map(names.map(entry => typeof entry === 'string' ? [entry, { name: entry }] : [entry.name, entry])).values()]
    .sort((a, b) => Number(Boolean(b.type)) - Number(Boolean(a.type)) || byCodeUnit(a.name, b.name))
  if (entries.every(entry => entry.type)) return `import type { ${entries.map(entry => entry.name).join(', ')} } from '${from}'`
  return `import { ${entries.map(entry => entry.type ? `type ${entry.name}` : entry.name).join(', ')} } from '${from}'`
}
