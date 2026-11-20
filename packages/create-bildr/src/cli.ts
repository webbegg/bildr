#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STARTER_DATABASES } from '@bildr/codegen/starter'
import type { StarterDatabase } from '@bildr/codegen/starter'
import { createProject } from './create.ts'

const USAGE = 'Usage: pnpm create bildr <directory> [--name "Project name"] [--module main] [--database sqlite|none] [--bildr <@bildr/nuxt version or link:path>]'
const OPTIONS = ['name', 'module', 'database', 'bildr'] as const

export interface CliArgs {
  dir: string
  name: string
  module: string
  /** Dependency spec for @bildr/nuxt; the starter kit's default when absent. */
  bildr?: string
  /** `sqlite` (the starter kit's default when absent) or `none`: an API-only project with no database. */
  database?: StarterDatabase
}

const titleFromDir = (dir: string) => basename(resolve(dir)).split(/[-_\s]+/).filter(Boolean)
  .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

export const parseArgs = (argv: string[]): CliArgs => {
  const options: Record<string, string> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined]
    if (!(OPTIONS as readonly string[]).includes(key)) throw new Error(`Unknown option --${key}\n${USAGE}`)
    const value = inline ?? argv[++i]
    if (value === undefined || value.trim() === '') throw new Error(`--${key} needs a value\n${USAGE}`)
    options[key] = value
  }
  const dir = positional[0]
  if (!dir || positional.length > 1) throw new Error(USAGE)
  const database = options.database
  if (database !== undefined && !(STARTER_DATABASES as readonly string[]).includes(database)) throw new Error(`--database: use ${STARTER_DATABASES.join(' or ')}\n${USAGE}`)
  return {
    dir,
    name: options.name ?? titleFromDir(dir),
    module: options.module ?? 'main',
    ...(options.bildr ? { bildr: options.bildr } : {}),
    ...(database ? { database: database as StarterDatabase } : {})
  }
}

const main = () => {
  try {
    const args = parseArgs(process.argv.slice(2))
    const dir = resolve(args.dir)
    const { files } = createProject(dir, { name: args.name, module: args.module, ...(args.bildr ? { bildrNuxt: args.bildr } : {}), ...(args.database ? { database: args.database } : {}) })
    const cd = relative(process.cwd(), dir) || '.'
    console.log(`Created ${args.name} (${files.length} files) in ${dir}\n\nNext:\n  cd ${cd}\n  pnpm install\n  pnpm dev`)
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}

/**
 * Run as a program, also through the symlink a package manager installs as the bin.
 * In the Bun single-file binary argv[1] is a virtual path, so `import.meta.main` (Bun, and Node 22.18+) decides there.
 */
const isEntry = () => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]!) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry() || import.meta.main === true) main()
