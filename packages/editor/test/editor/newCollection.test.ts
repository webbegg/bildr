import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { Model } from '@bildr/codegen/model'
import { blogModelFiles } from '../canvas/fixture.ts'
import { DEFAULT_STORAGE, NEW_CONNECTION, canSubmit, connectionChoices, sampleSourceName, settleStorage, sourceFor, storageOptionsOf, submitOutcome } from '../../src/editor/newCollection.ts'

/**
 * What the New collection dialog (S7) offers and what each choice does, without the dialog: where a collection's rows can
 * live in this project, and, for the one chosen, whether the collection is made now or a connection dialog finishes it.
 * The blog fixture has a database (`ds_main`) and one connection (`ds_quotes`).
 */

const load = (): Model => {
  const loaded = loadModel(blogModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return loaded.model
}

const withoutDatabase = (): Model => {
  const model = load()
  model.datasources = model.datasources.filter(source => source.kind !== 'sqlite')
  return model
}

describe('the storage choices', () => {
  it('are Sample data, Database and REST API, with Sample data the default', () => {
    expect(storageOptionsOf(load()).map(option => option.kind)).toEqual(['sample', 'database', 'rest'])
    expect(DEFAULT_STORAGE).toBe('sample')
  })

  it('offer a Database only when the project has one', () => {
    expect(storageOptionsOf(withoutDatabase()).map(option => option.kind)).toEqual(['sample', 'rest'])
    expect(storageOptionsOf(null).map(option => option.kind)).toEqual(['sample', 'rest'])
  })

  it('keep the words of their one-line descriptions (the copy of S2, for people who do not write code)', () => {
    const lines = storageOptionsOf(load()).map(option => [option.label, option.description])
    expect(lines).toEqual([
      ['Sample data', 'Example rows you edit here. The app starts with them; anything it adds while running is lost when it restarts.'],
      ['Database', 'Rows live in your app\'s database. Sample data can still seed them.'],
      ['REST API', 'Rows are read from an API you connect to.']
    ])
  })

  it('fall back to Sample data when the choice is no longer offered (the database went away), and keep any other', () => {
    expect(settleStorage(load(), 'database')).toBe('database')
    expect(settleStorage(withoutDatabase(), 'database')).toBe('sample')
    expect(settleStorage(null, 'database')).toBe('sample')
    expect(settleStorage(withoutDatabase(), 'rest')).toBe('rest')
    expect(settleStorage(withoutDatabase(), 'sample')).toBe('sample')
  })
})

describe('where a choice is stored', () => {
  it('is the project\'s database for Database', () => {
    expect(sourceFor(load(), 'database')?.id).toBe('ds_main')
    expect(sourceFor(withoutDatabase(), 'database')).toBeUndefined()
  })

  it('is the memory source the project has for Sample data, else none yet', () => {
    expect(sourceFor(load(), 'sample')).toBeUndefined()
    const model = load()
    model.datasources.push({ id: 'ds_scratch', name: 'scratch', kind: 'memory', env: {} })
    expect(sourceFor(model, 'sample')?.id).toBe('ds_scratch')
  })
})

describe('the name of the source made for Sample data', () => {
  const named = (...names: string[]): Model => {
    const model = load()
    model.datasources.push(...names.map(name => ({ id: `ds_${name}`, name, kind: 'rest' as const, env: {} })))
    return model
  }

  it('is "sample" when no source has it', () => {
    expect(sampleSourceName(load())).toBe('sample')
  })

  it('is numbered while a source of any kind has the name: "sample-2", "sample-3"…', () => {
    expect(sampleSourceName(named('sample'))).toBe('sample-2')
    expect(sampleSourceName(named('sample', 'sample-2'))).toBe('sample-3')
  })

  it('skips a name that would share its runtime settings with another (sample-2 and sample2 are both datasources.sample2)', () => {
    expect(sampleSourceName(named('sample', 'sample2'))).toBe('sample-3')
  })
})

describe('what Create does with the choice', () => {
  it('needs a name except on REST API, where the connection dialog proposes one', () => {
    expect(canSubmit('sample', '')).toBe(false)
    expect(canSubmit('database', '   ')).toBe(false)
    expect(canSubmit('sample', 'Menu')).toBe(true)
    expect(canSubmit('rest', '')).toBe(true)
  })

  it('makes the collection now for Sample data and for Database', () => {
    expect(submitOutcome({ storage: 'sample', connection: NEW_CONNECTION, name: 'Menu' })).toEqual({ kind: 'create', name: 'Menu', storage: { kind: 'sample' } })
    expect(submitOutcome({ storage: 'database', connection: NEW_CONNECTION, name: 'Menu' })).toEqual({ kind: 'create', name: 'Menu', storage: { kind: 'database' } })
  })

  it('hands an existing connection to its collection dialog, which needs the endpoint', () => {
    expect(submitOutcome({ storage: 'rest', connection: 'ds_quotes', name: 'Menu' })).toEqual({ kind: 'connection', connection: 'ds_quotes', name: 'Menu' })
  })

  it('hands a new connection to the Import from URL dialog', () => {
    expect(submitOutcome({ storage: 'rest', connection: NEW_CONNECTION, name: 'Menu' })).toEqual({ kind: 'import', name: 'Menu' })
  })

  it('trims the name', () => {
    expect(submitOutcome({ storage: 'sample', connection: NEW_CONNECTION, name: '  Menu ' })).toMatchObject({ name: 'Menu' })
  })
})

describe('the connections to choose from', () => {
  it('are the project\'s, then "New connection…"', () => {
    expect(connectionChoices([{ id: 'ds_quotes', name: 'quotes' }])).toEqual([
      { label: 'quotes', value: 'ds_quotes' },
      { label: 'New connection…', value: NEW_CONNECTION }
    ])
    expect(connectionChoices([])).toEqual([{ label: 'New connection…', value: NEW_CONNECTION }])
  })
})
