import { describe, expect, it } from 'vitest'
import { fixtureModelFiles } from '../model/fixture'
import { buildDraftsToggle, generated, INDEX, PREFERENCES, TOGGLE_ID, withoutDraftsToggle } from './behaviour-helpers'
import { project } from './helpers'
import type { Json } from './helpers'

/**
 * B1 (S1–S4): the golden blog's drafts toggle, built back from nothing but the new module actions. Starting from the blog without its
 * `st_preferences`, its "Show drafts" checkbox and its computed `posts`, the actions give the files the golden blog has.
 */

const withoutSchema = (json: Json): Json => {
  const { $schema: _, ...rest } = json
  return rest
}

/** A page file as comparable data: the node ids the actions minted (n_checkbox_1) renamed to the golden's (n_toggle). */
const rename = (json: Json, from: string, to: string): Json => JSON.parse(JSON.stringify(json).replaceAll(`"${from}"`, `"${to}"`)) as Json

describe('the drafts toggle, rebuilt through the module actions', () => {
  const golden = project()

  it('starts from a blog that has none of it, and generates', () => {
    const files = withoutDraftsToggle(fixtureModelFiles())
    expect(files[PREFERENCES]).toBeUndefined()
    expect(() => generated(files)).not.toThrow()
    const page = project(files).json(INDEX)
    expect(page.uses.state).toBeUndefined()
    expect(page.uses.computed).toBeUndefined()
  })

  it('writes the golden state file', () => {
    const built = buildDraftsToggle()
    expect(withoutSchema(built.json(PREFERENCES))).toEqual(withoutSchema(golden.json(PREFERENCES)))
  })

  it('writes the golden page: the use, the checkbox with its change interaction, the computed value and the list source', () => {
    const built = buildDraftsToggle()
    const page = withoutSchema(rename(built.json(INDEX), TOGGLE_ID, 'n_toggle'))
    expect(page).toEqual(withoutSchema(golden.json(INDEX)))
  })

  it('generates the same app as the golden blog, but for the checkbox\'s id (a handler name has none)', () => {
    const built = generated(buildDraftsToggle().files)
    const expected = generated(golden.files)
    expect(Object.keys(built).sort()).toEqual(Object.keys(expected).sort())
    for (const path of Object.keys(expected)) expect(built[path], path).toBe(expected[path])
  })

  it('makes every write one model file of the golden blog', () => {
    const built = buildDraftsToggle()
    const files = Object.keys(built.files).filter(path => built.files[path] !== golden.files[path])
    // The page and the state differ from the golden only by `$schema` and the minted node id.
    expect(files.sort()).toEqual([INDEX, PREFERENCES].sort())
  })
})
