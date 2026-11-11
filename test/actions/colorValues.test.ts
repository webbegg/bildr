import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { LibraryTheme } from '#shared/design/library'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const get = () => call<Project>('project_get', {})
  const { nodeId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Text' })
  const style = async () => (await get()).pages[0]!.root.children.find(c => c.id === nodeId)!.style
  return { bildr, projectId, pageId, call, get, nodeId, style }
}

describe('hex colours through the node actions (S4b)', () => {
  it('inserts and updates nodes with hex colours', async () => {
    const { call, pageId, nodeId, style } = await setup()
    await call('node_update_style', { pageId, nodeId, style: { color: '#abc', bg: '#ff000080' } })
    expect(await style()).toMatchObject({ color: '#abc', bg: '#ff000080' })
    const { nodeId: card } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Card', style: { borderColor: '#00FF00' } })
    expect(card).toBeDefined()
  })

  it('refuses a bad hex in the input schema', async () => {
    const { call, pageId, nodeId } = await setup()
    await expect(call('node_update_style', { pageId, nodeId, style: { bg: '#ff' } })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('node_update_style', { pageId, nodeId, style: { mt: '#fff' } })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('malformed colour values (S4b)', () => {
  it('explains a malformed hex or unknown value on a colour key', async () => {
    const { call, pageId, nodeId } = await setup()
    for (const bg of ['#ab', '#abcd', 'Bogus']) {
      await expect(call('node_update_style', { pageId, nodeId, style: { bg } })).rejects.toMatchObject({ message: expect.stringMatching(/hex/) })
      await expect(call('node_insert', { pageId, type: 'Text', style: { bg } })).rejects.toMatchObject({ message: expect.stringMatching(/hex/) })
    }
  })
})

describe('theme custom colours through the actions (S4c)', () => {
  it('refuses a semantic theme colour name as a custom colour', async () => {
    const { call, get } = await setup()
    await expect(call('theme_update', { custom: { neutral: '#123456' } })).rejects.toMatchObject({ code: 'invalid_input' })
    expect('custom' in (await get()).theme).toBe(false)
  })

  it('adds a custom colour with theme_update and uses it as a colour token', async () => {
    const { call, get, pageId, nodeId, style } = await setup()
    await call('theme_update', { custom: { brand: '#ff6600' } })
    expect((await get()).theme.custom).toEqual({ brand: '#ff6600' })
    await call('node_update_style', { pageId, nodeId, style: { bg: 'brand' } })
    expect((await style()).bg).toBe('brand')
  })

  it('refuses a colour name the theme does not have', async () => {
    const { call, pageId, nodeId } = await setup()
    await expect(call('node_update_style', { pageId, nodeId, style: { bg: 'ghost' } })).rejects.toMatchObject({
      code: 'invalid',
      message: '"ghost" is not a value of style token "bg" (use a colour token, a #rgb, #rrggbb or #rrggbbaa hex, or a theme colour)'
    })
    await expect(call('node_insert', { pageId, type: 'Text', style: { color: 'ghost' } })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('removes a custom colour with null, undoably, but not while nodes use it', async () => {
    const { call, get, pageId, nodeId } = await setup()
    await call('theme_update', { custom: { brand: '#ff6600', accent: '#0af' } })
    await call('node_update_style', { pageId, nodeId, style: { color: 'brand' } })
    await expect(call('theme_update', { custom: { brand: null } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('"brand" is still used') })
    expect((await get()).theme.custom).toEqual({ brand: '#ff6600', accent: '#0af' })

    await call('theme_update', { custom: { accent: null } })
    expect((await get()).theme.custom).toEqual({ brand: '#ff6600' })
    await call('history_undo', {})
    expect((await get()).theme.custom).toEqual({ brand: '#ff6600', accent: '#0af' })

    await call('node_update_style', { pageId, nodeId, style: { color: null } })
    await call('theme_update', { custom: { brand: null, accent: null } })
    expect('custom' in (await get()).theme).toBe(false)
  })

  it('keeps custom colours through the theme library, and applying a theme keeps the project\'s own', async () => {
    const { bildr, call, get, projectId } = await setup()
    await call('theme_update', { custom: { brand: '#ff6600' } })
    const saved = await bildr.call<LibraryTheme>('theme_library_save', { name: 'Brand', projectId }, mcp)
    expect(saved.theme.custom).toEqual({ brand: '#ff6600' })

    const other = await bildr.call<Project>('project_create', { name: 'Other' }, mcp)
    await bildr.call('theme_update', { projectId: other.id, custom: { ink: '#111111' } }, mcp)
    await bildr.call('theme_apply', { projectId: other.id, themeId: saved.id }, mcp)
    const applied = (await bildr.call<Project>('project_get', { projectId: other.id }, mcp)).theme
    expect(applied.custom).toEqual({ ink: '#111111', brand: '#ff6600' })
    expect((await get()).theme.custom).toEqual({ brand: '#ff6600' })
  })
})
