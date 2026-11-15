import { describe, expect, it, vi } from 'vitest'
import { click, Failure, settle, typeInto } from '../helpers.ts'
import { menuItem, must, open, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'

/**
 * The Settings view (U5): the project's name (`project_update`), the environment variables the data
 * sources read (`env_status`: set or not, never a value), and the MCP command. What the hosted view had of
 * a hosted project (the slug, publishing, WebMCP and the Danger zone) is not in it.
 */

setupHarness()

const ok = () => ({ changed: [] })
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]

const VARIABLES = [
  { name: 'NUXT_QUOTES_BASE_URL', datasource: 'ds_quotes', setting: 'baseUrl', secret: false, hasDefault: true, set: false, from: null },
  { name: 'NUXT_QUOTES_TOKEN', datasource: 'ds_quotes', setting: 'token', secret: true, hasDefault: false, set: false, from: null },
  { name: 'NUXT_MAIN_URL', datasource: 'ds_main', setting: 'url', secret: false, hasDefault: false, set: true, from: '.env' },
  { name: 'NUXT_MAIN_KEY', datasource: 'ds_main', setting: 'key', secret: true, hasDefault: false, set: true, from: 'env' }
]

const openSettings = async (extra: Handlers = {}) => {
  const mounted = await open({ env_status: () => ({ variables: VARIABLES }), project_update: ok, ...extra })
  await menuItem(q('[data-view-menu]'), 'Settings')
  return mounted
}

describe('Settings', () => {
  it('shows the project\'s name, the variables and the MCP command, and none of what only a hosted project has', async () => {
    await openSettings()
    expect(must('[data-settings]').textContent).toContain('Project settings')
    expect((must('[data-settings-name]') as HTMLInputElement).value).toBe('Blog')
    expect(must('[data-env-section]')).not.toBeNull()
    expect(must('[data-mcp-command]').textContent).toContain('claude mcp add --transport http bildr')
    expect(must('[data-mcp-command]').textContent).toContain('/__bildr/mcp')
    expect(must('[data-mcp-command]').textContent).toContain('x-bildr-token')
    expect(must('[data-settings]').textContent).not.toMatch(/slug|Publish|WebMCP|Danger zone/i)
    expect(q('[data-danger-zone]')).toBeNull()
  })

  it('renames the project with project_update, and puts the saved name back when it is refused', async () => {
    const { actions } = await openSettings({ project_update: input => (input.name === 'Journal' ? { changed: [] } : new Failure(422, 'invalid', 'refused')) })
    await typeInto(must('[data-settings-name]'), 'Journal')
    expect(actions.named('project_update').map(call => call.input)).toEqual([{ name: 'Journal' }])
    await typeInto(must('[data-settings-name]'), 'Nope')
    await settle()
    expect(actions.named('project_update').map(call => call.input).at(-1)).toEqual({ name: 'Nope' })
  })

  it('lists the environment variables the data sources read: where each is set, never a value', async () => {
    await openSettings()
    expect(qa('[data-env-row]').map(row => row.dataset.envRow)).toEqual(VARIABLES.map(variable => variable.name))
    const status = (name: string) => q(`[data-env-row="${name}"] [data-env-status]`)?.textContent?.trim()
    expect(status('NUXT_QUOTES_BASE_URL')).toBe('Not set · uses the default')
    expect(status('NUXT_QUOTES_TOKEN')).toBe('Not set')
    expect(status('NUXT_MAIN_URL')).toBe('Set in .env')
    expect(status('NUXT_MAIN_KEY')).toBe('Set in the environment')
    expect(q('[data-env-row="NUXT_QUOTES_TOKEN"] [data-env-secret-tag]')).not.toBeNull()
    expect(q('[data-env-row="NUXT_MAIN_URL"] [data-env-secret-tag]')).toBeNull()
    expect(q('[data-env-row="NUXT_QUOTES_BASE_URL"] [data-env-source]')?.textContent).toContain('ds_quotes · baseUrl')
    // No value fields, Secret switches or delete buttons: the module never reads or writes a value.
    expect(qa('[data-env-section] input, [data-env-section] [role="switch"], [data-env-delete], [data-env-add]')).toEqual([])
  })

  it('says so when no data source reads a variable, and reads them again with Reload', async () => {
    let variables: unknown[] = []
    const { actions } = await openSettings({ env_status: () => ({ variables }) })
    expect(q('[data-env-empty]')).not.toBeNull()
    variables = VARIABLES
    await click(must('[data-env-reload]'))
    expect(actions.named('env_status').length).toBeGreaterThanOrEqual(2)
    expect(qa('[data-env-row]')).toHaveLength(VARIABLES.length)
    expect(q('[data-env-empty]')).toBeNull()
  })

  it('copies the MCP command, and says where its token is', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await openSettings()
    await click(must('[aria-label="Copy command"]'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('--header "x-bildr-token: <token from the dev server log>"'))
    expect(document.body.textContent).toContain('Copied')
  })

  it('writes nothing by opening it: the name stays, and no variable is written (the module has no env_set)', async () => {
    const { actions } = await openSettings()
    expect(world.model.project.name).toBe('Blog')
    expect(actions.named('project_update')).toEqual([])
    expect(actions.calls.map(call => call.name).filter(name => name.startsWith('env_') && name !== 'env_status')).toEqual([])
  })
})
