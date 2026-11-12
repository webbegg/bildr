import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

const toPosix = (path: string) => path.split(sep).join('/')

/** A project file's text, or undefined when it doesn't exist (the reader `detectStarterKit` expects). */
export const projectReader = (root: string) => (path: string): string | undefined => {
  const target = join(root, path)
  return existsSync(target) && statSync(target).isFile() ? readFileSync(target, 'utf8') : undefined
}

/**
 * Whether writing `target` stays inside `base` once symlinks are resolved:
 * the target (if it exists) or its nearest existing ancestor must resolve
 * inside the real `base`. A symlinked folder committed to the project can't
 * redirect a write elsewhere.
 */
export const resolvesInside = (base: string, target: string): boolean => {
  const realBase = realpathSync(base)
  let probe = target
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return false
    probe = parent
  }
  const real = realpathSync(probe)
  return real === realBase || real.startsWith(realBase + sep)
}

/** The project's `.bildr/` model files as path → text, without the `.cache/` folder or leftovers of atomic writes. */
export const readModelFiles = (root: string): Record<string, string> => {
  const base = join(root, '.bildr')
  if (!existsSync(base)) return {}
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return toPosix(relative(base, path)) === '.cache' ? [] : walk(path)
    return entry.isFile() && !entry.name.endsWith('.tmp') ? [path] : []
  })
  return Object.fromEntries(walk(base).map(path => [toPosix(relative(root, path)), readFileSync(path, 'utf8')]))
}
