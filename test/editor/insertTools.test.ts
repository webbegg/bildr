import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { INSERT_TOOLS, insertTargetAt, isInsertTool, pointerMode, RESERVED_SHORTCUTS, toolConflicts, toolForKey, toolHint } from '#shared/editor/insertTools'

const key = (k: string, mods: { meta?: boolean, shift?: boolean, alt?: boolean, typing?: boolean } = {}) =>
  toolForKey({ key: k, meta: false, shift: false, ...mods })

describe('toolForKey', () => {
  it('maps Figma letters to tools, in either case', () => {
    expect(key('v')).toBe('move')
    expect(key('h')).toBe('hand')
    expect(key('f')).toBe('Container')
    expect(key('a')).toBe('Container')
    expect(key('t')).toBe('Text')
    expect(key('T')).toBe('Text')
    expect(key('b')).toBe('Button')
    expect(key('i')).toBe('Image')
    expect(key('r')).toBe('Row')
    expect(key('c')).toBe('Column')
  })

  it('ignores other keys', () => {
    expect(key('x')).toBeNull()
    expect(key('Enter')).toBeNull()
    expect(key(' ')).toBeNull()
  })

  it('never fires with Cmd/Ctrl, Shift or Alt, or while typing', () => {
    expect(key('d', { meta: true })).toBeNull()
    expect(key('c', { meta: true })).toBeNull()
    expect(key('A', { shift: true })).toBeNull()
    expect(key('t', { alt: true })).toBeNull()
    expect(key('t', { typing: true })).toBeNull()
  })
})

describe('isInsertTool', () => {
  it('is true for the component tools, not for Move or Hand', () => {
    expect(isInsertTool('Text')).toBe(true)
    expect(isInsertTool('move')).toBe(false)
    expect(isInsertTool('hand')).toBe(false)
  })
})

describe('pointerMode', () => {
  it('pans with the Hand tool or while Space is held, whatever tool is armed', () => {
    expect(pointerMode('hand', false)).toBe('pan')
    expect(pointerMode('move', true)).toBe('pan')
    expect(pointerMode('Text', true)).toBe('pan')
  })

  it('inserts with a component tool, else selects', () => {
    expect(pointerMode('Text', false)).toBe('insert')
    expect(pointerMode('move', false)).toBe('select')
  })
})

describe('toolHint', () => {
  it('tells how to use an armed insert tool', () => {
    expect(toolHint('Text')).toBe('Text · click to insert · Esc')
    expect(toolHint('Container')).toBe('Frame · click to insert · Esc')
  })

  it('is null for Move and Hand', () => {
    expect(toolHint('move')).toBeNull()
    expect(toolHint('hand')).toBeNull()
  })
})

describe('insertTargetAt', () => {
  function fixture() {
    const page = createPage('Home')
    const column = createNode('Column')
    const [a, b] = [createNode('Text'), createNode('Text')]
    column.children.push(a, b)
    const row = createNode('Row')
    const [x, y] = [createNode('Button'), createNode('Button')]
    row.children.push(x, y)
    const empty = createNode('Container')
    page.root.children.push(column, row, empty)
    return { root: page.root, column, a, b, row, x, y, empty }
  }
  // a stacked column: a at 0–40, b at 50–90; a row: x at 0–100, y at 120–220
  const stacked = [{ top: 0, left: 0, width: 300, height: 40 }, { top: 50, left: 0, width: 300, height: 40 }]
  const sideBySide = [{ top: 0, left: 0, width: 100, height: 40 }, { top: 0, left: 120, width: 100, height: 40 }]

  it('inserts into a clicked container between the children around the pointer', () => {
    const { root, column, a, b } = fixture()
    expect(insertTargetAt(root, column.id, { x: 10, y: 10 }, stacked, undefined))
      .toEqual({ target: { parentId: column.id, index: 0 }, mark: { nodeId: a.id, position: 'before' } })
    expect(insertTargetAt(root, column.id, { x: 10, y: 45 }, stacked, undefined))
      .toEqual({ target: { parentId: column.id, index: 1 }, mark: { nodeId: b.id, position: 'before' } })
    expect(insertTargetAt(root, column.id, { x: 10, y: 120 }, stacked, undefined))
      .toEqual({ target: { parentId: column.id, index: 2 }, mark: { nodeId: b.id, position: 'after' } })
  })

  it('reads a row container along x', () => {
    const { root, row, y } = fixture()
    expect(insertTargetAt(root, row.id, { x: 110, y: 20 }, sideBySide, undefined))
      .toEqual({ target: { parentId: row.id, index: 1 }, mark: { nodeId: y.id, position: 'before' } })
  })

  it('inserts into an empty container, marking the container itself', () => {
    const { root, empty } = fixture()
    expect(insertTargetAt(root, empty.id, { x: 5, y: 5 }, [], undefined))
      .toEqual({ target: { parentId: empty.id, index: 0 }, mark: { nodeId: empty.id, position: 'inside' } })
  })

  it('inserts after a clicked leaf', () => {
    const { root, column, a } = fixture()
    expect(insertTargetAt(root, a.id, { x: 5, y: 5 }, [], undefined))
      .toEqual({ target: { parentId: column.id, index: 1 }, mark: { nodeId: a.id, position: 'after' } })
  })

  it('is null for an unknown node', () => {
    const { root } = fixture()
    expect(insertTargetAt(root, 'missing', { x: 0, y: 0 }, [], undefined)).toBeNull()
  })
})

describe('toolConflicts', () => {
  it('finds no clash between the tool letters and the editor shortcuts', () => {
    expect(toolConflicts(INSERT_TOOLS, RESERVED_SHORTCUTS)).toEqual([])
  })

  it('reports a tool key that an editor shortcut already uses', () => {
    const tools = [...INSERT_TOOLS, { id: 'Grid', label: 'Grid', icon: '', keys: ['Delete'] }]
    expect(toolConflicts(tools, RESERVED_SHORTCUTS)).toEqual([{ tool: 'Grid', key: 'Delete' }])
  })
})
