import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fixtureRoot } from '../model/fixture'

/**
 * Why an action with no `client.optimistic` doesn't use `createOptimisticAction` (fix/action-server-call): the golden blog's pinned
 * `@tanstack/db` (1.0.0-rc.1.5) commits a transaction without calling its `mutationFn` when nothing was mutated, so an empty
 * `onMutate` resolves the action and never reaches the server. This pins that behaviour: if a newer TanStack DB calls `mutationFn`
 * anyway, this goes red and the direct composable can be reconsidered.
 */
const pnpmStore = join(fixtureRoot, 'node_modules/.pnpm')
const dbDirectory = existsSync(pnpmStore) ? readdirSync(pnpmStore).find(name => /^@tanstack\+db@/.test(name)) : undefined
const NEEDS_FIXTURE = dbDirectory || process.env.CI ? '' : ' (skipped: run `pnpm --dir fixtures/codegen/blog install` first)'

describe.skipIf(!!NEEDS_FIXTURE)(`TanStack DB's createOptimisticAction${NEEDS_FIXTURE}`, () => {
  const load = async () => import(pathToFileURL(join(pnpmStore, dbDirectory!, 'node_modules/@tanstack/db/dist/esm/index.js')).href) as Promise<typeof import('@tanstack/db')>

  it('never calls mutationFn when onMutate mutates nothing', async () => {
    const { createOptimisticAction } = await load()
    const requests: string[] = []
    const action = createOptimisticAction<string>({
      onMutate: () => {
        // Nothing to show before the server answers.
      },
      mutationFn: async (id) => {
        requests.push(id)
      }
    })
    await action('post-1').when('settled')
    expect(requests).toEqual([])
  })

  it('never calls mutationFn when an optimistic update changes nothing (publishing an already published post)', async () => {
    const { createCollection, createOptimisticAction } = await load()
    const posts = createCollection<{ id: string, published: boolean }>({
      id: 'posts',
      getKey: post => post.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: 'insert', value: { id: 'post-1', published: true } })
          commit()
          markReady()
        }
      }
    })
    await posts.preload()
    const requests: string[] = []
    const action = createOptimisticAction<string>({
      onMutate: (id) => {
        posts.update(id, (draft) => {
          if (draft.published) return
          draft.published = true
        })
      },
      mutationFn: async (id) => {
        requests.push(id)
      }
    })
    await action('post-1').when('settled')
    expect(requests).toEqual([])
  })

  it('rolls the change back and settles with the very error mutationFn threw (how a module action answers the route\'s error, T3c2)', async () => {
    const { createCollection, createOptimisticAction } = await load()
    const notes = createCollection<{ id: string }>({
      id: 'notes-failing',
      getKey: note => note.id,
      sync: { sync: ({ markReady }) => markReady() },
      onInsert: async () => {}
    })
    await notes.preload()
    class Answered extends Error {}
    const answered = new Answered('slug_taken')
    const action = createOptimisticAction<string>({
      onMutate: id => notes.insert({ id }),
      mutationFn: async () => {
        throw answered
      }
    })
    const transaction = action('note-1')
    expect(notes.has('note-1')).toBe(true)
    await expect(transaction.when('settled')).rejects.toBe(answered)
    expect(notes.has('note-1')).toBe(false)
  })

  it('calls mutationFn when onMutate mutates something (the control)', async () => {
    const { createCollection, createOptimisticAction } = await load()
    const notes = createCollection<{ id: string }>({
      id: 'notes',
      getKey: note => note.id,
      sync: { sync: ({ markReady }) => markReady() },
      onInsert: async () => {}
    })
    const requests: string[] = []
    const action = createOptimisticAction<string>({
      onMutate: id => notes.insert({ id }),
      mutationFn: async (id) => {
        requests.push(id)
      }
    })
    await action('post-1').when('settled')
    expect(requests).toEqual(['post-1'])
  })
})
