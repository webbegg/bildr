import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EditorInput from '../src/components/kit/EditorInput.vue'

const source = (path: string) => readFileSync(join(import.meta.dirname, '..', path), 'utf8')

describe('the editor chrome (the hosted editor\'s dark UI, U1)', () => {
  it('is on the editor page and not on the canvas, which keeps the project theme', () => {
    expect(source('index.html')).toMatch(/<html[^>]*class="bildr-editor"/)
    expect(source('canvas.html')).not.toContain('bildr-editor')
    expect(source('src/canvas/main.ts')).not.toContain('main.css')
  })

  it('maps Nuxt UI onto the chrome palette, with one selection accent', () => {
    const css = source('src/main.css')
    expect(css).toContain('html.bildr-editor,\n.bildr-chrome {')
    expect(css).toContain('--editor-selection: #09f;')
    expect(css).toContain('--ui-primary: var(--editor-selection);')
    expect(css).toContain('--ui-bg: var(--editor-page);')
  })

  it('bundles its font, as the CSP allows no font service', () => {
    expect(source('src/main.ts')).toContain('@fontsource-variable/inter')
    expect(source('src/main.css')).toContain('\'Inter Variable\'')
    expect(source('src/main.css')).not.toMatch(/fonts\.googleapis|@import url\(/)
  })
})

describe('the kit field (EditorInput)', () => {
  it('commits once on change (blur or Enter) with commit="change", not per keystroke, and Esc reverts the draft', async () => {
    const wrapper = mount(EditorInput, { props: { modelValue: 'Posts', commit: 'change' }, global: { stubs: { UInput: { template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />', props: ['modelValue'] } } } })
    const input = wrapper.get('input')
    const type = async (value: string) => {
      (input.element as HTMLInputElement).value = value
      await input.trigger('input')
    }
    await type('Articles')
    expect(wrapper.emitted('commit')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await input.trigger('change')
    expect(wrapper.emitted('commit')).toEqual([['Articles']])
    await wrapper.setProps({ modelValue: 'Articles' })
    await type('Drafts')
    await input.trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('Articles')
    await input.trigger('change')
    expect(wrapper.emitted('commit')).toHaveLength(1)
  })
})
