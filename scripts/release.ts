/**
 * pnpm release <patch|minor|major|x.y.z> [--dry-run]
 *
 * Releases @bildr/codegen, @bildr/editor, @bildr/nuxt and create-bildr from this machine: the same
 * gate as .github/workflows/release.yml (which cannot run while the repository is private), then
 * commit, tag, publish to npm and push. npm asks for your 2FA code when it publishes.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextVersion, releaseSteps } from './releasePlan.ts'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const wanted = args.find(a => !a.startsWith('--'))

if (!wanted) fail('Usage: pnpm release <patch|minor|major|x.y.z> [--dry-run]')

// Preflight: a clean main that matches origin, and an npm login. A dry run writes nothing, so it runs anywhere.
let npmUser = 'nobody (dry run)'
if (!dryRun) {
  if (git('branch', '--show-current') !== 'main') fail('Release from main.')
  if (git('status', '--porcelain')) fail('The working tree is not clean.')
  run('git', ['fetch', '--quiet', 'origin', 'main'])
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('main differs from origin/main: pull or push first.')
  const whoami = spawnSync('npm', ['whoami'], { cwd: root, encoding: 'utf8' })
  if (whoami.status !== 0) fail('Not logged in to npm: run `npm login` first.')
  npmUser = whoami.stdout.trim()
}

// Every packages/*/package.json moves together (the private editor-core too, as the tag check expects).
const manifests = readdirSync(join(root, 'packages')).map(dir => join(root, 'packages', dir, 'package.json'))
const versions = new Set(manifests.map(file => JSON.parse(readFileSync(file, 'utf8')).version as string))
if (versions.size !== 1) fail(`The packages disagree on their version: ${[...versions].join(', ')}`)
const current = [...versions][0]!
let version: string
try {
  version = nextVersion(current, wanted)
} catch (error) {
  fail((error as Error).message)
}

console.log(`\nRelease ${current} → ${version}${dryRun ? ' (dry run: nothing is written, committed, published or pushed)' : ''} as npm user ${npmUser}\n`)

if (!dryRun) {
  for (const file of manifests) {
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))
  }
}

const packDir = dryRun ? mkdtempSync(join(tmpdir(), 'bildr-release-')) : undefined
let wrote = false
for (const step of releaseSteps(version, { dryRun, packDir })) {
  console.log(`\n▶ ${step.label}: ${step.command} ${step.args.join(' ')}`)
  const result = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit' })
  if (result.status === 0) {
    if (step.label === 'commit') wrote = true
    continue
  }
  if (!wrote && !dryRun) run('git', ['checkout', '--', 'packages'])
  fail(failureHelp(step.label, version, wrote))
}

console.log(dryRun ? `\nDry run passed. The tarballs (current versions) are in ${packDir}` : `\nReleased v${version}: https://www.npmjs.com/package/create-bildr`)

function failureHelp(label: string, v: string, committed: boolean): string {
  if (!committed) return `"${label}" failed. Nothing was committed or published${dryRun ? '' : '; the version bump was reverted'}.`
  if (label === 'tag') return `"tag" failed after the release commit. Undo it with: git reset --hard HEAD~1`
  if (label === 'publish') {
    return `"publish" failed. The release commit and tag v${v} are local only. Fix the cause and finish with:\n`
      + `  pnpm -r --filter './packages/**' publish --access public --no-git-checks   (skips versions already on npm)\n`
      + `  git push --atomic origin main v${v}\n`
      + `or abandon it (only if nothing reached npm): git tag -d v${v} && git reset --hard HEAD~1`
  }
  return `"${label}" failed after publishing v${v} to npm. Push by hand: git push --atomic origin main v${v}`
}

function git(...gitArgs: string[]): string {
  const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${gitArgs.join(' ')} failed:\n${result.stderr}`)
  return result.stdout.trim()
}

function run(command: string, commandArgs: string[]): void {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} failed.`)
}

function fail(message: string): never {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}
