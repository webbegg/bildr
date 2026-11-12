import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const toPosix = (path: string) => path.split(sep).join('/')

/** A project file's text, or undefined when it doesn't exist (the reader `detectStarterKit` expects). */
export const projectReader = (root: string) => (path: string): string | undefined => {
  const target = join(root, path)
  return existsSync(target) && statSync(target).isFile() ? readFileSync(target, 'utf8') : undefined
}

/** The project's `.bildr/` model files as path → text, without the `.cache/` folder. */
export const readModelFiles = (root: string): Record<string, string> => {
  const base = join(root, '.bildr')
  if (!existsSync(base)) return {}
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return toPosix(relative(base, path)) === '.cache' ? [] : walk(path)
    return entry.isFile() ? [path] : []
  })
  return Object.fromEntries(walk(base).map(path => [toPosix(relative(root, path)), readFileSync(path, 'utf8')]))
}
