import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'
import { applyVariant, pasteStyleOverride, primaryStyle } from '../../app/composables/componentVariants'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

describe('variant Paste style (S8a)', () => {
  it('fully replaces the effective style, including a token set by a style binding default', async () => {
    const bildr = createBildr(memoryStorage())
    const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
    const projectId = created.id
    const pageId = created.pages[0]!.id
    const call = <T = Record<string, string>>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
    const get = () => call<Project>('project_get', {})
    const { nodeId: cardId } = await call('node_insert', { pageId, type: 'Card', children: [{ type: 'Text', props: { text: 'x' } }] })
    const { componentId } = await call('component_create', { pageId, nodeId: cardId, name: 'Badge' })
    const textId = (await get()).components[0]!.root.children[0]!.id
    await call('component_property_add', { componentId, name: 'Tint', kind: 'text', default: 'primary', bindings: [{ nodeId: textId, prop: 'color', target: 'style' }] })
    const { variantId } = await call('component_variant_add', { componentId, name: 'Dark' })

    const def = (await get()).components[0]!
    const shown = findNode(applyVariant(def.root, def.variants[0]!, def.properties), textId)!
    expect(shown.style).toEqual({ color: 'primary' })
    expect(primaryStyle(def, textId)).toEqual({ color: 'primary' })
    const copied = { bg: 'error' }
    const patch = pasteStyleOverride(primaryStyle(def, textId), shown.style, copied)
    await call('component_variant_set_override', { componentId, variantId, nodeId: textId, ...patch })

    const after = (await get()).components[0]!
    expect(findNode(applyVariant(after.root, after.variants[0]!, after.properties), textId)!.style).toEqual(copied)
  })
})
