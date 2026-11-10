import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import type { LibraryTheme } from '#shared/design/library'
import { DEFAULT_THEME } from '#shared/design/theme'
import type { Theme } from '#shared/design/theme'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

const ROSE: Theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#e11d48', neutral: 'zinc' }, font: 'Inter', radius: '1rem', spacing: 'comfortable' }

async function setup() {
  const storage = memoryStorage()
  const bildr = createBildr(storage)
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  const create = async (name: string) => (await bildr.call<Project>('project_create', { name }, mcp)).id
  const projectId = await create('Brand')
  const themeOf = async (id: string) => (await bildr.call<Project>('project_get', { projectId: id }, mcp)).theme
  const list = async () => (await bildr.call<{ themes: LibraryTheme[] }>('theme_library_list', {}, mcp)).themes
  const save = (name: string, from = projectId) => bildr.call<LibraryTheme>('theme_library_save', { name, projectId: from }, mcp)
  return { bildr, storage, events, projectId, create, themeOf, list, save }
}

describe('theme library actions', () => {
  it('saves a project theme under a trimmed name, outside the project and its history', async () => {
    const { bildr, storage, events, projectId, list, save } = await setup()
    await bildr.call('theme_update', { projectId, ...ROSE }, mcp)
    const before = (await bildr.call<Project>('project_get', { projectId }, mcp)).version
    events.length = 0

    const saved = await save('  Brand A ')
    expect(saved).toMatchObject({ name: 'Brand A', theme: ROSE })
    expect(saved.id).toMatch(/^theme_/)
    expect(saved.createdAt).toBe(saved.updatedAt)
    expect(await list()).toEqual([saved])
    expect(await storage.getItem(`themes:${saved.id}`)).toEqual(saved)
    expect((await bildr.call<Project>('project_get', { projectId }, mcp)).version).toBe(before)
    expect(await bildr.call('history_get', { projectId }, mcp)).toEqual({ undo: 'Update theme', redo: null })
    expect(events).toEqual([])
  })

  it('refuses empty, too long and taken names (ignoring case), and an unknown project', async () => {
    const { save } = await setup()
    await save('Brand A')
    await expect(save('   ')).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(save('x'.repeat(65))).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(save('brand a')).rejects.toMatchObject({ code: 'invalid', message: 'A theme named "Brand A" already exists' })
    await expect(save('Other', 'nope')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('holds at most 100 themes', async () => {
    const { storage, save, list } = await setup()
    const at = new Date().toISOString()
    for (let i = 0; i < 99; i++) await storage.setItem(`themes:theme_${i}`, { id: `theme_${i}`, name: `Theme ${i}`, theme: DEFAULT_THEME, createdAt: at, updatedAt: at })
    await save('The 100th')
    expect(await list()).toHaveLength(100)
    await expect(save('The 101st')).rejects.toMatchObject({ code: 'invalid', message: 'The theme library is full (100 themes). Delete one first.' })
  })

  it('updates a stored theme from a project, and renames it', async () => {
    const { bildr, projectId, create, list, save } = await setup()
    const saved = await save('Brand A')
    const other = await create('Other')
    await bildr.call('theme_update', { projectId: other, ...ROSE }, mcp)

    const updated = await bildr.call<LibraryTheme>('theme_library_update', { themeId: saved.id, projectId: other }, mcp)
    expect(updated).toMatchObject({ id: saved.id, name: 'Brand A', theme: ROSE, createdAt: saved.createdAt })
    const renamed = await bildr.call<LibraryTheme>('theme_library_update', { themeId: saved.id, name: ' brand a ' }, mcp)
    expect(renamed).toMatchObject({ name: 'brand a', theme: ROSE })
    expect(await list()).toEqual([renamed])
    expect(await bildr.call('history_get', { projectId }, mcp)).toEqual({ undo: null, redo: null })
  })

  it('refuses an update with nothing to change, a taken name or an unknown theme', async () => {
    const { bildr, save } = await setup()
    const a = await save('Brand A')
    await save('Brand B')
    await expect(bildr.call('theme_library_update', { themeId: a.id }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(bildr.call('theme_library_update', { themeId: a.id, name: 'BRAND B' }, mcp)).rejects.toMatchObject({ code: 'invalid', message: 'A theme named "Brand B" already exists' })
    await expect(bildr.call('theme_library_update', { themeId: 'theme_nope', name: 'C' }, mcp)).rejects.toMatchObject({ code: 'not_found', message: 'Theme "theme_nope" not found' })
  })

  it('duplicates a theme as "<name> copy", numbered when taken, or under a given name', async () => {
    const { bildr, list, save } = await setup()
    const a = await save('Brand A')
    const duplicate = (input: Record<string, unknown>) => bildr.call<LibraryTheme>('theme_library_duplicate', { themeId: a.id, ...input }, mcp)
    const first = await duplicate({})
    expect(first).toMatchObject({ name: 'Brand A copy', theme: a.theme })
    expect(first.id).not.toBe(a.id)
    expect((await duplicate({})).name).toBe('Brand A copy 2')
    expect((await duplicate({ name: 'Brand C' })).name).toBe('Brand C')
    await expect(duplicate({ name: 'brand c' })).rejects.toMatchObject({ code: 'invalid' })
    expect((await list()).map(t => t.name)).toEqual(['Brand A', 'Brand A copy', 'Brand A copy 2', 'Brand C'])
  })

  it('deletes a theme', async () => {
    const { bildr, storage, list, save } = await setup()
    const a = await save('Brand A')
    const b = await save('Brand B')
    expect(await bildr.call('theme_library_delete', { themeId: a.id }, mcp)).toEqual({ themeId: a.id })
    expect(await list()).toEqual([b])
    expect(await storage.getItem(`themes:${a.id}`)).toBeNull()
    await expect(bildr.call('theme_library_delete', { themeId: a.id }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('applies a theme to a project as one undo step that history_undo reverts', async () => {
    const { bildr, events, projectId, create, themeOf, save } = await setup()
    await bildr.call('theme_update', { projectId, ...ROSE }, mcp)
    const a = await save('Brand A')
    const target = await create('Target')
    await bildr.call('theme_update', { projectId: target, colors: { primary: 'indigo' } }, mcp)
    const old = await themeOf(target)

    const result = await bildr.call<{ version: number, theme: Theme }>('theme_apply', { projectId: target, themeId: a.id }, mcp)
    expect(result).toEqual({ version: 2, theme: ROSE })
    expect(await themeOf(target)).toEqual(ROSE)
    expect(events.at(-1)).toMatchObject({ projectId: target, version: 2, action: 'theme_apply' })
    expect(await bildr.call('history_get', { projectId: target }, mcp)).toEqual({ undo: 'Apply theme Brand A', redo: null })

    await bildr.call('history_undo', { projectId: target }, mcp)
    expect(await themeOf(target)).toEqual(old)
    expect(await bildr.call('history_get', { projectId: target }, mcp)).toEqual({ undo: 'Update theme', redo: 'Apply theme Brand A' })
  })

  it('applies a copy: other projects and the stored theme stay as they were', async () => {
    const { bildr, projectId, create, themeOf, list, save } = await setup()
    await bildr.call('theme_update', { projectId, ...ROSE }, mcp)
    const a = await save('Brand A')
    const target = await create('Target')
    const bystander = await create('Bystander')
    await bildr.call('theme_apply', { projectId: target, themeId: a.id }, mcp)
    await bildr.call('theme_update', { projectId: target, colors: { primary: 'amber' } }, mcp)

    expect(await themeOf(bystander)).toEqual(DEFAULT_THEME)
    expect(await themeOf(projectId)).toEqual(ROSE)
    expect((await list())[0]!.theme).toEqual(ROSE)
    expect(await bildr.call('history_get', { projectId: bystander }, mcp)).toEqual({ undo: null, redo: null })
  })

  it('refuses to apply an unknown theme', async () => {
    const { bildr, projectId } = await setup()
    await expect(bildr.call('theme_apply', { projectId, themeId: 'theme_nope' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps the library when the project it was saved from is deleted', async () => {
    const { bildr, projectId, list, save } = await setup()
    const a = await save('Brand A')
    const slug = (await bildr.call<Project>('project_get', { projectId }, mcp)).slug
    await bildr.call('project_delete', { projectId, confirm: slug }, mcp)
    expect(await list()).toEqual([a])
  })

  it('serializes concurrent library writes, so a name is never taken twice', async () => {
    const { bildr, save, list } = await setup()
    const a = await save('A')
    const b = await save('B')
    const rename = (themeId: string, name: string) => bildr.call('theme_library_update', { themeId, name }, mcp)
    const results = await Promise.allSettled([rename(a.id, 'Same'), rename(b.id, 'same')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((await list()).filter(t => t.name.toLowerCase() === 'same')).toHaveLength(1)
  })
})
