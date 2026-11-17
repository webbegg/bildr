import { describe, expect, it } from 'vitest'
import { useCollectionName } from '../../src/editor/collectionName.ts'

/** The Name field of the dialogs that finish a collection from a URL or a path: what New collection handed over stays; else a name is proposed until the user types. */

describe('useCollectionName', () => {
  it('starts empty, with a name proposed until the user types one', () => {
    const field = useCollectionName(() => undefined)
    field.reset()
    expect(field.name.value).toBe('')
    field.propose('Todos')
    expect(field.name.value).toBe('Todos')
    field.propose('Posts')
    expect(field.name.value).toBe('Posts')
    field.touch()
    field.propose('Quotes')
    expect(field.name.value).toBe('Posts')
  })

  it('starts with the name handed over, and proposes nothing over it', () => {
    const field = useCollectionName(() => 'Chores')
    field.reset()
    expect(field.name.value).toBe('Chores')
    expect(field.edited.value).toBe(true)
    field.propose('Todos')
    expect(field.name.value).toBe('Chores')
  })

  it('starts over each time it is reset, with the name it is given then', () => {
    let handed: string | undefined = 'Chores'
    const field = useCollectionName(() => handed)
    field.reset()
    field.touch()
    field.name.value = 'Typed'
    handed = undefined
    field.reset()
    expect(field.name.value).toBe('')
    expect(field.edited.value).toBe(false)
  })
})
