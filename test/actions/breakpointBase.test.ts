import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { copyNode, pasteInput } from '#shared/editor/clipboard'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup(base?: 'mobile' | 'desktop') {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo', ...(base ? { base } : {}) }, mcp)
  const projectId = created.id
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId, ...input }, mcp)
  const root = async () => (await call<Project>('project_get', {})).pages[0]!.root
  return { bildr, created, call, pageId, root }
}

describe('desktop-first projects over the actions (S37)', () => {
  it('creates desktop-first projects, or mobile-first ones with base', async () => {
    expect((await setup()).created.breakpointBase).toBe('desktop')
    expect((await setup('mobile')).created.breakpointBase).toBe('mobile')
    const { call } = await setup('mobile')
    expect((await call<Project>('project_get', {})).breakpointBase).toBe('mobile')
    await expect((await setup()).bildr.call('project_create', { name: 'X', base: 'tablet' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('writes max-* overrides and refuses mobile prefixes, naming the right ones', async () => {
    const { call, pageId, root } = await setup()
    const { nodeId } = await call<{ nodeId: string }>('node_insert', { pageId, type: 'Text', style: { 'align': 'left', 'max-lg:align': 'center' } })
    expect((await root()).children[0]!.style).toMatchObject({ 'align': 'left', 'max-lg:align': 'center' })
    await expect(call('node_update_style', { pageId, nodeId, style: { 'md:align': 'right' } })).rejects.toMatchObject({
      code: 'invalid',
      message: 'Breakpoint "md" in style token "md:align" is for mobile-first projects; this project is desktop-first (use max-lg:, max-md: or max-sm:)'
    })
    const mobile = await setup('mobile')
    await expect(mobile.call('node_insert', { pageId: mobile.pageId, type: 'Text', style: { 'max-lg:align': 'center' } })).rejects.toMatchObject({
      message: expect.stringContaining('this project is mobile-first (use sm:, md: or lg:)')
    })
  })

  it('reports the base and its prefixes in components_list', async () => {
    const { bildr, created } = await setup()
    const listed = await bildr.call<{ breakpointBase: string, breakpointBases: Record<string, string[]>, tokens: { key: string, breakpoints: string[] }[] }>('components_list', { projectId: created.id }, mcp)
    expect(listed.breakpointBase).toBe('desktop')
    expect(listed.breakpointBases).toEqual({ mobile: ['sm', 'md', 'lg'], desktop: ['max-lg', 'max-md', 'max-sm'] })
    expect(listed.tokens.find(t => t.key === 'cols')!.breakpoints).toEqual(['max-lg', 'max-md', 'max-sm'])
  })

  describe('refusals of mobile prefixes change nothing', () => {
    const refused = { code: 'invalid', message: expect.stringContaining('max-lg:, max-md: or max-sm:') }

    async function withComponent() {
      const ctx = await setup()
      const { nodeId: cardId } = await ctx.call<{ nodeId: string }>('node_insert', { pageId: ctx.pageId, type: 'Card', children: [{ type: 'Text', props: { text: 'New' } }] })
      const { componentId } = await ctx.call<{ componentId: string }>('component_create', { pageId: ctx.pageId, nodeId: cardId, name: 'Badge' })
      const def = (await ctx.call<Project>('project_get', {})).components[0]!
      return { ...ctx, componentId, def }
    }

    it('component_property_update rebinding to md:p', async () => {
      const { call, componentId, def } = await withComponent()
      const { propertyId } = await call<{ propertyId: string }>('component_property_add', { componentId, name: 'Pad', kind: 'text', bindings: [{ nodeId: def.root.id, prop: 'p', target: 'style' }] })
      const before = await call<Project>('project_get', {})
      const attempt = call('component_property_update', { componentId, propertyId, bindings: [{ nodeId: def.root.id, prop: 'md:p', target: 'style' }] })
      await expect(attempt).rejects.toMatchObject(refused)
      expect(await call<Project>('project_get', {})).toEqual(before)
    })

    it('layout_variable_update rebinding to md:p', async () => {
      const { call } = await setup()
      const { layoutId } = await call<{ layoutId: string }>('layout_create', { name: 'Main' })
      const { nodeId: barId } = await call<{ nodeId: string }>('node_insert', { layoutId, type: 'Container', index: 0 })
      const { variableId } = await call<{ variableId: string }>('layout_variable_add', { layoutId, name: 'Pad', kind: 'text', bindings: [{ nodeId: barId, prop: 'p', target: 'style' }] })
      const before = await call<Project>('project_get', {})
      await expect(call('layout_variable_update', { layoutId, variableId, bindings: [{ nodeId: barId, prop: 'md:p', target: 'style' }] })).rejects.toMatchObject(refused)
      expect(await call<Project>('project_get', {})).toEqual(before)
    })

    it('component_variant_set_override with one bad override of a batch', async () => {
      const { call, componentId, def } = await withComponent()
      const { variantId } = await call<{ variantId: string }>('component_variant_add', { componentId, name: 'Roomy' })
      const before = await call<Project>('project_get', {})
      await expect(call('component_variant_set_override', { componentId, variantId, overrides: [
        { nodeId: def.root.children[0]!.id, style: { 'max-md:p': '4' } },
        { nodeId: def.root.id, style: { 'lg:p': '2' } }
      ] })).rejects.toMatchObject(refused)
      expect(await call<Project>('project_get', {})).toEqual(before)
    })

    it('node_insert exact with one bad node', async () => {
      const { call, pageId } = await setup()
      const before = await call<Project>('project_get', {})
      await expect(call('node_insert', { pageId, nodes: [{ type: 'Text', props: {}, style: { 'max-sm:mt': '2' }, children: [] }, { type: 'Text', props: {}, style: { 'sm:mt': '4' }, children: [] }], exact: true }))
        .rejects.toMatchObject(refused)
      expect(await call<Project>('project_get', {})).toEqual(before)
    })

    it('says a bad binding with a default once', async () => {
      const { call, componentId, def } = await withComponent()
      const problem = 'Breakpoint "md" in style token "md:p" is for mobile-first projects; this project is desktop-first (use max-lg:, max-md: or max-sm:)'
      await expect(call('component_property_add', { componentId, name: 'Pad', kind: 'text', default: '4', bindings: [{ nodeId: def.root.id, prop: 'md:p', target: 'style' }] }))
        .rejects.toMatchObject({ code: 'invalid', message: `Property "Pad": ${problem}` })
      const { layoutId } = await call<{ layoutId: string }>('layout_create', { name: 'Main' })
      const { nodeId: barId } = await call<{ nodeId: string }>('node_insert', { layoutId, type: 'Container', index: 0 })
      await expect(call('layout_variable_add', { layoutId, name: 'Bar', kind: 'text', default: '4', bindings: [{ nodeId: barId, prop: 'md:p', target: 'style' }] }))
        .rejects.toMatchObject({ code: 'invalid', message: `Variable "Bar": ${problem}` })
    })
  })

  it('pastes a copy from a mobile project into a desktop one with its styles converted', async () => {
    const mobile = await setup('mobile')
    const { nodeId } = await mobile.call<{ nodeId: string }>('node_insert', { pageId: mobile.pageId, type: 'Card', style: { 'p': '4', 'md:p': '8' }, children: [{ type: 'Text', style: { 'text': 'sm', 'lg:text': 'xl' } }] })
    const clip = copyNode(await mobile.root(), nodeId, 1, 'mobile')!
    expect(clip.base).toBe('mobile')

    const desktop = await setup()
    await desktop.call('node_insert', { pageId: desktop.pageId, ...pasteInput(clip, 'desktop') })
    const pasted = (await desktop.root()).children[0]!
    expect(pasted.style).toMatchObject({ 'p': '8', 'max-md:p': '4' })
    expect(pasted.style).not.toHaveProperty('md:p')
    expect(pasted.children[0]!.style).toEqual({ 'text': 'xl', 'max-lg:text': 'sm' })
  })
})
