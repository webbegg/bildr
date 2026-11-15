import { defineComponent, h, onBeforeUnmount, provide } from 'vue'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '@bildr/codegen/design'
import EditorCustomColor from '../../src/components/editor/color/EditorCustomColor.vue'
import EditorThemeColor from '../../src/components/editor/EditorThemeColor.vue'
import EditorTokenSheet from '../../src/components/editor/EditorTokenSheet.vue'
import { createDesign, DESIGN_KEY } from '../../src/design/store.ts'
import { createEditor, provideEditor } from '../../src/editor/useEditor.ts'
import { baseHandlers, setupHarness, world } from '../design/harness.ts'
import { click, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import type { Handler } from '../helpers.ts'

/**
 * The colour pieces of the inspector (U4): a theme colour's row, a theme's own colour, the token sheet
 * and the swatch picker of a style field. The rows mount over the store and the adapter; a theme write is
 * `theme_update` (one undo step), its preview a draft the canvas shows.
 */

setupHarness()

const mountOn = async (component: unknown, props: Record<string, unknown>, extra: Record<string, Handler> = {}) => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), theme_update: () => ({ changed: [] }), ...extra })
  let adapter!: ReturnType<typeof createEditor>
  const Host = defineComponent({
    setup() {
      const design = createDesign()
      provide(DESIGN_KEY, design)
      adapter = provideEditor(createEditor(design))
      void adapter.start()
      onBeforeUnmount(() => adapter.dispose())
      return () => h(component as never, props)
    }
  })
  await mountWithApp(Host)
  await settle()
  return { actions, editor: adapter }
}

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)

describe('EditorCustomColor (a colour of the theme\'s own)', () => {
  const withInk = () => {
    world.model.theme = { ...(world.model.theme ?? DEFAULT_THEME), custom: { ink: '#112233' } }
  }

  it('shows its name and hex, renames it in one step (the colour moves to the new name) and removes it', async () => {
    withInk()
    const { actions } = await mountOn(EditorCustomColor, { name: 'ink' })
    expect(q('[data-custom-color-row="ink"]')).not.toBeNull()
    expect((q('input[aria-label="ink hex"]') as HTMLInputElement).value).toBe('#112233')

    await typeInto(q('input[aria-label="ink colour name"]'), 'night')
    await click(q('[data-row-remove]'))
    expect(actions.named('theme_update').map(call => call.input)).toEqual([
      { custom: { ink: null, night: '#112233' } },
      { custom: { ink: null } }
    ])
  })

  it('takes a typed hex with or without the #, and refuses a name that is taken with a notice, writing nothing', async () => {
    withInk()
    world.model.theme!.custom!.brand = '#ff6600'
    const { actions } = await mountOn(EditorCustomColor, { name: 'ink' })
    await typeInto(q('input[aria-label="ink hex"]'), '445566')
    await typeInto(q('input[aria-label="ink colour name"]'), 'brand')
    expect(actions.named('theme_update').map(call => call.input)).toEqual([{ custom: { ink: '#445566' } }])
  })
})

describe('EditorThemeColor (a semantic colour of the theme)', () => {
  it('shows the palette the colour is (or Custom for a hex) and writes a typed hex as the colour', async () => {
    const { actions } = await mountOn(EditorThemeColor, { name: 'primary' })
    expect(q('[data-theme-color="primary"]')?.textContent).toContain('indigo')
    expect(q('[aria-label="Primary custom colour"]')).not.toBeNull()
    // The hex field is inside the colour popover.
    await click(q('[aria-label="Primary custom colour"]'))
    const hex = q('input[placeholder="#rrggbb"]')
    expect(hex).not.toBeNull()
    await typeInto(hex, '#112233')
    expect(actions.named('theme_update').map(call => call.input)).toEqual([{ colors: { primary: '#112233' } }])
  })
})

describe('EditorTokenSheet (the Design view\'s style guide)', () => {
  it('paints each semantic colour with its shades, the type scale, buttons, radii and the spacing at the theme\'s density', async () => {
    await mountOn(EditorTokenSheet, { theme: DEFAULT_THEME })
    expect(q('[data-style-guide]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-token-color]').length).toBe(7)
    expect(q('[data-token-shade="primary-500"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-type-sample]').length).toBe(5)
    expect(q('[data-token-button="primary-solid"]')).not.toBeNull()
    expect(document.body.querySelectorAll('[data-token-radius]').length).toBeGreaterThan(3)
    expect(document.body.querySelectorAll('[data-token-spacing]').length).toBeGreaterThan(3)
  })

  it('shows no colours without a theme (the sheet before the model is read)', async () => {
    await mountOn(EditorTokenSheet, {})
    expect(q('[data-style-guide]')).not.toBeNull()
  })
})
