#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProject } from './create.ts'

const USAGE = 'Usage: pnpm create bildr <directory> [--name "Project name"] [--module main]'

export interface CliArgs {
  dir: string
  name: string
  module: string
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
    if (key !== 'name' && key !== 'module') throw new Error(`Unknown option --${key}\n${USAGE}`)
    const value = inline ?? argv[++i]
    if (value === undefined) throw new Error(`--${key} needs a value\n${USAGE}`)
    options[key] = value
  }
  const dir = positional[0]
  if (!dir || positional.length > 1) throw new Error(USAGE)
  return { dir, name: options.name ?? titleFromDir(dir), module: options.module ?? 'main' }
}

const main = () => {
  try {
    const args = parseArgs(process.argv.slice(2))
    const dir = resolve(args.dir)
    const { files } = createProject(dir, { name: args.name, module: args.module })
    const cd = relative(process.cwd(), dir) || '.'
    console.log(`Created ${args.name} (${files.length} files) in ${dir}\n\nNext:\n  cd ${cd}\n  pnpm install\n  pnpm dev`)
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}

/** Run as a program, also through the symlink a package manager installs as the bin. */
const isEntry = () => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]!) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) main()
