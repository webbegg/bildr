import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

async function setup(base?: 'mobile' | 'desktop') {
  const bildr = createBildr(memoryStorage())
  const created = await bildr.call<Project>('project_create', { name: 'Demo', ...(base ? { base } : {}) }, mcp)
  const pageId = created.pages[0]!.id
  const call = <T = { version: number }>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId: created.id, pageId, ...input }, mcp)
  const { nodeId } = await call<{ nodeId: string }>('node_insert', { type: 'Grid' })
  const style = async () => (await call<Project>('project_get', {})).pages[0]!.root.children[0]!.style
  return { bildr, call, nodeId, style }
}

interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  patternProperties?: Record<string, JsonSchema>
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  anyOf?: JsonSchema[]
  enum?: unknown[]
  const?: unknown
  description?: string
}

/** The JSON Schema of `field` of `tool`'s input, as MCP lists it. */
function styleSchemaOf(tool: string, pick: (input: JsonSchema) => JsonSchema): JsonSchema {
  const bildr = createBildr(memoryStorage())
  return pick(bildr.list().find(a => a.name === tool)!.inputSchema as JsonSchema)
}

const values = (schema: JsonSchema): unknown[] => schema.enum ?? (schema.anyOf ?? []).flatMap(values).concat(schema.const ?? [])

describe('the compact style schema (S38.2)', () => {
  const schemas = {
    node_insert: styleSchemaOf('node_insert', input => input.properties!.style!),
    node_update_style: styleSchemaOf('node_update_style', input => input.properties!.style!),
    updates: styleSchemaOf('node_update_style', input => input.properties!.updates!.items!.properties!.style!),
    node_wrap: styleSchemaOf('node_wrap', input => input.properties!.style!)
  }

  it.each(Object.entries(schemas))('%s lists the unprefixed keys with their values, and the prefixed keys by pattern', (_, schema) => {
    expect(values(schema.properties!.cols!)).toEqual(['1', '2', '3', '4', '5', '6', '12'])
    expect(values(schema.properties!.bg!)).toContain('primary')
    expect(Object.keys(schema.properties!).some(key => key.includes(':'))).toBe(false)
    expect(schema.additionalProperties).toBe(false)
    const patterns = Object.keys(schema.patternProperties ?? {})
    expect(patterns).toHaveLength(1)
    const pattern = new RegExp(patterns[0]!)
    for (const key of ['max-lg:cols', 'max-md:p', 'max-sm:display', 'sm:cols', 'md:w', 'lg:text']) expect(key).toMatch(pattern)
    for (const key of ['cols', 'xl:cols', 'md:bg', 'max-md:shadow', 'md:padding', 'md:cols:x', 'xmd:cols']) expect(key).not.toMatch(pattern)
    expect(schema.patternProperties![patterns[0]!]!.description).toContain('max-lg:/max-md:/max-sm: in desktop-first projects, sm:/md:/lg: in mobile-first projects (see project_get breakpointBase)')
  })

  it('takes valid prefixed keys of the project base and removes them with null', async () => {
    const { call, nodeId, style } = await setup()
    await call('node_update_style', { nodeId, style: { 'cols': '3', 'max-md:cols': '1', 'max-lg:gap': '4' } })
    expect(await style()).toMatchObject({ 'cols': '3', 'max-md:cols': '1', 'max-lg:gap': '4' })
    await call('node_update_style', { nodeId, style: { 'max-md:cols': null } })
    expect(await style()).not.toHaveProperty('max-md:cols')
  })

  it('checks prefixed values against the values of their token', async () => {
    const { call, nodeId } = await setup()
    await expect(call('node_update_style', { nodeId, style: { 'max-lg:cols': '9' } })).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('"9" is not a value of style token "max-lg:cols"')
    })
    await expect(call('node_update_style', { updates: [{ nodeId, style: { 'max-md:gap': '7' } }] })).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('"7" is not a value of style token "max-md:gap"')
    })
    await expect(call('node_insert', { type: 'Column', children: [{ type: 'Text', style: { 'max-sm:text': 'huge' } }] })).rejects.toMatchObject({
      code: 'invalid_input',
      message: expect.stringContaining('"huge" is not a value of style token "max-sm:text"')
    })
    await expect(call('node_wrap', { nodeId, style: { 'max-sm:p': 4 } })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('refuses unknown keys, breakpoints and values clearly', async () => {
    const { call, nodeId } = await setup()
    const refused = async (style: Record<string, unknown>, message: string) => {
      await expect(call('node_update_style', { nodeId, style })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining(message) })
    }
    await refused({ position: 'fixed' }, 'Unknown style token "position"')
    await refused({ 'md:padding': '4' }, 'Unknown style token "md:padding"')
    await refused({ 'xl:cols': '3' }, 'Unknown breakpoint "xl" in style token "xl:cols" (use max-lg:, max-md: or max-sm: in desktop-first projects, sm:, md: or lg: in mobile-first projects; see project_get breakpointBase)')
    await refused({ 'max-md:bg': 'primary' }, 'Style token "bg" has no breakpoint variants')
    await refused({ cols: '9' }, 'cols')
    await refused({ 'xl:cols': null }, 'Unknown breakpoint "xl"')
  })

  it('still refuses the prefixes of the other base with the right ones named', async () => {
    const desktop = await setup()
    await expect(desktop.call('node_update_style', { nodeId: desktop.nodeId, style: { 'md:cols': '2' } })).rejects.toMatchObject({
      code: 'invalid',
      message: 'Breakpoint "md" in style token "md:cols" is for mobile-first projects; this project is desktop-first (use max-lg:, max-md: or max-sm:)'
    })
    const mobile = await setup('mobile')
    await expect(mobile.call('node_insert', { type: 'Text', style: { 'max-lg:align': 'center' } })).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('this project is mobile-first (use sm:, md: or lg:)')
    })
    await mobile.call('node_update_style', { nodeId: mobile.nodeId, style: { 'md:cols': '2' } })
    expect(await mobile.style()).toMatchObject({ 'md:cols': '2' })
  })
})
