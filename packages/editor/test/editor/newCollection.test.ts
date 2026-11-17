import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { Model } from '@bildr/codegen/model'
import { blogModelFiles } from '../canvas/fixture.ts'
import { DEFAULT_STORAGE, SAMPLE_SOURCE_NAME, nextStep, storageOptionsOf, storedIn } from '../../src/editor/newCollection.ts'

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

  it('say each in one line, in the Data words', () => {
    const lines = storageOptionsOf(load()).map(option => [option.label, option.description])
    expect(lines).toEqual([
      ['Sample data', 'Rows you edit here. The app starts with them and keeps its own changes only until it restarts.'],
      ['Database', 'Rows live in your app\'s database.'],
      ['REST API', 'Rows are read from an API you connect to.']
    ])
  })
})

describe('where a choice is stored', () => {
  it('is the project\'s database for Database', () => {
    expect(storedIn(load(), 'database')?.id).toBe('ds_main')
    expect(storedIn(withoutDatabase(), 'database')).toBeUndefined()
  })

  it('is the memory source the project has for Sample data, else none yet', () => {
    expect(storedIn(load(), 'sample')).toBeUndefined()
    const model = load()
    model.datasources.push({ id: 'ds_scratch', name: 'scratch', kind: 'memory', env: {} })
    expect(storedIn(model, 'sample')?.id).toBe('ds_scratch')
  })

  it('names the source it makes for Sample data "sample"', () => {
    expect(SAMPLE_SOURCE_NAME).toBe('sample')
  })
})

describe('what a choice does next', () => {
  it('makes the collection now for Sample data and for Database', () => {
    expect(nextStep({ storage: 'sample', connection: null, name: 'Menu' })).toEqual({ kind: 'create', name: 'Menu', storage: { kind: 'sample' } })
    expect(nextStep({ storage: 'database', connection: null, name: 'Menu' })).toEqual({ kind: 'create', name: 'Menu', storage: { kind: 'database' } })
  })

  it('hands an existing connection to its collection dialog, which needs the endpoint', () => {
    expect(nextStep({ storage: 'rest', connection: 'ds_quotes', name: 'Menu' })).toEqual({ kind: 'connection', connection: 'ds_quotes', name: 'Menu' })
  })

  it('hands a new connection to the Import from URL dialog', () => {
    expect(nextStep({ storage: 'rest', connection: null, name: 'Menu' })).toEqual({ kind: 'import', name: 'Menu' })
  })

  it('trims the name', () => {
    expect(nextStep({ storage: 'sample', connection: null, name: '  Menu ' })).toMatchObject({ name: 'Menu' })
  })
})
