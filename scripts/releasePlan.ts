/** The pure half of `pnpm release`: which version comes next and which commands run, in order. */

export interface ReleaseStep {
  label: string
  command: string
  args: string[]
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/

/** `patch`, `minor`, `major` or an explicit `x.y.z` (a leading `v` is fine), above `current`. */
export function nextVersion(current: string, wanted: string): string {
  const now = parse(current, 'the current version')
  let next: [number, number, number]
  if (wanted === 'patch') next = [now[0], now[1], now[2] + 1]
  else if (wanted === 'minor') next = [now[0], now[1] + 1, 0]
  else if (wanted === 'major') next = [now[0] + 1, 0, 0]
  else next = parse(wanted, `"${wanted}"`)
  if (compare(next, now) <= 0) throw new Error(`The new version must be above ${current}, got ${next.join('.')}`)
  return next.join('.')
}

/**
 * The commands after the versions are bumped. Every check runs before anything is written to git
 * or npm; publish comes before push, so a failed publish leaves nothing on GitHub to undo.
 * A dry run packs the tarballs into `packDir` instead of committing, tagging, publishing and pushing
 * (publish --dry-run would skip every version already on npm, and a dry run does not bump).
 */
export function releaseSteps(version: string, { dryRun, packDir = '' }: { dryRun: boolean, packDir?: string }): ReleaseStep[] {
  const tag = `v${version}`
  const step = (label: string, command: string, ...args: string[]): ReleaseStep => ({ label, command, args })
  const publish = ['-r', '--filter', './packages/**', 'publish', '--access', 'public', '--no-git-checks']
  const checks = [
    step('install', 'pnpm', 'install', '--frozen-lockfile'),
    step('build editor', 'pnpm', 'run', 'build:editor'),
    step('build packages', 'pnpm', 'run', 'build:packages'),
    step('lint', 'pnpm', 'run', 'lint'),
    step('typecheck', 'pnpm', 'run', 'typecheck'),
    // The migration tests use the golden fixture's drizzle-kit install (as in ci.yml).
    step('install golden fixture', 'pnpm', '--dir', 'fixtures/codegen/blog', 'install', '--frozen-lockfile'),
    // A worker per CPU runs a many-core machine out of memory (the editor suites use happy-dom).
    step('test', 'pnpm', 'run', 'test', '--maxWorkers=3')
  ]
  if (dryRun) return [...checks, step('pack', 'pnpm', '-r', '--filter', './packages/**', 'pack', '--pack-destination', packDir)]
  return [
    ...checks,
    step('commit', 'git', 'commit', '-m', `release: ${tag}`, '--', 'packages'),
    step('tag', 'git', 'tag', '-a', tag, '-m', tag),
    step('publish', 'pnpm', ...publish),
    step('push', 'git', 'push', '--atomic', 'origin', 'main', tag)
  ]
}

function parse(version: string, what: string): [number, number, number] {
  const match = SEMVER.exec(version)
  if (!match) throw new Error(`Expected patch, minor, major or a version x.y.z for ${what}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}
