import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { DocNode, Project } from '#shared/document/schema'
import { copyNode, pasteInput } from '#shared/editor/clipboard'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const root = async () => (await call<Project>('project_get', {})).pages[0]!.root
  return { call, pageId, root }
}

const shape = (node: DocNode): unknown => ({ type: node.type, props: node.props, style: node.style, children: node.children.map(shape) })

describe('node_insert exact (paste fidelity, RELIABILITY-001)', () => {
  it('pastes a copied node and its children with exactly their props and style, as one undo step', async () => {
    const { call, pageId, root } = await setup()
    const { nodeId: card } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Card', children: [{ type: 'Text' }] })
    const text = (await root()).children[0]!.children[0]!.id
    // Remove a default token from the card and a default prop and token from the child.
    await call('node_update_style', { pageId, nodeId: card, style: { gap: null, p: '6' } })
    await call('node_update_props', { pageId, nodeId: text, props: { text: null } })
    await call('node_update_style', { pageId, nodeId: text, style: { color: '#ff6600' } })
    const source = (await root()).children[0]!
    expect(source.style).not.toHaveProperty('gap')
    expect(source.children[0]!.props).not.toHaveProperty('text')

    const clip = copyNode(await root(), card)!
    const { nodeId: copyId } = await call<{ nodeId: string }>('node_insert', { pageId, ...pasteInput(clip) })
    expect((await call<{ undo: string | null }>('history_get', {})).undo).toBe('Insert Card')

    const after = await root()
    const copy = after.children.find(c => c.id === copyId)!
    expect(shape(copy)).toEqual(shape(after.children[0]!))
    expect(copy.style).toEqual({ items: 'start', p: '6' })
    expect(copy.children[0]!.props).toEqual({})
    expect(copy.children[0]!.style).toEqual({ color: '#ff6600' })
    expect(copy.children[0]!.id).not.toBe(text)
  })

  it('keeps node_insert validation: unknown types, props and tokens are refused with exact', async () => {
    const { call, pageId } = await setup()
    await expect(call('node_insert', { pageId, type: 'Nope', exact: true })).rejects.toMatchObject({ code: 'invalid' })
    await expect(call('node_insert', { pageId, type: 'Card', exact: true, children: [{ type: 'Nope' }] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(call('node_insert', { pageId, type: 'Text', exact: true, style: { gap: 'huge' } })).rejects.toBeTruthy()
    await expect(call('node_insert', { pageId, type: 'Text', exact: true, props: { bogus: 'x' } })).rejects.toBeTruthy()
    await expect(call('node_insert', { pageId, type: 'Text', exact: true, children: [{ type: 'Text' }] })).rejects.toBeTruthy()
  })

  it('without exact, node_insert still adds the component defaults', async () => {
    const { call, pageId, root } = await setup()
    await call('node_insert', { pageId, type: 'Card', style: { p: '6' } })
    expect((await root()).children[0]!.style).toEqual({ gap: '3', items: 'start', p: '6' })
  })
})
