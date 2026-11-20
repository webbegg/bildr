import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_FILE, SCHEMA_URL, stringifyModelFile } from '@bildr/codegen/model'
import { GENERATOR_VERSION, starterKit } from '@bildr/codegen/starter'
import type { StarterKitOptions } from '@bildr/codegen/starter'
import { planSync } from '@bildr/codegen/sync'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

/** `link:` to this checkout's `packages/nuxt`, when `moduleUrl` is a module of this checkout's `packages/create-bildr`. */
export const localBildrNuxt = (moduleUrl: string = import.meta.url): string | undefined => {
  const dir = fileURLToPath(new URL('../../nuxt/', moduleUrl)).replace(/\/$/, '')
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return undefined
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
  return pkg.name === '@bildr/nuxt' ? `link:${dir}` : undefined
}

/** Set by `bun build --define` when the single-file binary is built (scripts/build-binaries.mjs); undeclared on Node. */
declare const CREATE_BILDR_VERSION: string | undefined

/**
 * The `@bildr/nuxt` spec a created project gets unless one is given (`--bildr`).
 * - From the single-file binary (no package.json inside it): `^<version>` injected at build time.
 * - From this checkout's sources (`src/*.ts`, as the tests and e2e run it): a link
 *   to the local package, so the project installs without the registry.
 * - From the built package (`dist/*.js`, as `pnpm create bildr` runs it):
 *   `^<create-bildr's version>`; the packages are released together.
 */
export const defaultBildrNuxt = (moduleUrl: string = import.meta.url): string => {
  if (typeof CREATE_BILDR_VERSION === 'string') return `^${CREATE_BILDR_VERSION}`
  const local = moduleUrl.endsWith('.ts') ? localBildrNuxt(moduleUrl) : undefined
  if (local) return local
  // package.json is one level up from both src/ and dist/.
  const own = JSON.parse(readFileSync(new URL('../package.json', moduleUrl), 'utf8')) as { version: string }
  return `^${own.version}`
}

export interface CreateResult {
  /** Project-relative paths in the order they were written; the manifest is last. */
  files: string[]
}

/**
 * Writes a new starter-kit project into `dir` (decision D9: new projects only).
 * The directory must not exist or be empty. The model goes first, then the
 * first sync, then the manifest, so an interrupted run never leaves a manifest
 * that claims files it didn't write.
 */
export const createProject = (dir: string, options: StarterKitOptions): CreateResult => {
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new Error(`${dir} exists and is not a directory`)
    if (readdirSync(dir).length > 0) throw new Error(`${dir} is not empty: bildr creates new projects only`)
  }
  const kit = starterKit({ ...options, bildrNuxt: options.bildrNuxt ?? defaultBildrNuxt() })
  const plan = planSync({ generated: kit.files, manifest: {}, disk: {}, hash: sha256 })

  const written: string[] = []
  const write = (path: string, content: string) => {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, { flag: 'wx' })
    written.push(path)
  }
  for (const [path, content] of Object.entries(kit.model)) write(path, content)
  for (const file of plan.writes) write(file.path, file.content)
  write(MANIFEST_FILE, stringifyModelFile({ $schema: `${SCHEMA_URL}/manifest.v1.json`, generatorVersion: GENERATOR_VERSION, files: plan.manifest }))
  return { files: written }
}
