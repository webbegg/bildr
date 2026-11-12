import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

describe('style keys refuse __proto__ (S38.2)', () => {
  it.each([
    ['node_update_style', (p: string, g: string, n: string) => `{"projectId":"${p}","pageId":"${g}","nodeId":"${n}","style":{"__proto__":{"cols":"99"}}}`],
    ['node_update_style', (p: string, g: string, n: string) => `{"projectId":"${p}","pageId":"${g}","updates":[{"nodeId":"${n}","style":{"__proto__":"x"}}]}`],
    ['node_insert', (p: string, g: string) => `{"projectId":"${p}","pageId":"${g}","type":"Text","style":{"__proto__":{"text":"9xl"}}}`],
    ['node_insert', (p: string, g: string) => `{"projectId":"${p}","pageId":"${g}","type":"Column","children":[{"type":"Text","style":{"__proto__":"x"}}]}`],
    ['node_wrap', (p: string, g: string, n: string) => `{"projectId":"${p}","pageId":"${g}","nodeId":"${n}","style":{"__proto__":"x"}}`]
  ])('%s refuses it and leaves storage and history untouched', async (tool, body) => {
    const storage = memoryStorage()
    const bildr = createBildr(storage)
    const p = await bildr.call<Project>('project_create', { name: 'P' }, mcp)
    const pageId = p.pages[0]!.id
    const { nodeId } = await bildr.call<{ nodeId: string }>('node_insert', { projectId: p.id, pageId, type: 'Grid' }, mcp)
    const snap = async () => JSON.stringify(await Promise.all((await storage.getKeys('')).sort().map(k => storage.getItem(k))))
    const before = await snap()
    await expect(bildr.call(tool, JSON.parse(body(p.id, pageId, nodeId)), mcp)).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('__proto__') })
    expect(await snap()).toBe(before)
  })
})
