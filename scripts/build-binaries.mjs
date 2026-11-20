// Builds create-bildr as single-file executables with Bun (pnpm build:binaries).
//   node scripts/build-binaries.mjs [--targets linux-x64,darwin-arm64] [--out <dir>]
// Output in dist-bin/ (gitignored) unless --out says otherwise: create-bildr-<os>-<arch>[.exe],
// SHA256SUMS (sha256sum format) and the install scripts, i.e. everything attached to a GitHub Release.
// Needs `bun` on PATH (or BUN=/path/to/bun) and the installed dependencies. It does not need the
// packages built: Bun bundles the workspace sources. The x64 targets are Bun's -baseline builds, which
// run on CPUs without AVX2 and under Rosetta before macOS 15; the file names do not change.
// --out <dir> is emptied first, so it must not be the repository or one of its parents.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Our target name -> Bun's --target.
const BUN_TARGETS = {
  'linux-x64': 'bun-linux-x64-baseline',
  'linux-arm64': 'bun-linux-arm64',
  'darwin-x64': 'bun-darwin-x64-baseline',
  'darwin-arm64': 'bun-darwin-arm64',
  'windows-x64': 'bun-windows-x64-baseline'
}
const ALL_TARGETS = Object.keys(BUN_TARGETS)

const root = fileURLToPath(new URL('..', import.meta.url))
const bun = process.env.BUN || 'bun'
const usage = `Usage: node scripts/build-binaries.mjs [--targets ${ALL_TARGETS.join(',')}] [--out <dir>]`

const fail = (message) => {
  console.error(`build-binaries: ${message}`)
  process.exit(1)
}

const parseArgs = (argv) => {
  const args = argv.slice(2)
  const given = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const match = /^--(targets|out)(?:=(.*))?$/.exec(arg)
    if (!match) fail(`unknown argument ${arg}\n${usage}`)
    const [, key, inline] = match
    given[key] = inline ?? args[++i]
    if (!given[key]) fail(`--${key} needs a value`)
  }

  let targets = ALL_TARGETS
  if (given.targets !== undefined) {
    targets = given.targets.split(',').map(t => t.trim()).filter(Boolean)
    const unknown = targets.filter(t => !ALL_TARGETS.includes(t))
    if (targets.length === 0 || unknown.length > 0) fail(`unknown target ${unknown.join(', ') || '(none)'}; use ${ALL_TARGETS.join(', ')}`)
  }

  const out = given.out === undefined ? resolve(root, 'dist-bin') : resolve(process.cwd(), given.out)
  const up = relative(out, root) // '' when out is the repo, no '..' when out is a parent of it
  if (up === '' || !up.startsWith('..') || out === resolve(homedir()) || out === resolve('/')) {
    fail(`refusing --out ${out}: it is emptied first and contains this repository or your home directory`)
  }
  return { targets, out }
}

const { targets, out } = parseArgs(process.argv)

const probe = spawnSync(bun, ['--version'], { encoding: 'utf8' })
if (probe.error || probe.status !== 0) {
  fail('bun is required to build the binaries but was not found. Install it from https://bun.sh (or set BUN=/path/to/bun) and run again.')
}

const { version } = JSON.parse(readFileSync(`${root}packages/create-bildr/package.json`, 'utf8'))
if (typeof version !== 'string' || !version) fail('packages/create-bildr/package.json has no version')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const sums = []
for (const target of targets) {
  const name = `create-bildr-${target}${target.startsWith('windows') ? '.exe' : ''}`
  console.log(`build-binaries: ${name} (v${version}, ${BUN_TARGETS[target]})`)
  const build = spawnSync(bun, [
    'build', '--compile', '--minify',
    `--target=${BUN_TARGETS[target]}`,
    // Read by defaultBildrNuxt: a binary has no package.json to look the version up in.
    '--define', `CREATE_BILDR_VERSION=${JSON.stringify(version)}`,
    'packages/create-bildr/src/cli.ts',
    '--outfile', `${out}${sep}${name}`
  ], { cwd: root, stdio: 'inherit' })
  if (build.status !== 0) fail(`bun build failed for ${target}`)
  sums.push(`${createHash('sha256').update(readFileSync(`${out}/${name}`)).digest('hex')}  ${name}`)
}

writeFileSync(`${out}/SHA256SUMS`, `${sums.join('\n')}\n`)
for (const script of ['install.sh', 'install.ps1']) copyFileSync(`${root}install/${script}`, `${out}/${script}`)

for (const line of sums) {
  const name = line.split('  ')[1]
  console.log(`  ${name}  ${(statSync(`${out}/${name}`).size / 1e6).toFixed(0)} MB`)
}
console.log(`build-binaries: ${sums.length} binaries, SHA256SUMS and the install scripts in ${out}`)
