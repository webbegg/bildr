/**
 * Runs every browser script in sequence (each in its own Node process, so one
 * crash doesn't stop the rest) and prints the PASS and FAIL counts per script.
 * Exits 1 when any check failed or a script crashed.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPTS = ['shell', 'design', 'design-system', 'data', 'remote', 'paging', 'kit', 'panel-p1', 'colors-p1', 'menu-p1', 'canvas-p2']

function runScript(name) {
  return new Promise((resolve) => {
    const started = Date.now()
    const counts = { name, pass: 0, fail: 0, code: 0 }
    const child = spawn(process.execPath, [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url))], { stdio: ['ignore', 'pipe', 'inherit'] })
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
const results = []
for (const name of SCRIPTS) {
  console.log(`\n── ${name} ──`)
  results.push(await runScript(name))
}

console.log('\nSummary')
for (const r of results) {
  const crashed = r.code !== 0 && r.fail === 0 ? ' (exited with an error)' : ''
  console.log(`  ${r.name.padEnd(13)} ${String(r.pass).padStart(3)} PASS ${String(r.fail).padStart(3)} FAIL  ${r.seconds.toFixed(1)}s${crashed}`)
}
const pass = results.reduce((n, r) => n + r.pass, 0)
const fail = results.reduce((n, r) => n + r.fail, 0)
console.log(`  ${'total'.padEnd(13)} ${String(pass).padStart(3)} PASS ${String(fail).padStart(3)} FAIL  ${((Date.now() - started) / 1000).toFixed(1)}s`)
if (fail || results.some(r => r.code !== 0)) process.exitCode = 1
