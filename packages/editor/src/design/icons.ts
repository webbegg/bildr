/** The layer icon of each node type; types the palette doesn't know get the generic one. */
const ICONS: Record<string, string> = {
  Page: 'i-lucide-file',
  Container: 'i-lucide-square-dashed',
  /** The layout presets of a Container (Row, Column, Grid and Card have their legacy types' icons). */
  Stack: 'i-lucide-square-dashed',
  Row: 'i-lucide-columns-3',
  Column: 'i-lucide-rows-3',
  Grid: 'i-lucide-layout-grid',
  Card: 'i-lucide-square',
  Heading: 'i-lucide-heading',
  Text: 'i-lucide-type',
  Image: 'i-lucide-image',
  Button: 'i-lucide-mouse-pointer-click',
  Link: 'i-lucide-link',
  Input: 'i-lucide-text-cursor-input',
  Checkbox: 'i-lucide-square-check',
  List: 'i-lucide-list',
  Form: 'i-lucide-clipboard-list',
  Instance: 'i-lucide-component',
  SlotFill: 'i-lucide-puzzle'
}

export const nodeIcon = (type: string): string => ICONS[type] ?? 'i-lucide-box'
