import { describe, expect, it } from 'vitest'
import { THEME_PRESETS } from '../../../codegen/src/edit/theme.ts'
import { DEFAULT_THEME, themeOptions } from '../../../codegen/src/design/index.ts'
import { allByTestId, byTestId, click, typeInto } from '../helpers.ts'
import { check, choose, open, sent, setupHarness, world } from './harness.ts'

/**
 * The design system in the Design screen (P4c, V1, V2): the Theme panel (semantic
 * colours with a palette picker or a hex, custom colours, radius, font, spacing,
 * presets), the dark preview and the token sheet in the canvas.
 */

setupHarness()

const ok = () => ({ changed: [] })
const handlers = () => ({
  theme_get: () => ({ theme: world.model.theme ?? DEFAULT_THEME, options: themeOptions() }),
  theme_presets_list: () => ({ presets: THEME_PRESETS }),
  theme_update: ok,
  theme_apply: ok
})
const openTheme = async (extra: Record<string, () => unknown> = {}) => {
  const mounted = await open({ ...handlers(), ...extra })
  await click(byTestId('tab-theme'))
  return mounted
}

describe('Theme panel', () => {
  it('reads the theme and its options with theme_get when it opens, and shows the current values', async () => {
    const { actions } = await openTheme()
    expect(actions.named('theme_get').length).toBeGreaterThan(0)
    expect((byTestId('theme-radius') as HTMLSelectElement).value).toBe('0.375rem')
    expect((byTestId('theme-font') as HTMLSelectElement).value).toBe('Inter')
    expect((byTestId('color-primary-hex') as HTMLInputElement).value).toBe('indigo')
    expect([...(byTestId('theme-radius') as HTMLSelectElement).options].map(option => option.value)).toEqual(themeOptions().radii)
  })

  it('changes a semantic colour with the palette picker, and with a hex', async () => {
    const { actions } = await openTheme()
    expect(byTestId('color-primary-pick-emerald')).toBeNull()
    await click(byTestId('color-primary'))
    await click(byTestId('color-primary-pick-emerald'))
    await typeInto(byTestId('color-primary-hex'), '#FF8800')
    expect(actions.named('theme_update').map(call => call.input)).toEqual([{ colors: { primary: 'emerald' } }, { colors: { primary: '#ff8800' } }])
  })

  it('refuses a hex that is not one, without calling the action', async () => {
    const { actions } = await openTheme()
    await typeInto(byTestId('color-primary-hex'), 'blurple')
    expect(actions.named('theme_update')).toEqual([])
    expect(byTestId('theme-error')?.textContent).toContain('palette name or a hex')
  })

  it('changes radius, font and spacing', async () => {
    const { actions } = await openTheme()
    await choose('theme-radius', '0.5rem')
    await choose('theme-font', 'Poppins')
    await choose('theme-spacing', 'comfortable')
    expect(actions.named('theme_update').map(call => call.input)).toEqual([{ radius: '0.5rem' }, { font: 'Poppins' }, { spacing: 'comfortable' }])
  })

  it('adds and removes a custom colour', async () => {
    world.model.theme = { ...DEFAULT_THEME, custom: { ink: '#112233' } }
    const { actions } = await openTheme()
    await typeInto(byTestId('custom-new-name'), 'Brand Orange')
    await typeInto(byTestId('custom-new-hex'), '#ff6600')
    await click(byTestId('custom-add'))
    await click(byTestId('custom-remove-ink'))
    expect(actions.named('theme_update').map(call => call.input)).toEqual([{ custom: { 'brand-orange': '#ff6600' } }, { custom: { ink: null } }])
  })

  it('lists the presets and applies one', async () => {
    const { actions } = await openTheme()
    expect(allByTestId('preset').map(row => row.textContent?.trim())).toEqual(THEME_PRESETS.map(preset => preset.name))
    await click(byTestId('preset-ocean'))
    expect(actions.named('theme_apply').map(call => call.input)).toEqual([{ preset: 'ocean' }])
  })

  it('previews dark mode and the token sheet in the canvas', async () => {
    await openTheme()
    await check('theme-dark', true)
    expect(sent('bildr:dark').at(-1)).toEqual({ type: 'bildr:dark', dark: true })
    await click(byTestId('theme-tokens'))
    expect(sent('bildr:render').at(-1)?.view).toBe('tokens')
    await click(byTestId('theme-tokens'))
    expect(sent('bildr:render').at(-1)?.view).toBe('page')
  })
})
