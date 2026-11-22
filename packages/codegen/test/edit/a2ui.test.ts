import { describe, expect, it } from 'vitest'
import { DETAIL, findNode, project } from './helpers'
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
    expect(inserted).toMatchObject({ type: 'Column', children: [{ type: 'Heading', props: { level: 2, text: 'Ready?' } }, { type: 'Button', props: { text: 'Publish now' } }] })
    expect(inserted.id).toMatch(/^n_column_\d+$/)
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

  it('refuses a surface a renderer would refuse', () => {
    const p = project()
    const outcome = p.refuse('node_insert_a2ui', { file: 'pg_post_detail', components: [{ id: 'main', component: 'Column', children: ['ghost'] }] }, 'invalid')
    expect(outcome.message).toContain('No component has id "root"')
  })
})
