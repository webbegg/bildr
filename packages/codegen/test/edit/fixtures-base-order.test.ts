import { describe, expect, it } from 'vitest'
import { project } from './helpers'
import type { Json } from './helpers'

// D4 (S4): `base` is compared by content, not by key order (the editor's copy of a row need not list its keys as the file does).
const POSTS = '.bildr/modules/blog/fixtures/post.json'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'
const rows = (p: ReturnType<typeof project>) => p.json(POSTS).rows as Json[]

describe('a base in another key order', () => {
  it('is the same row: the update goes through', () => {
    const p = project()
    const stored = rows(p)[1]!
    const reversed = Object.fromEntries(Object.entries(stored).reverse())
    expect(Object.keys(reversed)).not.toEqual(Object.keys(stored))
    p.edit('fixture_row_update', { entity: 'ent_post', row: SECOND, base: reversed, values: { title: 'Edited' } })
    expect(rows(p)[1]).toMatchObject({ title: 'Edited' })
  })

  it('is the same row for a delete too', () => {
    const p = project()
    const stored = rows(p)[1]!
    const reversed = Object.fromEntries(Object.entries(stored).reverse())
    p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND], base: { [SECOND]: reversed } })
    expect(rows(p)).toHaveLength(1)
  })
})
