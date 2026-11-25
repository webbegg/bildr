import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { STARTER_CORE_FILES } from '../../../codegen/src/starter/core-files.ts'

// The generated app's core composable relies on Nuxt's auto-imports: the Vue ones it uses, as globals.
// It is loaded from the starter's copy, outside the fixture (whose tsconfig needs a Nuxt build).
for (const name of ['ref', 'computed', 'watch', 'toValue', 'useTemplateRef', 'onMounted', 'onBeforeUnmount'] as const) vi.stubGlobal(name, vue[name])
// From the working directory, the repository root or packages/editor (happy-dom gives test modules no file URL).
const editor = [resolve('packages/editor'), resolve('.')].find(path => existsSync(join(path, 'test/canvas')))
if (!editor) throw new Error('run from the repository root or packages/editor')
const cache = join(editor, 'node_modules/.cache')
mkdirSync(cache, { recursive: true })
const dir = mkdtempSync(join(cache, 'bildr-variant-state-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const file = join(dir, 'useVariantState.ts')
writeFileSync(file, STARTER_CORE_FILES['layers/core/app/composables/useVariantState.ts']!)
const { useVariantState } = await import(/* @vite-ignore */ file) as {
  useVariantState: <V extends string>(variant: V, machine: { interactions?: Partial<Record<V, Array<{ on: string, to: V }>>> }) => {
    variant: vue.Ref<V>
    on: { keydown: (event: KeyboardEvent) => void }
  }
}

/** A root bound to the composable's `on.keydown`, as `v-on="on"` binds it; `role="button"` is what the generator gives a clickable root. */
const mount = (role?: string) => {
  const { variant, on } = vue.effectScope().run(() => useVariantState<'default' | 'open'>('default', {
    interactions: { default: [{ on: 'click', to: 'open' }], open: [{ on: 'click', to: 'default' }] }
  }))!
  const root = document.createElement('div')
  if (role) root.setAttribute('role', role)
  root.addEventListener('keydown', on.keydown)
  const inner = root.appendChild(document.createElement('span'))
  const press = (key: string, init: KeyboardEventInit = {}, target: Element = root) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }
  return { variant, inner, press }
}

// codegen-architecture T2: a root a click switches is a button to the keyboard (role="button" tabindex="0" in the template).
describe('useVariantState: the keyboard', () => {
  it.each(['Enter', ' '])('switches on %j on a button root, as a click does, and keeps Space from scrolling', (key) => {
    const { variant, press } = mount('button')
    expect(press(key).defaultPrevented).toBe(true)
    expect(variant.value).toBe('open')
  })

  it('ignores other keys, held keys, shortcuts and keys on an element inside (a control\'s own click bubbles to the root)', () => {
    const { variant, inner, press } = mount('button')
    press('a')
    press('Enter', { repeat: true })
    press('Enter', { ctrlKey: true })
    press('Enter', {}, inner)
    expect(variant.value).toBe('default')
  })

  it('leaves a root that is no button alone (a native Button or Link root activates by itself)', () => {
    const { variant, press } = mount()
    expect(press('Enter').defaultPrevented).toBe(false)
    expect(variant.value).toBe('default')
  })
})
