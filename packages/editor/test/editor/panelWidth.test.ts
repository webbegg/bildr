import { afterEach, describe, expect, it } from 'vitest'
import { PANEL_KEY, clampPanel, storedPanelWidth } from '../../src/editor/panelWidth.ts'

/** The right panel's width, shared by the Design and Data screens: 280–480px, remembered across reloads. */

describe('the right panel width', () => {
  afterEach(() => localStorage.removeItem(PANEL_KEY))

  it('is kept within 280 and 480', () => {
    expect(clampPanel(100)).toBe(280)
    expect(clampPanel(300.4)).toBe(300)
    expect(clampPanel(900)).toBe(480)
  })

  it('is read from what was remembered, 320 when nothing or nonsense was', () => {
    expect(storedPanelWidth()).toBe(320)
    localStorage.setItem(PANEL_KEY, '400')
    expect(storedPanelWidth()).toBe(400)
    localStorage.setItem(PANEL_KEY, '9999')
    expect(storedPanelWidth()).toBe(480)
    localStorage.setItem(PANEL_KEY, 'wide')
    expect(storedPanelWidth()).toBe(320)
  })
})
