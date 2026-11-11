import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ComponentDefinitionSchema, ProjectSchema } from '#shared/document/schema'
import type { ComponentDefinition, Project } from '#shared/document/schema'
import { createProject } from '#shared/document/factory'
import { resolveInstance } from '#shared/runtime/instances'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

/** A project with a Button-like component (a Container with a Text), its instance on the page, and a variant "On". */
async function setup() {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const get = () => bildr.call<Project>('project_get', { projectId }, mcp)
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const { nodeId: boxId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Container', style: { bg: 'primary', p: '2' }, children: [{ type: 'Text', props: { text: 'Go' } }] })
  const { componentId, nodeId } = await call<{ componentId: string, nodeId: string }>('component_create', { pageId, nodeId: boxId, name: 'Button' })
  const { variantId: onId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'On' })
  const def = (await get()).components[0]!
  const component = async () => (await get()).components[0]!
  const undo = () => call('history_undo', {})
  return { bildr, projectId, pageId, get, call, componentId, nodeId, onId, def, component, undo }
}

describe('component_state_add', () => {
  it('adds a sparse hover state of the primary, named after its base, right where the base\'s states go', async () => {
    const { call, componentId, onId, component } = await setup()
    const { variantId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: '', kind: 'hover' })
    const def = await component()
    expect(def.variants.map(v => v.id)).toEqual([variantId, onId])
    expect(def.variants[0]).toEqual({ id: variantId, name: 'Primary · Hover', overrides: {}, state: { of: '', kind: 'hover' } })
  })

  it('adds a pressed state of a variant after the variant and its other states', async () => {
    const { call, componentId, onId, component } = await setup()
    const { variantId: hoverId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: onId, kind: 'hover' })
    const { variantId: pressedId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: onId, kind: 'pressed' })
    const def = await component()
    expect(def.variants.map(v => [v.id, v.name])).toEqual([[onId, 'On'], [hoverId, 'On · Hover'], [pressedId, 'On · Pressed']])
  })

  it('refuses a second state of a kind, a state of a state, and a missing base', async () => {
    const { call, componentId } = await setup()
    const { variantId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: '', kind: 'hover' })
    await expect(call('component_state_add', { componentId, baseVariantId: '', kind: 'hover' })).rejects.toThrow('"Primary" already has a hover state in "Button"')
    await expect(call('component_state_add', { componentId, baseVariantId: variantId, kind: 'pressed' })).rejects.toThrow('cannot be a state of the state "Primary · Hover"')
    await expect(call('component_state_add', { componentId, baseVariantId: 'nope', kind: 'pressed' })).rejects.toThrow('Variant "nope" not found in "Button"')
  })

  it('is one undo step', async () => {
    const { call, componentId, component, undo } = await setup()
    const before = await component()
    await call('component_state_add', { componentId, baseVariantId: '', kind: 'pressed' })
    await undo()
    expect(await component()).toEqual(before)
  })
})

describe('component_interaction_add, _update and _remove', () => {
  it('adds an interaction to the primary (no variantId) and to a variant', async () => {
    const { call, componentId, onId, component } = await setup()
    const { interactionId: click } = await call<{ interactionId: string }>('component_interaction_add', { componentId, on: 'click', to: onId })
    const { interactionId: leave } = await call<{ interactionId: string }>('component_interaction_add', { componentId, variantId: onId, on: 'mouseleave', to: '', delay: 0.5 })
    const def = await component()
    expect(def.interactions).toEqual([{ id: click, on: 'click', to: onId }])
    expect(def.variants[0]!.interactions).toEqual([{ id: leave, on: 'mouseleave', to: '', delay: 0.5 }])
  })

  it('refuses a missing target, a state as target, a delay over 10 s and a missing variant', async () => {
    const { call, componentId, onId } = await setup()
    await expect(call('component_interaction_add', { componentId, on: 'click', to: 'nope' })).rejects.toThrow('An interaction of "Primary" goes to the missing variant "nope" in "Button"')
    const { variantId: hoverId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: onId, kind: 'hover' })
    await expect(call('component_interaction_add', { componentId, on: 'click', to: hoverId })).rejects.toThrow('cannot go to the state "On · Hover": states show from the pointer')
    await expect(call('component_interaction_add', { componentId, on: 'click', to: onId, delay: 11 })).rejects.toThrow()
    await expect(call('component_interaction_add', { componentId, variantId: 'nope', on: 'click', to: onId })).rejects.toThrow('Variant "nope" not found in "Button"')
  })

  it('updates the event, target and delay of an interaction wherever it is, and null removes the delay', async () => {
    const { call, componentId, onId, component } = await setup()
    const { interactionId } = await call<{ interactionId: string }>('component_interaction_add', { componentId, variantId: onId, on: 'click', to: '', delay: 2 })
    await call('component_interaction_update', { componentId, interactionId, on: 'mouseenter' })
    expect((await component()).variants[0]!.interactions).toEqual([{ id: interactionId, on: 'mouseenter', to: '', delay: 2 }])
    await call('component_interaction_update', { componentId, interactionId, to: onId, delay: null })
    expect((await component()).variants[0]!.interactions).toEqual([{ id: interactionId, on: 'mouseenter', to: onId }])
    await expect(call('component_interaction_update', { componentId, interactionId: 'nope', on: 'click' })).rejects.toThrow('Interaction "nope" not found in "Button"')
  })

  it('removes an interaction, and the list key with the last one', async () => {
    const { call, componentId, onId, component, def } = await setup()
    const { interactionId } = await call<{ interactionId: string }>('component_interaction_add', { componentId, on: 'click', to: onId })
    await call('component_interaction_remove', { componentId, interactionId })
    expect(await component()).toEqual(def)
    expect('interactions' in (await component())).toBe(false)
  })

  it('undoes each step exactly', async () => {
    const { call, componentId, onId, component, undo } = await setup()
    const v0 = await component()
    const { interactionId } = await call<{ interactionId: string }>('component_interaction_add', { componentId, on: 'click', to: onId, delay: 1 })
    const v1 = await component()
    await call('component_interaction_update', { componentId, interactionId, to: '', delay: null })
    const v2 = await component()
    await call('component_interaction_remove', { componentId, interactionId })
    await undo()
    expect(await component()).toEqual(v2)
    await undo()
    expect(await component()).toEqual(v1)
    await undo()
    expect(await component()).toEqual(v0)
  })
})

