import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// T12 (D13): the four packages are publishable. In the workspace they run from src/*.ts;
// `pnpm pack`/`publish` swaps in the publishConfig fields, which point at the tsc build in dist/.

interface Manifest {
  name: string
  version: string
  private?: boolean
  license?: string
  description?: string
  repository?: { type: string, url: string, directory: string }
  engines?: { node?: string }
  files?: string[]
  scripts?: Record<string, string>
  exports?: Record<string, string>
  bin?: Record<string, string>
  publishConfig?: { access?: string, exports?: Record<string, { types: string, default: string }>, bin?: Record<string, string> }
}

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')) as Manifest
const NODE_PACKAGES = ['codegen', 'nuxt', 'create-bildr'] as const
const PUBLISHED = [...NODE_PACKAGES, 'editor'] as const

describe('publishable packages', () => {
  // `pnpm release` writes the new version before it runs the tests, so they read it, not pin it.
  it('all share one x.y.z version', () => {
    const versions = new Set([...PUBLISHED, 'editor-core'].map(dir => read(`packages/${dir}/package.json`).version))
    expect(versions.size).toBe(1)
    expect([...versions][0]).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it.each(PUBLISHED)('%s has the npm metadata and ships only dist', (dir) => {
    const pkg = read(`packages/${dir}/package.json`)
    expect(pkg.private).toBeUndefined()
    expect(pkg.version).toBe(read('packages/nuxt/package.json').version)
    expect(pkg.license).toBe('MIT')
    expect(pkg.description).toBeTruthy()
    expect(pkg.repository).toEqual({ type: 'git', url: 'git+https://github.com/webbegg/bildr.git', directory: `packages/${dir}` })
    expect(pkg.files).toEqual(['dist'])
    expect(pkg.publishConfig?.access).toBe('public')
    expect(pkg.scripts?.prepack).toBe('pnpm run build')
  })

  it.each(NODE_PACKAGES)('%s builds with tsc and publishes dist in place of src', (dir) => {
    const pkg = read(`packages/${dir}/package.json`)
    expect(pkg.engines?.node).toBe('>=22.18.0')
    // dist/ is emptied first, so a renamed or deleted source never ships as a stale .js.
    expect(pkg.scripts?.build).toBe(`node -e "fs.rmSync('dist', { recursive: true, force: true })" && tsc -p tsconfig.build.json`)
    const published = pkg.publishConfig?.exports ?? {}
    expect(Object.keys(published)).toEqual(Object.keys(pkg.exports ?? {}))
    for (const [key, source] of Object.entries(pkg.exports ?? {})) {
      expect(source, key).toMatch(/^\.\/src\/.+\.ts$/)
      const built = source.replace(/^\.\/src\//, './dist/')
      expect(published[key], key).toEqual({ types: built.replace(/\.ts$/, '.d.ts'), default: built.replace(/\.ts$/, '.js') })
    }
  })

  it('create-bildr publishes a JS bin', () => {
    const pkg = read('packages/create-bildr/package.json')
    expect(pkg.bin).toEqual({ 'create-bildr': './src/cli.ts' })
    expect(pkg.publishConfig?.bin).toEqual({ 'create-bildr': './dist/cli.js' })
    expect(readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/)
  })

  it('the workspace root stays private', () => {
    expect(read('package.json').private).toBe(true)
  })
})
