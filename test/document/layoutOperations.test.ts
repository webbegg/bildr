import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ProjectSchema } from '#shared/document/schema'
import type { DocNode, Project } from '#shared/document/schema'
import { createProject } from '#shared/document/factory'
import { memoryStorage } from '../helpers'

const mcp = { caller: 'mcp' as const }
const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = []): DocNode => ({ id, type, props, style: {}, children })
const strip = ({ version: _v, updatedAt: _u, ...rest }: Project) => rest

/** Home uses layout "main" and fills its footer slot with a root SlotFill. */
async function setup() {
  const project = createProject('L')
  project.layouts = [{
    id: 'main', name: 'Main',
    root: n('l-root', 'Page', {}, [n('l-main', 'Container'), n('l-foot', 'Container', {}, [n('l-copy', 'Text')])]),
    slots: [{ id: 'children', name: 'Content', nodeId: 'l-main' }, { id: 'footer', name: 'Footer', nodeId: 'l-foot' }],
    variables: []
  }]
  const home = project.pages[0]!
  home.layoutId = 'main'
  home.root.children = [n('x1', 'Heading'), n('fill1', 'SlotFill', { slot: 'footer' }, [n('f1', 'Text')])]
  project.pages.push({ id: 'p2', name: 'Two', slug: 'two', root: n('r2', 'Page', {}, [n('x', 'Card')]) })
  const parsed = ProjectSchema.parse(project)
  const storage = memoryStorage()
  await storage.setItem(`projects:${parsed.id}`, parsed)
  const bildr = createBildr(storage)
  const call = <T = unknown>(name: string, input: Record<string, unknown>) => bildr.call<T>(name, { projectId: parsed.id, ...input }, mcp)
  const load = async () => (await storage.getItem<Project>(`projects:${parsed.id}`))!
  return { parsed, call, load, pageId: home.id }
}

describe('operations on a page that fills layout slots', () => {
  it('undoes deleting a root SlotFill', async () => {
    const { parsed, call, load, pageId } = await setup()
    await call('node_delete', { pageId, nodeIds: ['fill1'] })
    await call('history_undo', {})
    expect(strip(await load())).toEqual(strip(parsed))
  })

  it('still allows component edits elsewhere in the project', async () => {
    const { call, load } = await setup()
    const { componentId } = await call<{ componentId: string }>('component_create', { pageId: 'p2', nodeId: 'x', name: 'C' })
    await call('component_rename', { componentId, name: 'D' })
    expect((await load()).components.map(c => c.name)).toEqual(['D'])
  })

  it('undoes deleting the page', async () => {
    const { parsed, call, load, pageId } = await setup()
    await call('page_delete', { pageId })
    await call('history_undo', {})
    expect(strip(await load())).toEqual(strip(parsed))
  })
})
