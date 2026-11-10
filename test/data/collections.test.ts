import { describe, expect, it } from 'vitest'
import { uniqueCollectionName } from '#shared/data/collections'

describe('uniqueCollectionName', () => {
  it('keeps the name when no collection has its slug', () => {
    expect(uniqueCollectionName('Untitled', [{ slug: 'menu' }])).toBe('Untitled')
  })

  it('numbers the name from 2 until its slug is free', () => {
    expect(uniqueCollectionName('Untitled', [{ slug: 'untitled' }])).toBe('Untitled 2')
    expect(uniqueCollectionName('Untitled', [{ slug: 'untitled' }, { slug: 'untitled-2' }, { slug: 'untitled-4' }])).toBe('Untitled 3')
  })
})
