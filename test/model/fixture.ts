import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const fixtureRoot = fileURLToPath(new URL('../../fixtures/codegen/blog', import.meta.url))

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])

/** The fixture's `.bildr/` files as a path → text map, the way a project store hands them to the model. */
export const fixtureModelFiles = (): Record<string, string> => {
  const dir = join(fixtureRoot, '.bildr')
  return Object.fromEntries(walk(dir)
    .filter(path => !relative(dir, path).startsWith('.cache'))
    .map(path => [relative(fixtureRoot, path), readFileSync(path, 'utf8')]))
}
