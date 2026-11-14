import { expect } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import type { EditName, FileChange } from '../../src/edit/index'
import { loadModel } from '../../src/model/load'
import type { Model, ModelNode } from '../../src/model/schemas'
import { fixtureModelFiles } from '../model/fixture'

export type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const IDX = '.bildr/modules/blog/pages/index.json'
export const DETAIL = '.bildr/modules/blog/pages/post-detail.json'
export const CARD = '.bildr/modules/blog/components/post-card.json'
export const LAYOUT = '.bildr/layouts/main.json'

/** The files after a change set: written paths replaced, null ones removed. */
export const applyChanges = (files: Record<string, string>, changes: FileChange[]): Record<string, string> => {
  const next = { ...files }
  for (const change of changes) {
    if (change.content === null) Reflect.deleteProperty(next, change.path)
    else next[change.path] = change.content
  }
  return next
}

/** A project's files, edited in steps like the editor does: each step must succeed. */
export const project = (initial: Record<string, string> = fixtureModelFiles()) => {
  let files = initial
  return {
    get files() {
      return files
    },
    /** Runs one edit, expects it to succeed, applies its changes and returns its result. */
    edit(name: EditName, input: unknown): Json {
      const outcome = applyEdit(files, name, input)
      expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
      if (!outcome.ok) throw new Error('unreachable')
      files = applyChanges(files, outcome.changes)
      return { ...outcome.result, changes: outcome.changes }
    },
    /** Runs one edit, expects it to fail with `code`, and returns the failure. */
    refuse(name: EditName, input: unknown, code: string) {
      const outcome = applyEdit(files, name, input)
      expect(outcome.ok, JSON.stringify(outcome)).toBe(false)
      if (outcome.ok) throw new Error('unreachable')
      expect(outcome.code).toBe(code)
      return outcome
    },
    json(path: string): Json {
      return JSON.parse(files[path]!) as Json
    },
    model(): Model {
      const loaded = loadModel(files)
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
      return loaded.model
    }
  }
}

export const findNode = (root: ModelNode | Json, id: string): Json | undefined => {
  if (root.id === id) return root as Json
  for (const child of (root.children ?? []) as Json[]) {
    const found = findNode(child, id)
    if (found) return found
  }
  return undefined
}

export const childIds = (node: Json | undefined) => ((node?.children ?? []) as Json[]).map(child => child.id as string)
