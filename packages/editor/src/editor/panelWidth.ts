/**
 * The right panel's width, shared by the Design screen (which resizes it) and the Data screen
 * (which shows it at the width left there): 280–480px, 320 by default, remembered across reloads.
 */
export const PANEL_KEY = 'bildr:panel-width'
const PANEL_MIN = 280
const PANEL_MAX = 480
const PANEL_DEFAULT = 320

export const clampPanel = (width: number): number => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(width)))

/** The width remembered, kept within bounds; the default when none was or it is not a number. */
export const storedPanelWidth = (): number => clampPanel(Number(localStorage.getItem(PANEL_KEY)) || PANEL_DEFAULT)
