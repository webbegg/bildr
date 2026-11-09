import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import { createProject } from '#shared/document/factory'
import type { Project, PublishedSnapshot } from '#shared/document/schema'
import { DEFAULT_THEME } from '#shared/design/theme'
import type { Theme } from '#shared/design/theme'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const, source: 'mcp' }

interface ThemeInfo {
  theme: Theme
  options: { colors: string[], palettes: string[], fonts: string[], radii: string[], spacings: { name: string, base: string }[] }
}

async function setup() {
  const storage = memoryStorage()
  const bildr = createBildr(storage)
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  const project = await bildr.call<Project>('project_create', { name: 'Demo' }, mcp)
  return { bildr, storage, events, projectId: project.id }
}

describe('theme actions', () => {
  it('theme_get returns the default theme and the options for a project saved before themes existed', async () => {
    const { bildr, storage } = await setup()
    const { theme: _theme, ...legacy } = createProject('Legacy')
    await storage.setItem(`projects:${legacy.id}`, legacy)

    const info = await bildr.call<ThemeInfo>('theme_get', { projectId: legacy.id }, mcp)
    expect(info.theme).toEqual(DEFAULT_THEME)
    expect(info.options.palettes).toEqual(expect.arrayContaining(['indigo', 'rose', 'slate']))
    expect(info.options.fonts).toEqual(expect.arrayContaining(['system', 'Inter']))
    expect(info.options.radii).toContain('1rem')
    expect(info.options.spacings).toContainEqual({ name: 'comfortable', base: '0.3rem' })
    expect((await bildr.call<Project>('project_get', { projectId: legacy.id }, mcp)).theme).toEqual(DEFAULT_THEME)
  })

  it('theme_update patches the theme as one undoable step', async () => {
    const { bildr, events, projectId } = await setup()
    const result = await bildr.call<{ version: number, theme: Theme }>('theme_update', {
      projectId, colors: { primary: '#e11d48' }, font: 'Inter', radius: '1rem', spacing: 'comfortable'
    }, mcp)

    const updated = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: '#e11d48' }, font: 'Inter', radius: '1rem', spacing: 'comfortable' }
    expect(result).toEqual({ version: 1, theme: updated })
    expect(events.at(-1)).toMatchObject({ projectId, version: 1, action: 'theme_update' })
    expect(await bildr.call('history_get', { projectId }, mcp)).toEqual({ undo: 'Update theme', redo: null })

    await bildr.call('history_undo', { projectId }, mcp)
    expect((await bildr.call<ThemeInfo>('theme_get', { projectId }, mcp)).theme).toEqual(DEFAULT_THEME)
    await bildr.call('history_redo', { projectId }, mcp)
    expect((await bildr.call<ThemeInfo>('theme_get', { projectId }, mcp)).theme).toEqual(updated)
  })

  it('rejects an invalid theme with invalid_input', async () => {
    const { bildr, projectId } = await setup()
    await expect(bildr.call('theme_update', { projectId, colors: { primary: 'grass' } }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(bildr.call('theme_update', { projectId, colors: { primary: '#12345' } }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(bildr.call('theme_update', { projectId, radius: '3px' }, mcp)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('the published snapshot carries the theme', async () => {
    const { bildr, projectId } = await setup()
    await bildr.call('theme_update', { projectId, colors: { primary: 'indigo' } }, mcp)
    await bildr.call('project_publish', { projectId }, mcp)
    const snapshot = await bildr.services.getPublished('demo') as PublishedSnapshot
    expect(snapshot.project.theme.colors.primary).toBe('indigo')
  })

  it('a legacy published snapshot gets the default theme', async () => {
    const { bildr, storage, projectId } = await setup()
    await bildr.call('project_publish', { projectId }, mcp)
    const snapshot = await storage.getItem<PublishedSnapshot>(`published:${projectId}`)
    const { theme: _theme, ...legacy } = snapshot!.project
    await storage.setItem(`published:${projectId}`, { ...snapshot, project: legacy })
    expect((await bildr.services.getPublished('demo'))!.project.theme).toEqual(DEFAULT_THEME)
  })
})
