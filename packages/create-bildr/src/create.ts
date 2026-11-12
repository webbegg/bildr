import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_FILE, SCHEMA_URL, stringifyModelFile } from '@bildr/codegen/model'
import { GENERATOR_VERSION, starterKit } from '@bildr/codegen/starter'
import type { StarterKitOptions } from '@bildr/codegen/starter'
import { planSync } from '@bildr/codegen/sync'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

/**
 * While `@bildr/nuxt` is unpublished (`private`), a project created from this
 * checkout links the local package so it installs; once published, the starter
 * kit's version range applies.
 */
export const localBildrNuxt = (): string | undefined => {
  const dir = fileURLToPath(new URL('../../nuxt/', import.meta.url)).replace(/\/$/, '')
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return undefined
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string, private?: boolean }
  return pkg.name === '@bildr/nuxt' && pkg.private ? `link:${dir}` : undefined
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
  const bildrNuxt = options.bildrNuxt ?? localBildrNuxt()
  const kit = starterKit({ ...options, ...(bildrNuxt ? { bildrNuxt } : {}) })
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
