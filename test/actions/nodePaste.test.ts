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

  it('inserts several nodes with nodes, in order at consecutive indexes, as one undo step (RELIABILITY-004)', async () => {
    const { call, pageId, root } = await setup()
    await call('node_insert', { pageId, type: 'Heading' })
    const before = await root()
    const result = await call<{ nodeId: string, nodeIds: string[] }>('node_insert', {
      pageId,
      index: 0,
      exact: true,
      nodes: [{ type: 'Text', props: { text: 'A' }, style: {} }, { type: 'Card', props: {}, style: { p: '6' }, children: [{ type: 'Text', props: {}, style: {} }] }]
    })
    const after = await root()
    expect(after.children.map(c => c.type)).toEqual(['Text', 'Card', 'Heading'])
    expect(result.nodeIds).toEqual([after.children[0]!.id, after.children[1]!.id])
    expect(result.nodeId).toBe(result.nodeIds[0])
    // exact applies to each node and its children.
    expect(after.children[0]!.props).toEqual({ text: 'A' })
    expect(after.children[1]!.style).toEqual({ p: '6' })
    expect(after.children[1]!.children[0]!.props).toEqual({})
    expect((await call<{ undo: string | null }>('history_get', {})).undo).toBe('Insert 2')
    await call('history_undo', {})
    expect(await root()).toEqual(before)
  })

  it('appends nodes at the end in order by default, and without exact adds the defaults to each', async () => {
    const { call, pageId, root } = await setup()
    await call('node_insert', { pageId, type: 'Heading' })
    const { nodeIds } = await call<{ nodeIds: string[] }>('node_insert', { pageId, nodes: [{ type: 'Card' }, { type: 'Button' }] })
    const after = await root()
    expect(after.children.map(c => c.type)).toEqual(['Heading', 'Card', 'Button'])
    expect(nodeIds).toEqual([after.children[1]!.id, after.children[2]!.id])
    expect(after.children[1]!.style).toEqual({ gap: '3', items: 'start' })
  })

  it('validates every node of nodes like one, all or nothing, and refuses nodes with type', async () => {
    const { call, pageId, root } = await setup()
    const before = await root()
    await expect(call('node_insert', { pageId, nodes: [{ type: 'Text' }, { type: 'Nope' }] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(call('node_insert', { pageId, exact: true, nodes: [{ type: 'Text' }, { type: 'Text', children: [{ type: 'Text' }] }] })).rejects.toBeTruthy()
    await expect(call('node_insert', { pageId, nodes: [{ type: 'Text', style: { gap: 'huge' } }] })).rejects.toBeTruthy()
    expect(await root()).toEqual(before)
    await expect(call('node_insert', { pageId, type: 'Text', nodes: [{ type: 'Text' }] })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('Give type, or nodes') })
    await expect(call('node_insert', { pageId })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('Give type, or nodes') })
    await expect(call('node_insert', { pageId, nodes: [] })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('without exact, node_insert still adds the component defaults', async () => {
    const { call, pageId, root } = await setup()
    await call('node_insert', { pageId, type: 'Card', style: { p: '6' } })
    expect((await root()).children[0]!.style).toEqual({ gap: '3', items: 'start', p: '6' })
  })
})
