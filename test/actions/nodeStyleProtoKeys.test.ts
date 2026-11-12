import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const KEYS = ['__proto__', 'constructor', 'prototype'] as const
const TREES = ['page', 'layout'] as const

type Tree = { pageId: string } | { layoutId: string }
type Input = Record<string, unknown>

/** A style with an own `key` (JSON.parse keeps `__proto__` as an own key, an object literal would not). */
const styleWith = (key: string, value: unknown = 'x'): Record<string, unknown> => JSON.parse(`{${JSON.stringify(key)}:${JSON.stringify(value)}}`) as Record<string, unknown>

const CALLS: [string, string, (tree: Tree, nodeIds: string[], key: string) => Input][] = [
  ['node_update_style', 'style with nodeIds', (tree, nodeIds, key) => ({ ...tree, nodeIds, style: styleWith(key, { cols: '99' }) })],
  ['node_update_style', 'updates[].style', (tree, nodeIds, key) => ({ ...tree, updates: [{ nodeId: nodeIds[0], style: { bg: 'error' } }, { nodeId: nodeIds[1], style: styleWith(key) }] })],
  ['node_insert', 'nodes[].style', (tree, _ids, key) => ({ ...tree, nodes: [{ type: 'Text' }, { type: 'Text', style: styleWith(key, { text: '9xl' }) }] })],
  ['node_insert', 'nodes[].children[].style', (tree, _ids, key) => ({ ...tree, nodes: [{ type: 'Column', children: [{ type: 'Text', style: styleWith(key) }] }] })],
  ['node_wrap', 'style', (tree, nodeIds, key) => ({ ...tree, nodeIds, style: styleWith(key) })]
]

async function fixture(where: typeof TREES[number]) {
  const storage = memoryStorage()
  const bildr = createBildr(storage)
  const created = await bildr.call<Project>('project_create', { name: 'P' }, mcp)
  const projectId = created.id
  const tree: Tree = where === 'page'
    ? { pageId: created.pages[0]!.id }
    : { layoutId: (await bildr.call<{ layoutId: string }>('layout_create', { projectId }, mcp)).layoutId }
  const { nodeIds } = await bildr.call<{ nodeIds: string[] }>('node_insert', { projectId, ...tree, nodes: [{ type: 'Text' }, { type: 'Text' }] }, mcp)
  const snap = async () => JSON.stringify(await Promise.all((await storage.getKeys('')).sort().map(k => storage.getItem(k))))
  return { bildr, projectId, tree, nodeIds, snap }
}

describe('node style schemas refuse prototype keys', () => {
  for (const where of TREES) {
    for (const key of KEYS) {
      it.each(CALLS)(`%s refuses "${key}" in %s on a ${where}, leaving storage unchanged`, async (tool, _form, input) => {
        const { bildr, projectId, tree, nodeIds, snap } = await fixture(where)
        const before = await snap()
        await expect(bildr.call(tool, { projectId, ...input(tree, nodeIds, key) }, mcp))
          .rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining(`"${key}" is not a style token`) })
        expect(await snap()).toBe(before)
      })
    }
  }
})
