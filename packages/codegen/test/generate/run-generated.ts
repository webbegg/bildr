import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/** The core aliases the generated layers import, to their files in the generated project. */
const CORE_ALIASES: Record<string, string> = {
  '#core/kernel/result': 'layers/core/shared/kernel/result.ts',
  '#core/kernel/ids': 'layers/core/shared/kernel/ids.ts',
  '#core/http/client': 'layers/core/shared/http/client.ts'
}

/**
 * Runs generated files for real: `load(path)` transpiles the generated file at `path`, and first every generated file it imports, into
 * `dir`, and imports it. `stubs` stands in for what the app provides (a specifier → the module's code, e.g. `nuxt/server`); `zod` is the
 * package's. Any other import is refused, so a test can't run against something it did not mean to provide.
 */
export const generatedRunner = (sources: Map<string, string>, dir: string, stubs: Record<string, string>) => {
  const zod = import.meta.resolve('zod')
  const emitted = new Set<string>()
  const stubbed = new Map<string, string>()
  const stub = (specifier: string) => {
    if (!stubbed.has(specifier)) {
      const out = join(dir, 'stubs', `${stubbed.size}.mjs`)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, stubs[specifier]!)
      stubbed.set(specifier, pathToFileURL(out).href)
    }
    return stubbed.get(specifier)!
  }
  /** What `specifier`, imported by the generated file `from`, is: a stub, the package, or another generated file. */
  const resolve = (specifier: string, from: string): string | undefined => {
    if (specifier in stubs) return stub(specifier)
    if (specifier === 'zod') return zod
    if (CORE_ALIASES[specifier]) return emit(CORE_ALIASES[specifier])
    if (specifier.startsWith('.')) return emit(`${posix.normalize(posix.join(posix.dirname(from), specifier))}.ts`)
    return undefined
  }
  /** Transpiles `path` (and, first, what it imports) into the directory, its imports pointing at the transpiled files. */
  const emit = (path: string): string => {
    const out = join(dir, `${path}.mjs`)
    if (emitted.has(path)) return pathToFileURL(out).href
    emitted.add(path)
    const source = sources.get(path)
    if (source === undefined) throw new Error(`The generated project has no ${path}`)
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    const rewritten = js.replace(/(\bfrom\s+|\bimport\s+)(['"])([^'"]+)\2/g, (_, keyword: string, quote: string, specifier: string) => {
      const target = resolve(specifier, path)
      if (!target) throw new Error(`${path} imports ${specifier}, which this test does not provide`)
      return `${keyword}${quote}${target}${quote}`
    })
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, rewritten)
    return pathToFileURL(out).href
  }
  return { load: async <T>(path: string): Promise<T> => await import(emit(path)) as T }
}
