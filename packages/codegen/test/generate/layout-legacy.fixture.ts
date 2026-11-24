import type { ModelNode } from '../../src/model/schemas'

/**
 * Legacy layout containers (Row, Column, Grid, Card, Container), as stored
 * before the one-container model: the oracle that their markup and canvas
 * classes never change (layout-containers S4).
 */
export const LEGACY_LAYOUT_TREE: ModelNode = {
  id: 'n_legacy', type: 'Container', props: { tag: 'section' }, style: { p: '4', gap: '3', items: 'start' },
  children: [
    {
      id: 'n_row', type: 'Row', props: { wrap: true }, style: { 'gap': '3', 'items': 'center', 'md:gap': '6' },
      children: [
        { id: 'n_row_text', type: 'Text', props: { text: 'a' } },
        { id: 'n_row_box', type: 'Container', style: { w: 'full' } },
        { id: 'n_row_col', type: 'Column', style: { gap: '2' } }
      ]
    },
    { id: 'n_row_plain', type: 'Row', props: { tag: 'nav' }, style: { justify: 'between' }, children: [{ id: 'n_row_plain_text', type: 'Text', props: { text: 'b' } }] },
    {
      id: 'n_column', type: 'Column', style: { 'gap': '3', 'items': 'start', 'md:direction': 'row' },
      children: [
        { id: 'n_column_heading', type: 'Heading', props: { text: 'c', level: 3 }, style: { align: 'center' } },
        { id: 'n_column_row', type: 'Row', style: { gap: '1' } },
        { id: 'n_column_button', type: 'Button', props: { text: 'd' } }
      ]
    },
    {
      id: 'n_grid', type: 'Grid', style: { 'cols': '3', 'gap': '6', 'md:cols': '4' },
      children: [
        { id: 'n_grid_wide', type: 'Container', style: { colSpan: '2' } },
        { id: 'n_grid_text', type: 'Text', props: { text: 'e' } }
      ]
    },
    {
      id: 'n_card', type: 'Card', style: { gap: '3', items: 'start', p: '4', direction: 'row' },
      children: [
        { id: 'n_card_text', type: 'Text', props: { text: 'f' } },
        { id: 'n_card_box', type: 'Container' }
      ]
    },
    { id: 'n_stack_row', type: 'Container', style: { direction: 'row', gap: '2' }, children: [{ id: 'n_stack_row_box', type: 'Container' }] },
    { id: 'n_stack_grid', type: 'Column', style: { display: 'grid', cols: '2' }, children: [{ id: 'n_stack_grid_box', type: 'Container' }] }
  ]
}