describe('component_transition_set', () => {
  it('sets the component\'s transition, a variant\'s override, and null removes them, each one undo step', async () => {
    const { call, componentId, onId, component, def, undo } = await setup()
    await call('component_transition_set', { componentId, transition: { type: 'spring', stiffness: 200, damping: 20 } })
    await call('component_transition_set', { componentId, variantId: onId, transition: { type: 'ease', duration: 0.5, easing: 'ease-out' } })
    let current = await component()
    expect(current.transition).toEqual({ type: 'spring', stiffness: 200, damping: 20 })
    expect(current.variants[0]!.transition).toEqual({ type: 'ease', duration: 0.5, easing: 'ease-out' })
    await call('component_transition_set', { componentId, variantId: onId, transition: null })
    await call('component_transition_set', { componentId, transition: null })
    current = await component()
    expect(current).toEqual(def)
    await undo()
    expect((await component()).transition).toEqual({ type: 'spring', stiffness: 200, damping: 20 })
  })

  it('refuses an invalid transition', async () => {
    const { call, componentId } = await setup()
    await expect(call('component_transition_set', { componentId, transition: { type: 'bounce' } })).rejects.toThrow()
    await expect(call('component_transition_set', { componentId, transition: { type: 'ease', duration: 20 } })).rejects.toThrow()
  })
})

describe('component_variant_delete with states and interactions', () => {
  it('also deletes the variant\'s states and the interactions that go to it, and moves instances back, as one undo step', async () => {
    const { call, get, componentId, onId, nodeId, pageId, component, undo } = await setup()
    const { variantId: hoverId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: onId, kind: 'hover' })
    const { variantId: primaryHover } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: '', kind: 'hover' })
    const { interactionId: toOn } = await call<{ interactionId: string }>('component_interaction_add', { componentId, on: 'click', to: onId })
    const { interactionId: keep } = await call<{ interactionId: string }>('component_interaction_add', { componentId, on: 'appear', to: '' })
    await call('component_interaction_add', { componentId, variantId: primaryHover, on: 'click', to: onId })
    await call('instance_set_values', { pageId, nodeId, variant: hoverId })
    const before = await get()

    await call('component_variant_delete', { componentId, variantId: onId })
    const def = await component()
    expect(def.variants.map(v => v.id)).toEqual([primaryHover])
    expect(def.variants[0]).not.toHaveProperty('interactions')
    expect(def.interactions!.map(i => i.id)).toEqual([keep])
    expect(def.interactions!.map(i => i.id)).not.toContain(toOn)
    expect((await get()).pages[0]!.root.children[0]!.props).toEqual({ component: componentId })

    await undo()
    const after = await get()
    expect(after.components).toEqual(before.components)
    expect(after.pages).toEqual(before.pages)
  })

  it('deletes a state alone, leaving its base', async () => {
    const { call, componentId, onId, component } = await setup()
    const { variantId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: onId, kind: 'pressed' })
    await call('component_variant_delete', { componentId, variantId })
    expect((await component()).variants.map(v => v.id)).toEqual([onId])
  })
})

