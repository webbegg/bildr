// P3b: the module's event bus (model version, model/regenerated/navigate/context events).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_LISTENERS, createModelEvents, projectEvents } from '../src/node/events'
import type { BildrEvent } from '../src/node/events'
import { sha256 } from '../src/node/sync'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-events-'))
  mkdirSync(join(root, '.bildr/layouts'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const collect = (bus = createModelEvents()) => {
  const seen: BildrEvent[] = []
  const off = bus.subscribe(event => seen.push(event))!
  return { bus, seen, off }
}

describe('model events', () => {
  it('bump the version once per change and tell each listener', () => {
    const { bus, seen } = collect()
    expect(bus.version).toBe(0)
    bus.modelChanged([{ path: '.bildr/a.json', sha: 'x' }], 'action')
    bus.modelChanged([{ path: '.bildr/a.json', sha: null }], 'undo')
    expect(bus.version).toBe(2)
    expect(seen).toEqual([
      { type: 'model', version: 1, files: ['.bildr/a.json'], source: 'action' },
      { type: 'model', version: 2, files: ['.bildr/a.json'], source: 'undo' }
    ])
  })

  it('report disk changes, but not the files the module itself just wrote', () => {
    const { bus, seen } = collect()
    writeFileSync(join(root, '.bildr/layouts/a.json'), 'mine')
    bus.modelChanged([{ path: '.bildr/layouts/a.json', sha: sha256('mine') }], 'action')
    expect(bus.diskChanged(root, ['.bildr/layouts/a.json'])).toEqual([])

    writeFileSync(join(root, '.bildr/layouts/a.json'), 'hand edit')
    writeFileSync(join(root, '.bildr/layouts/b.json'), 'new')
    expect(bus.diskChanged(root, ['.bildr/layouts/b.json', '.bildr/layouts/a.json', '.bildr/layouts/a.json'])).toEqual(['.bildr/layouts/a.json', '.bildr/layouts/b.json'])
    expect(seen.at(-1)).toEqual({ type: 'model', version: 2, files: ['.bildr/layouts/a.json', '.bildr/layouts/b.json'], source: 'disk' })
    // Seen once: the same content again is no change.
    expect(bus.diskChanged(root, ['.bildr/layouts/b.json'])).toEqual([])
    rmSync(join(root, '.bildr/layouts/b.json'))
    expect(bus.diskChanged(root, ['.bildr/layouts/b.json'])).toEqual(['.bildr/layouts/b.json'])
    expect(bus.version).toBe(3)
  })

  it('send regenerated at the current version, and navigate/context without moving it', () => {
    const { bus, seen } = collect()
    bus.modelChanged([{ path: '.bildr/a.json', sha: 'x' }], 'action')
    bus.regenerated({ ok: false, problems: [{ path: '.bildr/a.json', message: 'bad' }] })
    bus.publish({ type: 'navigate', target: { file: 'pg_index' } })
    bus.publish({ type: 'context', context: { file: 'pg_index' } })
    expect(seen.slice(1)).toEqual([
      { type: 'regenerated', version: 1, ok: false, problems: [{ path: '.bildr/a.json', message: 'bad' }] },
      { type: 'navigate', target: { file: 'pg_index' } },
      { type: 'context', context: { file: 'pg_index' } }
    ])
    expect(bus.version).toBe(1)
  })

  it('stop telling a listener once it unsubscribed, and cap the listeners', () => {
    const { bus, seen, off } = collect()
    off()
    bus.modelChanged([], 'disk')
    expect(seen).toEqual([])
    expect(bus.listeners).toBe(0)
    const offs = Array.from({ length: MAX_LISTENERS }, () => bus.subscribe(() => {}))
    expect(offs.every(Boolean)).toBe(true)
    expect(bus.subscribe(() => {})).toBeUndefined()
    offs.forEach(unsubscribe => unsubscribe!())
    expect(bus.listeners).toBe(0)
  })

  it('a throwing listener never stops the others', () => {
    const bus = createModelEvents()
    bus.subscribe(() => {
      throw new Error('boom')
    })
    const { seen } = collect(bus)
    bus.modelChanged([], 'disk')
    expect(seen).toHaveLength(1)
  })

  it('one bus per project for the process, so restarts keep the version', () => {
    const first = projectEvents(root)
    first.modelChanged([], 'disk')
    expect(projectEvents(root)).toBe(first)
    expect(projectEvents(root).version).toBe(1)
    expect(projectEvents(join(root, 'other'))).not.toBe(first)
  })
})
