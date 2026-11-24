import { describe, expect, it } from 'vitest'
import { DETAIL, findNode, IDX, project } from './helpers'
import type { Json } from './helpers'

// node_insert_a2ui: an A2UI v1.0 surface (Basic Catalog and the project's components) inserted as nodes of a tree.

const surface = (button: Json) => [
  { id: 'root', component: 'Column', children: ['title', 'go', 'volume'] },
  { id: 'title', component: 'Text', text: '## Ready?' },
  { id: 'go', component: 'Button', child: 'go_label', ...button },
  { id: 'go_label', component: 'Text', text: 'Publish now' },
  { id: 'volume', component: 'Slider', value: 3, max: 10 }
]
const publish = { action: { event: { name: 'act_publish_post', context: { id: { '@path': '/post/id' } } } } }

describe('node_insert_a2ui', () => {
  it('inserts the surface as one node with fresh ids, the click running the page\'s action', () => {
    const p = project()
    const result = p.edit('node_insert_a2ui', { file: 'pg_post_detail', parentId: 'n_actions', components: surface(publish) })
    const inserted = findNode(p.json(DETAIL).root, result.nodeId)!
    // A2UI's Column goes in as a Container (layout-containers T7).
    expect(inserted).toMatchObject({ type: 'Container', children: [{ type: 'Heading', props: { level: 2, text: 'Ready?' } }, { type: 'Button', props: { text: 'Publish now' } }] })
    expect(inserted.id).toMatch(/^n_container_\d+$/)
    expect(inserted.children[1].interactions).toEqual([{ on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } }] }])
    expect(result.warnings).toEqual([{ componentId: 'volume', message: 'Slider has no bildr node type: left out' }])
    p.model()
  })

  it('leaves out, with a warning, a click the page cannot run', () => {
    const p = project()
    const result = p.edit('node_insert_a2ui', { file: 'pg_post_detail', components: surface({ action: { event: { name: 'act_publish_post' } } }) })
    const button = findNode(p.json(DETAIL).root, result.nodeId)!.children[1]
    expect(button.interactions).toBeUndefined()
    expect(result.warnings).toContainEqual({ componentId: 'go', message: expect.stringContaining('click left out') })
    expect(p.json(DETAIL).uses.actions).toEqual([{ as: 'publish', action: 'act_publish_post' }])
  })

  it('takes back what a refused click made the page use', () => {
    const p = project()
    const before = p.json(IDX).uses
    const result = p.edit('node_insert_a2ui', { file: 'pg_index', components: surface({ action: { event: { name: 'act_publish_post' } } }) })
    expect(result.warnings).toContainEqual({ componentId: 'go', message: expect.stringContaining('click left out') })
    expect(p.json(IDX).uses).toEqual(before)
  })

  it('inserts a project component as an Instance of it', () => {
    const p = project()
    const result = p.edit('node_insert_a2ui', { file: 'pg_index', components: [{ id: 'root', component: 'Tip', title: 'Heads up', tone: 'muted', icon: 'i-lucide-info', size: 'xl' }] })
    expect(findNode(p.json(IDX).root, result.nodeId)).toMatchObject({ type: 'Instance', props: { component: 'cmp_tip', values: { prop_title: 'Heads up', prop_tone: 'muted', prop_icon: 'i-lucide-info' } } })
    expect(result.warnings).toEqual([{ componentId: 'root', message: 'Tip has no size: left out' }])
  })

  it('leaves out a select value that is not one of its options, instead of refusing the edit', () => {
    const p = project()
    const result = p.edit('node_insert_a2ui', { file: 'pg_index', components: [{ id: 'root', component: 'Tip', title: 'Heads up', tone: 'info' }] })
    expect(findNode(p.json(IDX).root, result.nodeId)!.props.values).toEqual({ prop_title: 'Heads up' })
    expect(result.warnings).toEqual([{ componentId: 'root', message: 'tone: "info" is not one of its options (muted, elevated): left out' }])
  })

  it('leaves out a component that would contain itself', () => {
    const p = project()
    const result = p.edit('node_insert_a2ui', { file: 'cmp_tip', components: [{ id: 'root', component: 'Column', children: ['self'] }, { id: 'self', component: 'Tip', title: 'Again' }] })
    expect(result.warnings).toEqual([{ componentId: 'self', message: 'Tip cannot contain itself: left out' }])
    expect(JSON.stringify(p.json('.bildr/modules/blog/components/tip.json').root)).not.toContain('Instance')
  })

  it('runs no action from a component: its events are left out', () => {
    const p = project()
    const result = p.edit('node_insert_a2ui', { file: 'cmp_tip', components: surface(publish) })
    expect(result.warnings).toContainEqual({ componentId: 'go', message: 'Event "act_publish_post" is not an action of the page: left out' })
  })

  it('inserts at index among the parent\'s children', () => {
    const p = project()
    const result = p.edit('node_insert_a2ui', { file: 'pg_post_detail', parentId: 'n_actions', index: 0, components: [{ id: 'root', component: 'Text', text: 'First' }] })
    expect(findNode(p.json(DETAIL).root, 'n_actions')!.children.map((child: Json) => child.id)).toEqual([result.nodeId, 'n_publish', 'n_error'])
  })

  it('refuses an Instance as the parent: it holds only its slots', () => {
    const p = project()
    const outcome = p.refuse('node_insert_a2ui', { file: 'pg_index', parentId: 'n_card', components: [{ id: 'root', component: 'Text', text: 'x' }] }, 'invalid')
    expect(outcome.message).toContain('An Instance holds only the content of its slots')
  })

  it('refuses a surface a renderer would refuse', () => {
    const p = project()
    const outcome = p.refuse('node_insert_a2ui', { file: 'pg_post_detail', components: [{ id: 'main', component: 'Column', children: ['ghost'] }] }, 'invalid')
    expect(outcome.message).toContain('No component has id "root"')
  })
})
