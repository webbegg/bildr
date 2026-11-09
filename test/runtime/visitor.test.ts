import { describe, expect, it } from 'vitest'
import { createCollection, createProject } from '#shared/document/factory'
import type { PublishedSnapshot } from '#shared/document/schema'
import { visitorSnapshot } from '#shared/runtime/visitor'

function snapshot(): PublishedSnapshot {
  const project = createProject('Café')
  const menu = createCollection('Menu', 'menu', [{ key: 'name', label: 'Name', type: 'text' }])
  const characters = createCollection('Characters', 'characters', [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'originName', label: 'Origin', type: 'text', path: 'origin.name' }
  ], { type: 'api', url: 'https://example.com/api/character?key=secret', itemsPath: 'results' })
  project.collections.push({ ...menu, publicRead: true }, { ...characters, publicRead: true })
  return { project, publishedAt: '2026-11-09T10:00:00Z' }
}

describe('visitorSnapshot', () => {
  it('keeps only the source type, fields and flags of API collections', () => {
    const visible = visitorSnapshot(snapshot())
    expect(visible.project.collections[1]).toEqual({
      id: expect.any(String),
      name: 'Characters',
      slug: 'characters',
      source: { type: 'api' },
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'originName', label: 'Origin', type: 'text' }
      ],
      publicRead: true,
      publicCreate: false
    })
    expect(JSON.stringify(visible)).not.toMatch(/example\.com|itemsPath|origin\.name|"url"/)
  })

  it('leaves the pages, theme and internal collections as they are, without changing the stored snapshot', () => {
    const stored = snapshot()
    const before = structuredClone(stored)
    const visible = visitorSnapshot(stored)
    expect(stored).toEqual(before)
    expect(visible.publishedAt).toBe(stored.publishedAt)
    expect(visible.project.pages).toEqual(stored.project.pages)
    expect(visible.project.theme).toEqual(stored.project.theme)
    expect(visible.project.collections[0]).toEqual(stored.project.collections[0])
  })
})
