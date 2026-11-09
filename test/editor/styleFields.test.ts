import { describe, expect, it } from 'vitest'
import { STYLE_TOKENS } from '#shared/design/tokens'
import { STYLE_DEFAULT, styleFieldGroups, styleFieldItems, styleFieldUpdate } from '#shared/editor/styleFields'
import { DRAG_MIME, draggedNodeId, nodeDragType, parseDragPayload } from '#shared/editor/dropTarget'

describe('style fields', () => {
  it('lists every design token once, grouped by its registry group', () => {
    const groups = styleFieldGroups()
    expect(groups.map(g => g.group)).toEqual(['Spacing', 'Size', 'Color', 'Typography', 'Border', 'Effects', 'Layout'])
    expect(groups.flatMap(g => g.fields.map(f => f.key)).sort()).toEqual(STYLE_TOKENS.map(t => t.key).sort())
    expect(groups.find(g => g.group === 'Spacing')!.fields.map(f => f.key)).toContain('mt')
  })

  it('offers "Default" plus the allowed values of a token', () => {
    const items = styleFieldItems(STYLE_TOKENS.find(t => t.key === 'align')!)
    expect(items).toEqual([
      { label: 'Default', value: STYLE_DEFAULT },
      { label: 'left', value: 'left' },
      { label: 'center', value: 'center' },
      { label: 'right', value: 'right' },
      { label: 'justify', value: 'justify' }
    ])
  })

  it('turns a pick into a style update, "Default" clearing the token', () => {
    expect(styleFieldUpdate('mt', '10')).toEqual({ mt: '10' })
    expect(styleFieldUpdate('mt', STYLE_DEFAULT)).toEqual({ mt: null })
  })
})

describe('parseDragPayload', () => {
  it('reads palette components and tree nodes', () => {
    expect(DRAG_MIME).toBe('application/x-bildr')
    expect(parseDragPayload('{"kind":"component","type":"Button"}')).toEqual({ kind: 'component', type: 'Button' })
    expect(parseDragPayload('{"kind":"node","id":"n_1"}')).toEqual({ kind: 'node', id: 'n_1' })
  })

  it('rejects anything else', () => {
    expect(parseDragPayload('')).toBeNull()
    expect(parseDragPayload('not json')).toBeNull()
    expect(parseDragPayload('{"kind":"component"}')).toBeNull()
    expect(parseDragPayload('{"kind":"file","id":"x"}')).toBeNull()
  })

  it('exposes the dragged node id through the dataTransfer types, readable during dragover', () => {
    expect(draggedNodeId([DRAG_MIME, nodeDragType('n_abc1')])).toBe('n_abc1')
    expect(draggedNodeId([DRAG_MIME])).toBeUndefined()
  })
})
