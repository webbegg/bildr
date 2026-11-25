import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { STARTER_CORE_FILES } from '../../../codegen/src/starter/core-files.ts'

// The generated app's core composable relies on Nuxt's auto-imports: the Vue ones it uses, as globals.
// It is loaded from the starter's copy, outside the fixture (whose tsconfig needs a Nuxt build).
for (const name of ['ref', 'computed', 'watch', 'toValue', 'useTemplateRef', 'onMounted', 'onBeforeUnmount'] as const) vi.stubGlobal(name, vue[name])
// From the working directory, the repository root or packages/editor (happy-dom gives test modules no file URL).
const cache = join([resolve('packages/editor'), resolve('.')].find(path => existsSync(join(path, 'test/canvas')))!, 'node_modules/.cache')
mkdirSync(cache, { recursive: true })
const file = join(mkdtempSync(join(cache, 'bildr-variant-state-')), 'useVariantState.ts')
writeFileSync(file, STARTER_CORE_FILES['layers/core/app/composables/useVariantState.ts']!)
const { useVariantState } = await import(/* @vite-ignore */ file) as {
  useVariantState: <V extends string>(variant: V, machine: { interactions?: Partial<Record<V, Array<{ on: string, to: V }>>> }) => {
    variant: vue.Ref<V>
    on: { keydown: (event: KeyboardEvent) => void }
  }
}

const key = (name: string, onRoot = true) => {
  const root = {}
  return { key: name, target: onRoot ? root : {}, currentTarget: root, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

// codegen-architecture T2: a root a click switches is a button to the keyboard (role="button" tabindex="0" in the template).
describe('useVariantState: the keyboard', () => {
  const machine = () => vue.effectScope().run(() => useVariantState<'default' | 'open'>('default', {
    interactions: { default: [{ on: 'click', to: 'open' }], open: [{ on: 'click', to: 'default' }] }
  }))!

  it.each(['Enter', ' '])('switches on %j on the root, as a click does, and keeps Space from scrolling', (name) => {
    const { variant, on } = machine()
    const event = key(name)
    on.keydown(event)
    expect(variant.value).toBe('open')
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('ignores other keys, and keys on a control inside (its own click bubbles to the root)', () => {
    const { variant, on } = machine()
    on.keydown(key('a'))
    on.keydown(key('Enter', false))
    expect(variant.value).toBe('default')
  })
})
