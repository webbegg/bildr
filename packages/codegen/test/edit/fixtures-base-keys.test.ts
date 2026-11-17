import { describe, expect, it } from 'vitest'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'
import type { Json } from './helpers'

// D4 (S4): a `base` is any row a fixtures file can hold, so its keys have the same schema as the file's rows (any string), not 1–60 characters:
// a row with a long or an empty key can still be edited and deleted from the editor, which sends the row as it was shown.
const POSTS = '.bildr/modules/blog/fixtures/post.json'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'
const LONG = 'k'.repeat(70)

const withOddKeys = () => {
  const files = fixtureModelFiles()
  const file = JSON.parse(files[POSTS]!) as { rows: Json[] }
  file.rows[1] = { ...file.rows[1], [LONG]: 'long', '': 'empty' }
  return project({ ...files, [POSTS]: JSON.stringify(file) })
}

describe('a base whose row has a long or an empty key', () => {
  it('is accepted by an update, which writes the change', () => {
    const p = withOddKeys()
    const stored = (p.json(POSTS).rows as Json[])[1]!
    expect(Object.keys(stored)).toContain(LONG)
    expect(Object.keys(stored)).toContain('')
    p.edit('fixture_row_update', { entity: 'ent_post', row: SECOND, base: stored, values: { title: 'Edited' } })
    expect((p.json(POSTS).rows as Json[])[1]).toMatchObject({ 'title': 'Edited', [LONG]: 'long', '': 'empty' })
  })

  it('is accepted by a delete too', () => {
    const p = withOddKeys()
    const stored = (p.json(POSTS).rows as Json[])[1]!
    p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND], base: { [SECOND]: stored } })
    expect(p.json(POSTS).rows).toHaveLength(1)
  })
})
