import { describe, expect, it, vi } from 'vitest'
import { THEME_PRESETS } from '../../../codegen/src/edit/theme.ts'
import { DEFAULT_THEME } from '../../../codegen/src/design/index.ts'
import { click, Failure, settle } from '../helpers.ts'
import { byLabel, combo, menuLabels, must, open, openDesignSystem, selectOption, sent, setupHarness, world } from './harness.ts'

/**
 * The design system in the Design screen (P4c, U5, V1, V2): the theme library (the bundled presets,
 * `theme_presets_list` and `theme_apply`) on the left, the theme's panel on the right (semantic colours,
 * custom colours, font, radius, spacing; `theme_update`), and the style guide in the canvas.
 */

setupHarness()

const ok = () => ({ changed: [] })
const handlers = () => ({
  theme_presets_list: () => ({ presets: THEME_PRESETS }),
  theme_update: ok,
  theme_apply: ok
})
const openTheme = async (extra: Record<string, () => unknown> = {}) => {
  const mounted = await open({ ...handlers(), ...extra })
  await openDesignSystem()
  return mounted
}
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]

describe('Theme library', () => {
  it('lists the bundled presets with their swatches and font, and checks the one the project\'s theme is', async () => {
    const ocean = THEME_PRESETS.find(preset => preset.id === 'ocean')!
    world.model.theme = { ...ocean.theme, custom: { ink: '#112233' } }
    const { actions } = await openTheme()
    expect(actions.named('theme_presets_list').length).toBeGreaterThan(0)
    expect(qa('[data-theme-row]').map(row => row.dataset.themeRow)).toEqual(THEME_PRESETS.map(preset => preset.id))
    expect(qa('[data-theme-name]').map(name => name.textContent?.trim())).toEqual(THEME_PRESETS.map(preset => preset.name))
    expect(qa('[data-theme-current]').map(mark => mark.closest<HTMLElement>('[data-theme-row]')?.dataset.themeRow)).toEqual(['ocean'])
    expect(q('[data-theme-row="ocean"] [data-theme-swatches]')?.children).toHaveLength(3)
    expect(q('[data-theme-library]')?.textContent).toContain(String(THEME_PRESETS.length))
  })

  it('applies a preset with a click on its row, and says so with a way back (undo)', async () => {
    const { actions } = await openTheme()
    await click(must('[data-theme-row="ocean"] [data-theme-apply]'))
    expect(actions.named('theme_apply').map(call => call.input)).toEqual([{ preset: 'ocean' }])
    expect(document.body.textContent).toContain('Applied Ocean')
    expect(document.body.textContent).toContain('Undo restores the previous theme.')
  })

  it('applies a preset from the row\'s menu too, which has only that: a bundled preset is not saved, renamed, duplicated or deleted', async () => {
    const { actions } = await openTheme()
    expect(q('[data-theme-save]')).toBeNull()
    expect(await menuLabels(must('[data-theme-row="forest"] [aria-label="Theme actions"]'))).toEqual(['Apply'])
    await click(qa('[role^="menuitem"]')[0] ?? null)
    expect(actions.named('theme_apply').map(call => call.input)).toEqual([{ preset: 'forest' }])
  })

  it('shows the module\'s refusal of an apply', async () => {
    await openTheme({ theme_apply: () => new Failure(422, 'invalid', 'No theme preset "ocean"') })
    await click(must('[data-theme-row="ocean"] [data-theme-apply]'))
    expect(must('[data-testid="design-error"]').textContent?.trim()).toBe('No theme preset "ocean"')
  })
})

describe('Design panel', () => {
  it('shows the theme\'s colours, custom colours, font, radius and spacing from the model', async () => {
    world.model.theme = { ...DEFAULT_THEME, custom: { ink: '#112233' } }
    await openTheme()
    expect(qa('[data-theme-color]').map(row => row.dataset.themeColor)).toEqual(['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'])
    expect(qa('[data-custom-color-row]').map(row => row.dataset.customColorRow)).toEqual(['ink'])
    expect(combo('[aria-label="Font"]').textContent).toContain(DEFAULT_THEME.font === 'system' ? 'System UI' : DEFAULT_THEME.font)
    expect(combo('[aria-label="Radius"]').textContent).toContain(DEFAULT_THEME.radius)
    expect(combo('[aria-label="Spacing density"]').textContent?.toLowerCase()).toContain(DEFAULT_THEME.spacing)
    expect(q('[data-design-panel]')?.textContent).toMatch(/rounded-sm = [\d.]+px, rounded-lg = [\d.]+px/)
    expect(q('[data-design-panel]')?.textContent).toMatch(/mt-10 = [\d.]+px/)
  })

  it('changes radius, font and spacing, one theme_update each', async () => {
    const { actions } = await openTheme()
    await selectOption(combo('[aria-label="Radius"]'), '0.5rem')
    await selectOption(combo('[aria-label="Font"]'), 'Poppins')
    await selectOption(combo('[aria-label="Spacing density"]'), 'Comfortable')
    expect(actions.named('theme_update').map(call => call.input)).toEqual([{ radius: '0.5rem' }, { font: 'Poppins' }, { spacing: 'comfortable' }])
  })

  it('adds a custom colour named in a prompt, a name the module can keep (kebab-case), and removes one from its row', async () => {
    world.model.theme = { ...DEFAULT_THEME, custom: { ink: '#112233' } }
    vi.stubGlobal('prompt', vi.fn(() => 'Brand Orange'))
    const { actions } = await openTheme()
    await click(must('[data-custom-colors] [data-section-action="add"]'))
    await settle()
    // The + opens its one-item menu.
    await click(qa('[role^="menuitem"]').find(item => item.textContent?.trim().startsWith('New colour')) ?? null)
    await click(must('[data-custom-color-row="ink"] [data-row-remove]'))
    expect(actions.named('theme_update').map(call => call.input)).toEqual([{ custom: { 'brand-orange': '#6366f1' } }, { custom: { ink: null } }])
  })

  it('refuses a custom colour name that is taken with a notice, writing nothing', async () => {
    world.model.theme = { ...DEFAULT_THEME, custom: { ink: '#112233' } }
    vi.stubGlobal('prompt', vi.fn(() => 'ink'))
    const { actions } = await openTheme()
    await click(must('[data-custom-colors] [data-section-action="add"]'))
    await click(qa('[role^="menuitem"]').find(item => item.textContent?.trim().startsWith('New colour')) ?? null)
    expect(actions.named('theme_update')).toEqual([])
    expect(document.body.textContent).toContain('Colour not created')
  })

  it('has no project-library or token-sheet buttons: the style guide follows the view', async () => {
    await openTheme()
    expect(byLabel('Token sheet')).toBeNull()
    expect(sent('bildr:render').at(-1)?.view).toBe('tokens')
  })
})
