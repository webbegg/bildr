import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import type { Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const ui = { caller: 'ui' as const, source: 'tab-1' }

describe('project_publish', () => {
  it('snapshots the draft; later edits do not change the published version', async () => {
    const bildr = createBildr(memoryStorage())
    const project = await bildr.call<Project>('project_create', { name: 'Landing' }, ui)
    const pageId = project.pages[0]!.id
    await bildr.call('node_insert', { projectId: project.id, pageId, type: 'Heading', props: { text: 'v1' } }, ui)

    const published = await bildr.call<{ url: string, version: number }>('project_publish', { projectId: project.id }, ui)
    expect(published).toMatchObject({ url: '/p/landing', version: 1 })

    await bildr.call('node_insert', { projectId: project.id, pageId, type: 'Text' }, ui)
    const snapshot = await bildr.services.getPublished('landing')
    expect(snapshot!.project.pages[0]!.root.children.map(n => n.props.text)).toEqual(['v1'])
    expect(snapshot!.project.version).toBe(1)
  })

  it('returns undefined for a project that was never published', async () => {
    const bildr = createBildr(memoryStorage())
    await bildr.call('project_create', { name: 'Draft only' }, ui)
    expect(await bildr.services.getPublished('draft-only')).toBeUndefined()
  })
})
