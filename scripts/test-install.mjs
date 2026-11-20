// End-to-end test of install/install.sh against a local release folder (pnpm test:install).
//   node scripts/test-install.mjs
// Builds the binary for this machine (needs bun, ~110 MB, a few seconds) into a scratch dir (--out), never
// into dist-bin/, so it does not clobber a full build. It serves that dir from a local static server on a
// free port, installs into a scratch dir and checks:
//   - the installed binary creates a project that depends on "@bildr/nuxt": "^<version>";
//   - a tampered SHA256SUMS aborts with nothing installed;
//   - file:// downloads, the PATH hint and the unsupported-OS error;
//   - a truncated script runs nothing (everything is inside `main`);
//   - BILDR_VERSION: `0.1.0` and `v0.1.0` select the release, anything else is refused;
//   - Alpine/musl is refused; Rosetta on macOS gets the arm64 binary.
// Linux and macOS only (it runs install.sh). Scratch: ~/.cache/cli-bin-test/run-<pid>, removed at the end.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = join(homedir(), '.cache', 'cli-bin-test', `run-${process.pid}`)
const dist = join(scratch, 'dist')
const { version } = JSON.parse(readFileSync(join(root, 'packages/create-bildr/package.json'), 'utf8'))

const os = { linux: 'linux', darwin: 'darwin' }[process.platform]
const arch = { x64: 'x64', arm64: 'arm64' }[process.arch]
if (!os || !arch) {
  console.error(`test-install: unsupported host ${process.platform}-${process.arch}`)
  process.exit(1)
}
const target = `${os}-${arch}`

const step = message => console.log(`\n# ${message}`)

/** Serves a directory over http on a free port chosen by the OS. */
const serve = dir => new Promise((resolve) => {
  const server = createServer((req, res) => {
    const file = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200).end(readFileSync(file))
  })
  server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }))
})

