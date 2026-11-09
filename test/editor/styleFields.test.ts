import { describe, expect, it } from 'vitest'
import { STYLE_KEYS } from '#shared/document/components'
import { STYLE_FIELDS, STYLE_GROUPS } from '#shared/editor/styleFields'
import { DRAG_MIME, draggedNodeId, nodeDragType, parseDragPayload } from '#shared/editor/dropTarget'

describe('STYLE_FIELDS', () => {
  it('covers every style key once, in a known group', () => {
    expect(STYLE_FIELDS.map(f => f.key).sort()).toEqual([...STYLE_KEYS].sort())
    for (const field of STYLE_FIELDS) expect(STYLE_GROUPS).toContain(field.group)
  })

  it('offers fixed options for the enumerated properties', () => {
    const options = (key: string) => STYLE_FIELDS.find(f => f.key === key)?.options
    expect(options('textAlign')).toEqual(['left', 'center', 'right', 'justify'])
    expect(options('alignItems')).toContain('center')
    expect(options('justifyContent')).toContain('space-between')
    expect(options('fontWeight')).toContain('700')
    expect(options('padding')).toBeUndefined()
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