describe('states in the document', () => {
  it('render over their base variant\'s overrides', async () => {
    const { call, get, componentId, onId, def, pageId, nodeId } = await setup()
    await call('component_variant_set_override', { componentId, variantId: onId, nodeId: def.root.id, style: { p: '4' } })
    const { variantId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: onId, kind: 'hover' })
    await call('component_variant_set_override', { componentId, variantId, nodeId: def.root.id, style: { bg: 'secondary' } })
    await call('instance_set_values', { pageId, nodeId, variant: variantId })
    const project = await get()
    expect(resolveInstance(project.pages[0]!.root.children[0]!, project.components)!.style).toMatchObject({ bg: 'secondary', p: '4' })
  })

  it('keep a state override that matches the primary but not its base', async () => {
    const { call, componentId, onId, def, component } = await setup()
    await call('component_variant_set_override', { componentId, variantId: onId, nodeId: def.root.id, style: { p: '4' } })
    const { variantId } = await call<{ variantId: string }>('component_state_add', { componentId, baseVariantId: onId, kind: 'hover' })
    await call('component_variant_set_override', { componentId, variantId, nodeId: def.root.id, style: { p: '2' } })
    expect((await component()).variants[1]!.overrides).toEqual({ [def.root.id]: { style: { p: '2' } } })
    await call('component_variant_set_override', { componentId, variantId, nodeId: def.root.id, style: { p: '4' } })
    expect((await component()).variants[1]!.overrides).toEqual({})
  })

  it('are copied by component_duplicate with their interactions', async () => {
    const { call, componentId, onId, get } = await setup()
    await call('component_state_add', { componentId, baseVariantId: '', kind: 'hover' })
    await call('component_interaction_add', { componentId, on: 'click', to: onId })
    await call('component_transition_set', { componentId, transition: { type: 'instant' } })
    const { componentId: copyId } = await call<{ componentId: string }>('component_duplicate', { componentId })
    const project = await get()
    const [original, copy] = [project.components[0]!, project.components.find(c => c.id === copyId)!]
    expect({ ...copy, id: original.id, name: original.name }).toEqual(original)
  })
})

describe('the document format', () => {
  const base = (): ComponentDefinition => ({
    id: 'btn',
    name: 'Button',
    root: { id: 'root', type: 'Container', props: {}, style: {}, children: [] },
    properties: [],
    variants: [{ id: 'on', name: 'On', overrides: {} }]
  })
  const problems = (def: ComponentDefinition) => {
    const project = createProject('P')
    const result = ProjectSchema.safeParse({ ...project, components: [def] })
    return result.success ? [] : result.error.issues.map(i => i.message)
  }

  it('loads components saved before interactions unchanged', () => {
    expect(ComponentDefinitionSchema.parse(base())).toEqual(base())
    expect(problems(base())).toEqual([])
  })

  it('refuses a state of a state, two hover states of one base, a missing base and a self base', () => {
    expect(problems({ ...base(), variants: [{ id: 'on', name: 'On', overrides: {}, state: { of: 'h', kind: 'pressed' } }, { id: 'h', name: 'H', overrides: {}, state: { of: '', kind: 'hover' } }] }))
      .toContain('State "On" cannot be a state of the state "H"')
    expect(problems({ ...base(), variants: [{ id: 'a', name: 'A', overrides: {}, state: { of: '', kind: 'hover' } }, { id: 'b', name: 'B', overrides: {}, state: { of: '', kind: 'hover' } }] }))
      .toContain('"Primary" already has a hover state in "Button"')
    expect(problems({ ...base(), variants: [{ id: 'a', name: 'A', overrides: {}, state: { of: 'x', kind: 'hover' } }] }))
      .toContain('State "A" is a state of the missing variant "x" in "Button"')
    expect(problems({ ...base(), variants: [{ id: 'a', name: 'A', overrides: {}, state: { of: 'a', kind: 'hover' } }] }))
      .toContain('State "A" cannot be a state of itself')
  })

  it('refuses missing targets, duplicate interaction ids and a delay outside 0–10 s', () => {
    expect(problems({ ...base(), interactions: [{ id: 'i', on: 'click', to: 'x' }] }))
      .toContain('An interaction of "Primary" goes to the missing variant "x" in "Button"')
    expect(problems({ ...base(), interactions: [{ id: 'i', on: 'click', to: 'on' }], variants: [{ id: 'on', name: 'On', overrides: {}, interactions: [{ id: 'i', on: 'click', to: '' }] }] }))
      .toContain('Duplicate interaction id "i" in "Button"')
    expect(problems({ ...base(), interactions: [{ id: 'i', on: 'click', to: 'on', delay: 10.5 }] }).length).toBeGreaterThan(0)
    expect(problems({ ...base(), interactions: [{ id: 'i', on: 'click', to: 'on', delay: 10 }] })).toEqual([])
  })
})
