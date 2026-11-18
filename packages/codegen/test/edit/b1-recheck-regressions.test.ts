// B1 recheck: a page that uses one query (or action) twice calls its composable twice, it doesn't declare it twice.
import { describe, expect, it } from 'vitest'
import { generated } from './behaviour-helpers'
import { project } from './helpers'

const UUID = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01'

describe('a page that uses one query twice', () => {
  it('still takes interactions: two uses call useFeaturedPosts twice, they declare nothing twice', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_index', as: 'top', query: 'q_featured_posts', args: { limit: 3 } })
    // Bound, so the page calls the composable for it too (an unused use generates nothing).
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Text', props: { text: { $bind: 'top.length' } } })
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'B' } })
    p.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [{ kind: 'toast', title: 'Hi' }] })
    p.edit('node_interaction_update', { file: 'pg_index', nodeId: 'n_button_1', index: 0, do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] })
    expect(generated(p.files)['layers/blog/app/pages/index.vue']).toMatch(/useFeaturedPosts\(.*\)[\s\S]*useFeaturedPosts\(/)
  })

  it('still lets the drafts toggle change', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_index', as: 'others', query: 'q_all_posts' })
    p.edit('node_interaction_update', { file: 'pg_index', nodeId: 'n_toggle', index: 0, do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { not: { $bind: 'preferences.showDrafts' } } }] })
  })

  it('still refuses two uses with one alias', () => {
    const p = project()
    p.refuse('page_use_add', { page: 'pg_index', as: 'featured', query: 'q_all_posts' }, 'invalid')
  })
})
