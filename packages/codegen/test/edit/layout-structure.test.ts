// layout-containers L4: structure commands.
import { describe, expect, it } from 'vitest'
import { childIds, findNode, IDX, project } from './helpers'

describe('node_unwrap', () => {
  it('lifts a wrapper\'s children into its parent where it was, and removes it', () => {
    const p = project()
    const { nodeIds } = p.edit('node_unwrap', { file: 'pg_index', nodeId: 'n_head' })
    expect(nodeIds).toEqual(['n_h1', 'n_toggle'])
    const page = p.json(IDX).root
    expect(childIds(page)).toEqual(['n_h1', 'n_toggle', 'n_list', 'n_quotes', 'n_about'])
    expect(findNode(page, 'n_head')).toBeUndefined()
  })

  it('undoes a wrap: wrapping then unwrapping gives the tree back', () => {
    const p = project()
    const before = p.json(IDX)
    const { nodeId } = p.edit('node_wrap', { file: 'pg_index', nodeIds: ['n_list', 'n_quotes'], preset: 'Row' })
    p.edit('node_unwrap', { file: 'pg_index', nodeId })
    expect(p.json(IDX)).toEqual(before)
  })

  it('refuses the root and anything that is not a layout container', () => {
    const p = project()
    expect(p.refuse('node_unwrap', { file: 'pg_index', nodeId: 'n_page' }, 'invalid').message).toBe('The page root cannot be unwrapped')
    expect(p.refuse('node_unwrap', { file: 'pg_index', nodeId: 'n_h1' }, 'invalid').message).toBe('Only a layout container (a Container, Row, Column, Grid or Card) can be unwrapped, not a Heading')
    expect(p.refuse('node_unwrap', { file: 'pg_index', nodeId: 'n_list' }, 'invalid').message).toBe('Only a layout container (a Container, Row, Column, Grid or Card) can be unwrapped, not a List')
  })
})
