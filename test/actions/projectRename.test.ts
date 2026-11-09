import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { ChangeEvent } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }

async function setup() {
  const bildr = createBildr(memoryStorage())
  const project = await bildr.call<Project>('project_create', { name: 'Landing' }, ui)
  const events: ChangeEvent[] = []
  bildr.onChange(e => events.push(e))
  return { bildr, project, events }
}

describe('project_rename', () => {
  it('changes the name, trimmed, and keeps the slug so published URLs stay', async () => {
    const { bildr, project } = await setup()
    await bildr.call('project_publish', { projectId: project.id }, ui)
    await bildr.call('project_rename', { projectId: project.id, name: '  Café menu  ' }, ui)

    const renamed = await bildr.call<Project>('project_get', { projectId: project.id }, ui)
    expect(renamed.name).toBe('Café menu')
    expect(renamed.slug).toBe('landing')
    expect(await bildr.call('project_published_info', { projectId: project.id }, ui)).toMatchObject({ url: '/p/landing' })
  })

  it('emits a change event so open editors refresh, without an undo step', async () => {
    const { bildr, project, events } = await setup()
    const result = await bildr.call<{ version: number }>('project_rename', { projectId: project.id, name: 'Shop' }, ui)
    expect(events.at(-1)).toEqual({ projectId: project.id, version: result.version, source: 'tab-1', action: 'project_rename' })
    expect(result.version).toBe(project.version + 1)
    expect(await bildr.call('history_get', { projectId: project.id }, ui)).toEqual({ undo: null, redo: null })
  })

  it('refuses an empty, blank or over-long name, and an unknown project', async () => {
    const { bildr, project } = await setup()
    for (const name of ['', '   ', 'x'.repeat(101)]) {
      await expect(bildr.call('project_rename', { projectId: project.id, name }, ui), JSON.stringify(name)).rejects.toMatchObject({ code: 'invalid_input' })
    }
    await expect(bildr.call('project_rename', { projectId: 'nope', name: 'Shop' }, ui)).rejects.toMatchObject({ code: 'not_found' })
    expect((await bildr.call<Project>('project_get', { projectId: project.id }, ui)).name).toBe('Landing')
  })

  it('is available to agents', async () => {
    const { bildr } = await setup()
    const info = bildr.list().find(a => a.name === 'project_rename')
    expect(info).toBeDefined()
    expect(info!.uiOnly).toBeFalsy()
  })
})
