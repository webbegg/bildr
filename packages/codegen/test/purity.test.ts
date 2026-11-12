import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [])

/** Real import/export specifiers (static, side-effect and dynamic), as the TypeScript scanner sees them; code inside strings and templates doesn't count. */
const importsOf = (file: string) => ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map(entry => entry.fileName)

// S4: the model and the generator are the pure core. Only zod and relative files, so they run anywhere (editor, module, tests).
describe('@bildr/codegen purity', () => {
  it('imports only zod and relative files', () => {
    const bad = walk(srcRoot).flatMap(file => importsOf(file)
      .filter(spec => spec !== 'zod' && !spec.startsWith('./') && !spec.startsWith('../'))
      .map(spec => `${relative(srcRoot, file)}: ${spec}`))
    expect(bad).toEqual([])
  })

  it('sees through code inside template strings but catches real imports', () => {
    expect(ts.preProcessFile('const t = `\nimport x from \'node:fs\'\n`\nimport { z } from \'zod\'\nawait import(\'node:os\')', true, true).importedFiles.map(entry => entry.fileName))
      .toEqual(['zod', 'node:os'])
  })
})
