import { describe, expect, it } from 'vitest'
import { plainWords } from '../../src/shared/simpleData.ts'

/** What the module says, in the words of the simple Data section: a store is a store; no ids, no generated names, no code words. */

const JARGON = /\b(state|composable|collection|entity|artifact|datasource|data source)\b/i

describe('plainWords', () => {
  it.each([
    ['A state with several rows is not generated yet: a state holds one row of values', 'A store with several rows is not generated yet: a store holds one row of values'],
    ['Module "blog" already has the state Preferences (st_preferences)', 'Module "blog" already has the store Preferences'],
    ['State cart (st_cart) is still used: the page Index. Change them first', 'Store cart is still used: the page Index. Change them first'],
    ['The name "posts" is already taken by the collection Post: pick another', 'The name "posts" is already taken by the data “Post”: pick another'],
    ['The name "x" clashes with the query Blog X (q_x), which the app also names useBlogX: pick another', 'The name "x" clashes with the query Blog X: pick another'],
    ['`show` would generate useBlogShow, which Nuxt already provides: pick another name', '“show” is already used by the app: pick another name'],
    ['"1x" can\'t be a field name: start with a letter, like "showDrafts"', '"1x" can\'t be a field name: start with a letter'],
    ['The model has a bad entity and a bad data source', 'The model has a bad data and a bad API']
  ])('says %j its way', (said, plain) => {
    expect(plainWords(said)).toBe(plain)
    expect(plainWords(said)).not.toMatch(JARGON)
  })

  it('leaves a message with none of those words as it is', () => {
    expect(plainWords('The store can\'t be saved right now')).toBe('The store can\'t be saved right now')
  })
})
