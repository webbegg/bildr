// A select's options typed as one line: commas separate them, and an option in double quotes may hold a comma.
import { describe, expect, it } from 'vitest'
import { formatOptions, parseOptions } from '../../src/shared/optionList.ts'
import { draftOf, optionsOf } from '../../src/editor/stateDraft.ts'

describe('a select\'s options typed as a list', () => {
  it('are split on commas, trimmed, with no empty one', () => {
    expect(parseOptions(' draft, live,, archived ,')).toEqual(['draft', 'live', 'archived'])
    expect(parseOptions('')).toEqual([])
  })

  it('keep a comma inside double quotes, and "" is a quote', () => {
    expect(parseOptions('small, "1,000 or more", large')).toEqual(['small', '1,000 or more', 'large'])
    expect(parseOptions('"say ""hi"", then go"')).toEqual(['say "hi", then go'])
    expect(parseOptions('"  padded  "')).toEqual(['  padded  '])
  })

  it('read a quote that is not around the whole option as text, and an unclosed one to the end', () => {
    expect(parseOptions('6" pipe, 8" pipe')).toEqual(['6" pipe', '8" pipe'])
    expect(parseOptions('a, "b, c')).toEqual(['a', 'b, c'])
  })

  it('are written back so they read the same, quoting only what needs it', () => {
    const options = ['draft', '1,000 or more', 'say "hi", then go', '"quoted"', '6" pipe', ' padded ']
    expect(formatOptions(['draft', 'live'])).toBe('draft, live')
    expect(formatOptions(['1,000 or more'])).toBe('"1,000 or more"')
    expect(parseOptions(formatOptions(options))).toEqual(options)
  })

  it('round-trip through a store field\'s draft', () => {
    const draft = draftOf({ id: 'st_x', name: 'x', fields: [{ id: 'fld_size', name: 'size', type: 'select', options: ['S', '1,000+'] }] } as never)
    expect(draft.fields[0]!.options).toBe('S, "1,000+"')
    expect(optionsOf(draft.fields[0]!)).toEqual(['S', '1,000+'])
  })
})
