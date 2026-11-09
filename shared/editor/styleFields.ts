import type { StyleKey } from '../document/components'

/** How the style panel presents each style key. Keys without options are free CSS values. */

export const STYLE_GROUPS = ['Layout', 'Typography', 'Appearance'] as const

export type StyleGroup = typeof STYLE_GROUPS[number]

export interface StyleField {
  key: StyleKey
  label: string
  group: StyleGroup
  placeholder?: string
  options?: string[]
}

const ALIGN = ['flex-start', 'center', 'flex-end', 'stretch', 'baseline']
const JUSTIFY = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']

export const STYLE_FIELDS: StyleField[] = [
  { key: 'padding', label: 'Padding', group: 'Layout', placeholder: '16px' },
  { key: 'margin', label: 'Margin', group: 'Layout', placeholder: '0 auto' },
  { key: 'gap', label: 'Gap', group: 'Layout', placeholder: '12px' },
  { key: 'width', label: 'Width', group: 'Layout', placeholder: '100%' },
  { key: 'maxWidth', label: 'Max width', group: 'Layout', placeholder: '960px' },
  { key: 'minHeight', label: 'Min height', group: 'Layout', placeholder: '200px' },
  { key: 'alignItems', label: 'Align items', group: 'Layout', options: ALIGN },
  { key: 'justifyContent', label: 'Justify content', group: 'Layout', options: JUSTIFY },
  { key: 'fontSize', label: 'Font size', group: 'Typography', placeholder: '16px' },
  { key: 'fontWeight', label: 'Font weight', group: 'Typography', options: ['300', '400', '500', '600', '700', '800'] },
  { key: 'textAlign', label: 'Text align', group: 'Typography', options: ['left', 'center', 'right', 'justify'] },
  { key: 'color', label: 'Text color', group: 'Typography', placeholder: '#111827' },
  { key: 'backgroundColor', label: 'Background', group: 'Appearance', placeholder: '#f9fafb' },
  { key: 'border', label: 'Border', group: 'Appearance', placeholder: '1px solid #e5e7eb' },
  { key: 'borderRadius', label: 'Radius', group: 'Appearance', placeholder: '8px' }
]
