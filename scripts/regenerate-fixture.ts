// Regenerates a golden fixture from its model (.bildr/) with the current generator: writes what the
// sync plan writes, deletes what it deletes and rewrites the manifest. Run it after a deliberate change
// to the generated output, then review the fixture diff and commit it with the generator change:
//   node scripts/regenerate-fixture.ts [blog|api-only]
// A hand-edited fixture file is reported as detached and left alone (that's a bug to fix in the fixture).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate } from '../packages/codegen/src/generate/index.ts'
import { loadModel } from '../packages/codegen/src/model/load.ts'
import { GENERATOR_VERSION } from '../packages/codegen/src/starter/version.ts'
import { planSync } from '../packages/codegen/src/sync/plan.ts'

const name = process.argv[2] ?? 'blog'
const root = fileURLToPath(new URL(`../fixtures/codegen/${name}/`, import.meta.url))
const bildr = join(root, '.bildr')

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
const files = Object.fromEntries(walk(bildr)
  .filter(path => !relative(bildr, path).startsWith('.cache'))
  .map(path => [relative(root, path), readFileSync(path, 'utf8')]))

const loaded = loadModel(files)
if (!loaded.ok) {
  console.error(JSON.stringify(loaded.problems, null, 2))
  process.exit(1)
}

const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const manifestPath = join(bildr, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const generated = generate(loaded.model)
const paths = new Set([...generated.map(file => file.path), ...Object.keys(manifest.files)])
const disk = Object.fromEntries([...paths].map(path => [path, existsSync(join(root, path)) ? hash(readFileSync(join(root, path), 'utf8')) : undefined]))
const plan = planSync({ generated, manifest: manifest.files, disk, hash })

for (const write of plan.writes) {
  mkdirSync(dirname(join(root, write.path)), { recursive: true })
  writeFileSync(join(root, write.path), write.content)
}
for (const path of plan.deletes) rmSync(join(root, path))
writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, generatorVersion: GENERATOR_VERSION, files: plan.manifest }, null, 2)}\n`)

const { written, deleted, detached, orphaned } = plan.report
console.log(JSON.stringify({ written, deleted, detached, orphaned }, null, 2))
if (detached.length || orphaned.length) process.exit(1)
