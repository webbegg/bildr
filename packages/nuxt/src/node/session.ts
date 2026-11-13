import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolvesInside } from './project.ts'
import { writeAtomically } from './sync.ts'
import type { SyncIo } from './sync.ts'

/**
 * The editor's session token, kept across Nuxt restarts (S11: per-session
 * token). nuxi runs Nuxt in its own process first and restarts it in a new
 * forked process (adding a repository triggers one), so a token minted per
 * module setup would 401 every open editor tab after a restart. The token is
 * stored with the process that owns the `nuxt dev` session and reused only by
 * that same owner; a new `nuxt dev` has another owner and gets a new token.
 */

export const SESSION_FILE = '.bildr/.cache/editor-session.json'
const CACHE_DIR = '.bildr/.cache'
const TOKEN = /^[0-9a-f]{48}$/

/**
 * The process that owns this `nuxt dev` session: nuxi's supervisor when this
 * is one of its dev forks (it marks them with `__NUXT__FORK`, and outlives
 * every restart), this process otherwise (nuxi's first, in-process Nuxt).
 */
export const sessionOwner = (env: NodeJS.ProcessEnv = process.env, pid = process.pid, ppid = process.ppid): number =>
  env.__NUXT__FORK && ppid > 1 ? ppid : pid

const mintToken = () => randomBytes(24).toString('hex')

/** Readable by the user only: the token opens a file-writing API. */
const privateIo: SyncIo = {
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, { mode: 0o600 })
  },
  remove: () => {}
}

/** The stored session's token when it belongs to `owner`: a regular file inside the project, with a well-formed token. */
const storedToken = (root: string, owner: number): string | undefined => {
  const path = join(root, SESSION_FILE)
  try {
    if (!resolvesInside(root, path) || !lstatSync(path).isFile()) return undefined
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { owner?: unknown, token?: unknown } | null
    return stored?.owner === owner && typeof stored.token === 'string' && TOKEN.test(stored.token) ? stored.token : undefined
  } catch {
    return undefined
  }
}

export interface EditorSession {
  token: string
  /** The token of this session's earlier Nuxt process (a restart). */
  reused: boolean
  /** Why the token couldn't be stored: it lasts until the next restart only. */
  warning?: string
}

/** This session's editor token: the stored one when `owner` stored it, otherwise a new one, stored atomically (mode 0600). */
export const editorSession = (root: string, options: { owner?: number } = {}): EditorSession => {
  const owner = options.owner ?? sessionOwner()
  const reused = storedToken(root, owner)
  if (reused) return { token: reused, reused: true }
  const token = mintToken()
  try {
    // Same boundary as health and migrations: a committed symlink can't send the token elsewhere.
    if (!resolvesInside(root, join(root, CACHE_DIR))) throw new Error(`${CACHE_DIR} resolves outside the project (symlink)`)
    mkdirSync(join(root, CACHE_DIR), { recursive: true })
    writeAtomically(join(root, SESSION_FILE), `${JSON.stringify({ owner, token })}\n`, privateIo)
    return { token, reused: false }
  } catch (error) {
    return { token, reused: false, warning: `bildr could not keep the editor session in ${SESSION_FILE} (${(error as Error).message}): open editor tabs need the new link after a Nuxt restart` }
  }
}
