import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * The blog golden fixture's `.bildr/` files, path → text (as
 * `@bildr/codegen`'s test fixture reads them). Found from the working
 * directory: the repository root or `packages/editor` (happy-dom gives test
 * modules no file URL).
 */
const fixtureRoot = [resolve('fixtures/codegen/blog'), resolve('../../fixtures/codegen/blog')].find(path => existsSync(path))!

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])

export const blogModelFiles = (): Record<string, string> => {
  const dir = join(fixtureRoot, '.bildr')
  return Object.fromEntries(walk(dir)
    .filter(path => !relative(dir, path).startsWith('.cache'))
    .map(path => [relative(fixtureRoot, path), readFileSync(path, 'utf8')]))
}