/** Runs install.sh without blocking the event loop (the static server lives in this process). */
const install = (env, script = join(dist, 'install.sh')) => new Promise((resolve) => {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BILDR_')))
  const child = spawn('sh', [script], { env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => (stdout += chunk))
  child.stderr.on('data', chunk => (stderr += chunk))
  child.on('close', status => resolve({ status, stdout, stderr }))
})

/** A directory of fake commands, to put first on PATH. */
const fakeBin = (name, commands) => {
  const dir = join(scratch, `fake-${name}`)
  mkdirSync(dir, { recursive: true })
  for (const [command, body] of Object.entries(commands)) {
    writeFileSync(join(dir, command), `#!/bin/sh\n${body}\n`)
    chmodSync(join(dir, command), 0o755)
  }
  return `${dir}:${process.env.PATH}`
}

/** A uname that reports the given OS and machine. */
const unameOf = (os, machine) => `case "$1" in -s) echo ${os} ;; -m) echo ${machine} ;; *) echo ${os} ;; esac`

mkdirSync(scratch, { recursive: true })
const servers = []
try {
  step(`build ${target}`)
  const build = spawnSync(process.execPath, [join(root, 'scripts/build-binaries.mjs'), '--targets', target, '--out', dist], { cwd: root, stdio: 'inherit' })
  assert.equal(build.status, 0, 'build-binaries failed')

  const shellcheck = spawnSync('shellcheck', [join(root, 'install/install.sh')], { encoding: 'utf8' })
  if (shellcheck.error) console.log('shellcheck not installed: skipped')
  else assert.equal(shellcheck.status, 0, `shellcheck:\n${shellcheck.stdout}`)

  step('install from a local release over http, run the installed binary')
  const release = await serve(dist)
  servers.push(release)
  const home = join(scratch, 'install-http')
  const ok = await install({ BILDR_DOWNLOAD_URL: release.url, BILDR_INSTALL: home })
  assert.equal(ok.status, 0, ok.stderr)
  const bin = join(home, 'bin', 'create-bildr')
  assert.ok(statSync(bin).mode & 0o111, 'the installed file is executable')
  assert.match(ok.stdout, new RegExp(`export PATH="${join(home, 'bin')}:`), 'prints the PATH hint when the bin dir is not on PATH')
  assert.match(ok.stdout, /create-bildr my-app/)
  assert.match(ok.stdout, /Node 22\.18\+ and pnpm/)
  const work = join(scratch, 'work')
  mkdirSync(work)
  const run = spawnSync(bin, ['p1'], { cwd: work, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const pkg = JSON.parse(readFileSync(join(work, 'p1/package.json'), 'utf8'))
  assert.equal(pkg.devDependencies['@bildr/nuxt'], `^${version}`)
  assert.ok(statSync(join(work, 'p1/.bildr')).isDirectory(), 'p1/.bildr exists')
  console.log(ok.stdout.trimEnd())
  console.log(`p1/package.json: "@bildr/nuxt": "${pkg.devDependencies['@bildr/nuxt']}", p1/.bildr/ exists`)

  step('a tampered checksum aborts and installs nothing')
  const tampered = join(scratch, 'tampered')
  cpSync(dist, tampered, { recursive: true })
  const sums = readFileSync(join(tampered, 'SHA256SUMS'), 'utf8')
  writeFileSync(join(tampered, 'SHA256SUMS'), `${(sums[0] === '0' ? '1' : '0')}${sums.slice(1)}`)
  const bad = await serve(tampered)
  servers.push(bad)
  const badHome = join(scratch, 'install-bad')
  const refused = await install({ BILDR_DOWNLOAD_URL: bad.url, BILDR_INSTALL: badHome })
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /checksum mismatch/)
  assert.ok(!existsSync(join(badHome, 'bin', 'create-bildr')), 'nothing installed')
  console.log(refused.stderr.trimEnd())

  step('file:// downloads; no PATH hint when the bin dir is on PATH')
  const fileHome = join(scratch, 'install-file')
  const viaFile = await install({ BILDR_DOWNLOAD_URL: `file://${dist}`, BILDR_INSTALL: fileHome, PATH: `${join(fileHome, 'bin')}:${process.env.PATH}` })
  assert.equal(viaFile.status, 0, viaFile.stderr)
  assert.doesNotMatch(viaFile.stdout, /export PATH/)
  assert.ok(existsSync(join(fileHome, 'bin', 'create-bildr')))

  step('a truncated download runs nothing')
  const lines = readFileSync(join(dist, 'install.sh'), 'utf8').split('\n')
  assert.equal(lines.filter(Boolean).at(-1), 'main "$@"', 'the last line calls main')
  const cutAt = lines.findIndex(line => line.trim().startsWith('# --- install'))
  assert.ok(cutAt > 0, 'install.sh has an install section')
  const partial = join(scratch, 'partial-install.sh')
  writeFileSync(partial, lines.slice(0, cutAt).join('\n'))
  const cutHome = join(scratch, 'install-cut')
  const cut = await install({ BILDR_DOWNLOAD_URL: release.url, BILDR_INSTALL: cutHome }, partial)
  assert.doesNotMatch(cut.stdout, /Downloading/, 'a script cut before the install section downloads nothing')
  assert.ok(!existsSync(join(cutHome, 'bin', 'create-bildr')))
  writeFileSync(partial, lines.slice(0, lines.lastIndexOf('main "$@"')).join('\n'))
  const noCall = await install({ BILDR_DOWNLOAD_URL: release.url, BILDR_INSTALL: cutHome }, partial)
  assert.equal(noCall.stdout, '', 'a script without its last line prints nothing')
  assert.ok(!existsSync(join(cutHome, 'bin', 'create-bildr')), 'a script without its last line installs nothing')

  step('BILDR_VERSION: 0.1.0 and v0.1.0 are accepted, anything else is refused')
  const curlLog = join(scratch, 'curl.log')
  const failingCurl = fakeBin('curl', { curl: `echo "$@" >> "${curlLog}"; exit 22` })
  const releases = 'https://github.com/webbegg/bildr/releases/download'
  for (const [given, tag] of [['0.1.0', 'v0.1.0'], ['v0.1.0', 'v0.1.0'], ['v0.2.0-rc.1', 'v0.2.0-rc.1'], ['0.2.0-rc.1', 'v0.2.0-rc.1']]) {
    const picked = await install({ PATH: failingCurl, BILDR_VERSION: given, BILDR_INSTALL: join(scratch, 'install-ver') })
    assert.notEqual(picked.status, 0)
    assert.match(picked.stdout, new RegExp(`Downloading create-bildr-\\S+ from ${releases}/${tag.replaceAll('.', '\\.')}\\n`), `${given} downloads from ${tag}`)
  }
  for (const bad of ['latest', 'v1', 'v1.2', '1.0.0; touch pwned', 'v1.0.0/../x', '../v1.0.0', 'vv1.0.0', 'v1.0.0-', 'v1.0.0 ']) {
    rmSync(curlLog, { force: true })
    const refusedVersion = await install({ PATH: failingCurl, BILDR_VERSION: bad, BILDR_INSTALL: join(scratch, 'install-ver') })
    assert.notEqual(refusedVersion.status, 0, `${JSON.stringify(bad)} is refused`)
    assert.match(refusedVersion.stderr, /BILDR_VERSION/, `${JSON.stringify(bad)} names the variable`)
    assert.ok(!existsSync(curlLog), `${JSON.stringify(bad)} downloads nothing`)
  }
  console.log((await install({ PATH: failingCurl, BILDR_VERSION: 'latest' })).stderr.trimEnd())

  step('Alpine/musl is refused clearly')
  const musl = fakeBin('musl', {
    uname: unameOf('Linux', 'x86_64'),
    ldd: 'echo "musl libc (x86_64)" >&2; echo "Version 1.2.5" >&2; exit 1'
  })
  const muslHome = join(scratch, 'install-musl')
  const onMusl = await install({ PATH: musl, BILDR_DOWNLOAD_URL: release.url, BILDR_INSTALL: muslHome })
  assert.notEqual(onMusl.status, 0)
  assert.match(onMusl.stderr, /Alpine\/musl isn't supported yet/)
  assert.ok(!existsSync(join(muslHome, 'bin', 'create-bildr')), 'nothing installed')
  console.log(onMusl.stderr.trimEnd())

  step('Rosetta on macOS installs the arm64 binary')
  for (const [translated, expected] of [['1', 'darwin-arm64'], ['0', 'darwin-x64']]) {
    const mac = fakeBin(`mac-${translated}`, { uname: unameOf('Darwin', 'x86_64'), sysctl: `echo ${translated}` })
    const onMac = await install({ PATH: mac, BILDR_DOWNLOAD_URL: `file://${join(scratch, 'empty')}`, BILDR_INSTALL: join(scratch, 'install-mac') })
    assert.notEqual(onMac.status, 0, 'the fake release has no binary')
    assert.match(onMac.stdout, new RegExp(`Downloading create-bildr-${expected} from`), `proc_translated=${translated} picks ${expected}`)
  }
  const noSysctl = fakeBin('mac-nosysctl', { uname: unameOf('Darwin', 'x86_64'), sysctl: 'exit 1' })
  const intel = await install({ PATH: noSysctl, BILDR_DOWNLOAD_URL: `file://${join(scratch, 'empty')}`, BILDR_INSTALL: join(scratch, 'install-mac') })
  assert.match(intel.stdout, /Downloading create-bildr-darwin-x64 from/, 'a failing sysctl keeps x64')

  step('an unsupported OS is refused clearly')
  const plan9 = fakeBin('os', { uname: 'echo Plan9' })
  const unsupported = await install({ PATH: plan9, BILDR_DOWNLOAD_URL: release.url, BILDR_INSTALL: join(scratch, 'install-os') })
  assert.notEqual(unsupported.status, 0)
  assert.match(unsupported.stderr, /unsupported OS: Plan9/)
  console.log(unsupported.stderr.trimEnd())

  console.log('\ntest-install: all checks passed')
} finally {
  for (const server of servers) server.close()
  rmSync(scratch, { recursive: true, force: true })
}
