import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { resolvesInside } from '../node/project.ts'

/**
 * The prebuilt editor (`@bildr/editor`'s `dist/`, decision D12): the shell
 * page and its `_assets/`, served under a strict CSP. Read on every request,
 * so a rebuild of the editor shows up without restarting nuxt dev.
 */

/** No inline scripts, no third-party origins: the editor talks only to `/__bildr`. */
export const EDITOR_CSP = 'default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\' data:; connect-src \'self\'; frame-src \'self\'; frame-ancestors \'self\''

/** `@bildr/editor`'s `dist/` folder, or undefined when the package can't be resolved. */
export const defaultEditorDist = (): string | undefined => {
  try {
    return join(dirname(createRequire(import.meta.url).resolve('@bildr/editor/package.json')), 'dist')
  } catch {
    return undefined
  }
}

/** The built shell page, or undefined when the editor isn't built. */
export const readEditorShell = (dist: string | undefined): string | undefined => {
  if (!dist) return undefined
  const target = join(dist, 'index.html')
  return existsSync(target) && statSync(target).isFile() ? readFileSync(target, 'utf8') : undefined
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

/**
 * One file of `dist/_assets/` by its still-encoded path below `_assets/`, or
 * undefined: empty, `.` and `..` segments, backslashes and NUL (also when
 * percent-encoded) are refused, and so is anything that resolves outside
 * `_assets/` through a symlink.
 */
export const readEditorAsset = (dist: string | undefined, encoded: string): { body: Buffer, type: string } | undefined => {
  if (!dist) return undefined
  let path: string
  try {
    path = decodeURIComponent(encoded)
  } catch {
    return undefined
  }
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || /[\\\0]/.test(part))) return undefined
  const base = join(dist, '_assets')
  const target = join(base, ...parts)
  if (!existsSync(base) || !existsSync(target) || !resolvesInside(base, target) || !statSync(target).isFile()) return undefined
  return { body: readFileSync(target), type: CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream' }
}
