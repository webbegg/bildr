import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])

// S4: the model and the generator are the pure core. Only zod and relative files, so they run anywhere (editor, module, tests).
describe('@bildr/codegen purity', () => {
  it('imports only zod and relative files', () => {
    const bad = walk(srcRoot).flatMap(file =>
      // Static `import … from '…'` / `export … from '…'` (multi-line too), side-effect `import '…'` and dynamic `import('…')`.
      [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/gm)]
        .map(match => (match[1] ?? match[2] ?? match[3])!)
        .filter(spec => spec !== 'zod' && !spec.startsWith('./') && !spec.startsWith('../'))
        .map(spec => `${relative(srcRoot, file)}: ${spec}`))
    expect(bad).toEqual([])
  })
})
