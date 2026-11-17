import { describe, expect, it } from 'vitest'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'
import type { Json } from './helpers'

// D4 (S4): a field edit that does not change its type, refused because a sample row already holds a value the field's format
// rejects, names that row and value (and why), not a type change that did not happen.
const POSTS = '.bildr/modules/blog/fixtures/post.json'

const withPublishedAt = (...values: unknown[]) => {
  const files = fixtureModelFiles()
  const file = JSON.parse(files[POSTS]!) as { rows: Json[] }
  values.forEach((value, index) => {
    file.rows[index] = { ...file.rows[index], publishedAt: value }
  })
  return project({ ...files, [POSTS]: JSON.stringify(file) })
}

describe('entity_field_update on a field whose sample values are outside its format', () => {
  it('names the sample row, the value and the format when unique:true is asked', () => {
    const p = withPublishedAt('2026-11-01T09:00:00.000Z', '2026-01-15T09:30Z')
    expect(p.refuse('entity_field_update', { entity: 'ent_post', field: 'fld_published_at', unique: true }, 'invalid').message)
      .toBe('Sample row 2 has publishedAt "2026-01-15T09:30Z", which is not an ISO datetime (YYYY-MM-DDTHH:MM:SSZ): fix it in Sample data first.')
  })

  it('counts the other rows that need the same fix', () => {
    const p = withPublishedAt('nope', 'later', 7)
    expect(p.refuse('entity_field_update', { entity: 'ent_post', field: 'fld_published_at', unique: true }, 'invalid').message)
      .toBe('Sample row 1 has publishedAt "nope", which is not an ISO datetime (YYYY-MM-DDTHH:MM:SSZ): fix it in Sample data first (2 more sample rows have the same problem).')
  })

  it('says a sample row has no value for a field made required', () => {
    const p = withPublishedAt('2026-11-01T09:00:00.000Z', null)
    expect(p.refuse('entity_field_update', { entity: 'ent_post', field: 'fld_published_at', required: true, nullable: false }, 'invalid').message)
      .toBe('Sample row 2 has no publishedAt, which the field now requires: fill it in Sample data first.')
  })

  it('still says what a type change breaks', () => {
    const p = project()
    expect(p.refuse('entity_field_update', { entity: 'ent_post', field: 'fld_published', type: 'integer' }, 'invalid').message)
      .toBe('published can\'t be a integer: its default false, fixtures row 1, fixtures row 2, the condition of q_featured_posts hold values it can\'t take')
  })
})
