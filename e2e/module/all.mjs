/**
 * Runs the module editor's browser scripts in sequence (`pnpm e2e:module`): it boots one project (lib.mjs
 * `boot`: create-bildr, the golden blog model, `nuxt dev` on a free port), runs each script in its own
 * Node process against it (E2E_MODULE_URL, E2E_MODULE_DIR, E2E_MODULE_LOG; each script puts the model back
 * to golden before and after), prints PASS and FAIL counts per script and stops the server it started.
 * Exits 1 when any check failed or a script crashed. `desktop-base` boots its own desktop-first project.
 *
 *   pnpm e2e:module                 # all scripts
 *   pnpm e2e:module shell design    # some of them
 *
 * With E2E_MODULE_URL and E2E_MODULE_DIR set (as `node e2e/module/serve.mjs` prints them) it uses that server
 * instead of booting one. E2E_TMP is the scratch parent; PLAYWRIGHT_CORE and CHROMIUM as in e2e/generated.mjs.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { boot } from './lib.mjs'

// `data`, `remote` and `paging` add and remove a data source (`data`: the Sample data source a new collection makes,
// D7), which changes the app's nuxt config: nuxt restarts, and the dev server's Vite dependency cache is then often
// left answering 504 "Outdated Optimize Dep", so no page of the app renders any more. They run last, after every
// script that renders the generated app (interactions, detail, load-more, visual-editor).
const SCRIPTS = ['shell', 'design', 'design-system', 'kit', 'panel-p1', 'colors-p1', 'menu-p1', 'canvas-p2', 'breakpoints-p2', 'desktop-base', 'components', 'layouts-p2', 'interactions', 'detail', 'detail-ui', 'load-more', 'visual-editor', 'real-browser', 'state', 'data', 'remote', 'paging']

const wanted = process.argv.slice(2)
const names = wanted.length ? wanted : SCRIPTS
for (const name of names) if (!SCRIPTS.includes(name)) throw new Error(`Unknown script "${name}" (known: ${SCRIPTS.join(', ')})`)

function runScript(name, env) {
  return new Promise((resolve) => {
    const started = Date.now()
    const counts = { name, pass: 0, fail: 0, code: 0 }
    const child = spawn(process.execPath, [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url))], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env } })
    let rest = ''
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      const lines = (rest + chunk).split('\n')
      rest = lines.pop()
      for (const line of lines) {
        if (line.startsWith('PASS ')) counts.pass++
        else if (line.startsWith('FAIL ')) counts.fail++
      }
    })
    child.on('close', (code) => {
      if (rest.startsWith('FAIL ')) counts.fail++
      else if (rest.startsWith('PASS ')) counts.pass++
      resolve({ ...counts, code: code ?? 1, seconds: (Date.now() - started) / 1000 })
    })
  })
}

const started = Date.now()
let project
if (!process.env.E2E_MODULE_URL) {
  console.log('booting the project (create-bildr, golden blog model, nuxt dev)...')
  project = await boot()
  console.log(`project ${project.root} at ${project.base}`)
}
const env = project ? { E2E_MODULE_URL: `${project.base}/__bildr?token=${project.token}`, E2E_MODULE_DIR: project.root, E2E_MODULE_LOG: project.log } : {}

const results = []
try {
  for (const name of names) {
    console.log(`\n── ${name} ──`)
    results.push(await runScript(name, env))
  }
} finally {
  await project?.stop()
}

console.log('\nSummary')
for (const r of results) {
  const crashed = r.code !== 0 && r.fail === 0 ? ' (exited with an error)' : r.pass === 0 && r.fail === 0 ? ' (checked nothing)' : ''
  console.log(`  ${r.name.padEnd(14)} ${String(r.pass).padStart(3)} PASS ${String(r.fail).padStart(3)} FAIL  ${r.seconds.toFixed(1)}s${crashed}`)
}
const pass = results.reduce((n, r) => n + r.pass, 0)
const fail = results.reduce((n, r) => n + r.fail, 0)
console.log(`  ${'total'.padEnd(14)} ${String(pass).padStart(3)} PASS ${String(fail).padStart(3)} FAIL  ${((Date.now() - started) / 1000).toFixed(1)}s`)
// A script that checked nothing fails the run: it would otherwise pass vacuously.
if (fail || results.some(r => r.code !== 0 || r.pass + r.fail === 0)) process.exitCode = 1
