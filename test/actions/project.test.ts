import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

/** A project with a component "Button", a variant "On", a hover state of the primary and interactions both ways. */
async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Listed' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const { nodeId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Container', children: [{ type: 'Text' }] })
  const { componentId } = await call<{ componentId: string }>('component_create', { pageId, nodeId, name: 'Button' })
  const { variantId: onId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'On' })
  return { call, componentId, onId }
}

describe('components_list with interactions', () => {
  it('reports each variant\'s state, interactions and transition, and the component\'s own', async () => {
    const { call, componentId, onId } = await setup()
    const { variantId: hoverId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: '', kind: 'hover' })
    const { interactionId: toOn } = await call<{ interactionId: string }>('component_interaction_add', { componentId, on: 'click', to: onId })
    const { interactionId: back } = await call<{ interactionId: string }>('component_interaction_add', { componentId, variantId: onId, on: 'mouseleave', to: '', delay: 0.5 })
    await call('component_transition_set', { componentId, transition: { type: 'spring', stiffness: 200, damping: 20 } })
    await call('component_transition_set', { componentId, variantId: onId, transition: { type: 'ease', duration: 0.2 } })

    const { userComponents } = await call<{ userComponents: Record<string, unknown>[] }>('components_list', {})
    expect(userComponents).toEqual([{
      id: componentId,
      name: 'Button',
      properties: [],
      interactions: [{ id: toOn, on: 'click', to: onId }],
      transition: { type: 'spring', stiffness: 200, damping: 20 },
      variants: [
        { id: hoverId, name: 'Primary · Hover', state: { of: '', kind: 'hover' } },
        { id: onId, name: 'On', interactions: [{ id: back, on: 'mouseleave', to: '', delay: 0.5 }], transition: { type: 'ease', duration: 0.2 } }
      ]
    }])
  })

  it('leaves the fields out of components and variants without them', async () => {
    const { call, componentId, onId } = await setup()
    const { userComponents } = await call<{ userComponents: Record<string, unknown>[] }>('components_list', {})
    expect(userComponents).toEqual([{ id: componentId, name: 'Button', properties: [], variants: [{ id: onId, name: 'On' }] }])
  })
})
