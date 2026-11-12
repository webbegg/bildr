import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }
const KEYS = ['__proto__', 'constructor', 'prototype'] as const

type Body = (ids: { projectId: string, componentId: string, variantId: string, nodeId: string }, key: string) => string

const FORMS: [string, Body][] = [
  ['style', (ids, key) => `{"projectId":"${ids.projectId}","componentId":"${ids.componentId}","variantId":"${ids.variantId}","nodeId":"${ids.nodeId}","style":{"${key}":{"cols":"99"}}}`],
  ['style (string value)', (ids, key) => `{"projectId":"${ids.projectId}","componentId":"${ids.componentId}","variantId":"${ids.variantId}","nodeId":"${ids.nodeId}","style":{"${key}":"x"}}`],
  ['overrides[].style', (ids, key) => `{"projectId":"${ids.projectId}","componentId":"${ids.componentId}","variantId":"${ids.variantId}","overrides":[{"nodeId":"${ids.nodeId}","style":{"${key}":{"cols":"99"}}}]}`]
]

async function fixture() {
  const storage = memoryStorage()
  const bildr = createBildr(storage)
  const created = await bildr.call<Project>('project_create', { name: 'P' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const { nodeId: cardId } = await bildr.call<{ nodeId: string }>('node_insert', { projectId, pageId, type: 'Card', children: [{ type: 'Text', props: { text: 'x' } }] }, mcp)
  const { componentId } = await bildr.call<{ componentId: string }>('component_create', { projectId, pageId, nodeId: cardId, name: 'Badge' }, mcp)
  const { variantId } = await bildr.call<{ variantId: string }>('component_variant_add', { projectId, componentId, name: 'Dark' }, mcp)
  const project = await bildr.call<Project>('project_get', { projectId }, mcp)
  const nodeId = project.components[0]!.root.children[0]!.id
  const snap = async () => JSON.stringify(await Promise.all((await storage.getKeys('')).sort().map(k => storage.getItem(k))))
  return { bildr, ids: { projectId, componentId, variantId, nodeId }, snap }
}

describe('component_variant_set_override refuses prototype style keys', () => {
  for (const key of KEYS) {
    it.each(FORMS)(`refuses "${key}" in %s, leaving storage and history byte-identical`, async (_form, body) => {
      const { bildr, ids, snap } = await fixture()
      const before = await snap()
      await expect(bildr.call('component_variant_set_override', JSON.parse(body(ids, key)), mcp))
        .rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining(`"${key}" is not a style token`) })
      expect(await snap()).toBe(before)
    })
  }

  it('still accepts a plain style override', async () => {
    const { bildr, ids } = await fixture()
    await bildr.call('component_variant_set_override', { ...ids, style: { bg: 'error' } }, mcp)
    const project = await bildr.call<Project>('project_get', { projectId: ids.projectId }, mcp)
    expect(project.components[0]!.variants[0]!.overrides[ids.nodeId]).toMatchObject({ style: { bg: 'error' } })
  })
})
