// P3a: layout files (slots, variables) and the pages' use of them (layout, layoutValues, SlotFills at the page root).
import { describe, expect, it } from 'vitest'
import { childIds, DETAIL, findNode, IDX, LAYOUT, project } from './helpers'
import type { Json } from './helpers'

const NEW_POST = '.bildr/modules/blog/pages/new-post.json'

describe('layout files', () => {
  it('layout_create makes a root with a children slot; names are kebab-case and numbered by default', () => {
    const p = project()
    const made = p.edit('layout_create', {})
    expect(made).toMatchObject({ layoutId: 'lay_layout', slotNodeId: 'n_container_2', filePath: '.bildr/layouts/layout.json' })
    expect(p.json('.bildr/layouts/layout.json')).toEqual({
      id: 'lay_layout',
      name: 'layout',
      slots: [{ id: 'children', name: 'children', nodeId: 'n_container_2' }],
      root: { id: 'n_container_1', type: 'Container', style: { display: 'flex', direction: 'col', minH: 'screen' }, children: [{ id: 'n_container_2', type: 'Container', props: { tag: 'main' }, children: [] }] }
    })
    expect(p.edit('layout_create', {}).layoutId).toBe('lay_layout_2')
    expect(p.json('.bildr/layouts/layout-2.json').name).toBe('layout-2')
    expect(p.refuse('layout_create', { name: 'Main' }, 'invalid').message).toBe('A layout is already named "main"')
  })

  it('layout_create_from_selection moves top-level page layers into a new layout around a children slot', () => {
    const p = project()
    p.edit('page_create', { name: 'plain' })
    p.edit('node_insert', { file: 'pg_plain', nodes: [{ type: 'Container', props: { tag: 'header' } }, { type: 'Text' }, { type: 'Container', props: { tag: 'footer' } }] })
    const made = p.edit('layout_create_from_selection', { page: 'pg_plain', nodeIds: ['n_container_1', 'n_container_2'], name: 'site' })
    expect(made.layoutId).toBe('lay_site')
    const layout = p.json('.bildr/layouts/site.json')
    expect(layout.root.children.map((child: Json) => child.props?.tag)).toEqual(['header', 'main', 'footer'])
    expect(layout.root.children[1].id).toBe(made.slotNodeId)
    expect(layout.slots).toEqual([{ id: 'children', name: 'children', nodeId: made.slotNodeId }])
    const page = p.json('.bildr/modules/blog/pages/plain.json')
    expect(page.layout).toBe('lay_site')
    expect(page.root.children.map((child: Json) => child.type)).toEqual(['Text'])
    expect(p.refuse('layout_create_from_selection', { page: 'pg_index', nodeIds: ['n_head'] }, 'invalid').message).toBe('Page "index" already uses the layout "main"')
  })

  it('renames, duplicates (new variable ids) and deletes (refused while pages use it)', () => {
    const p = project()
    p.edit('layout_rename', { layout: 'lay_main', name: 'Site Shell' })
    expect(p.json(LAYOUT).name).toBe('site-shell')
    const copy = p.edit('layout_duplicate', { layout: 'lay_main' })
    expect(copy).toMatchObject({ layoutId: 'lay_site_shell_copy', filePath: '.bildr/layouts/site-shell-copy.json' })
    expect(p.json('.bildr/layouts/site-shell-copy.json').variables.map((variable: Json) => variable.id)).toEqual(['prop_title_2'])
    expect(p.refuse('layout_delete', { layout: 'lay_main' }, 'invalid').message).toBe('Layout "site-shell" is used by 5 pages: pg_index, pg_new_post, pg_post_detail, pg_shop_catalog, pg_weather. Give them another layout first')
    expect(p.edit('layout_delete', { layout: copy.layoutId }).changes).toEqual([{ path: '.bildr/layouts/site-shell-copy.json', content: null }])
  })
})

describe('layout slots and variables', () => {
  it('adds, updates and removes a named slot (the pages\' content for it goes too)', () => {
    const p = project()
    const { slotId } = p.edit('layout_slot_add', { layout: 'lay_main', name: 'Side bar', nodeId: 'n_header' })
    expect(slotId).toBe('side_bar')
    expect(p.json(LAYOUT).slots[2]).toEqual({ id: 'side_bar', name: 'sideBar', nodeId: 'n_header' })
    expect(p.refuse('layout_slot_add', { layout: 'lay_main', name: 'x', nodeId: 'n_main' }, 'invalid').message).toBe('Node "n_main" is already the slot "children"')
    expect(p.refuse('layout_slot_add', { layout: 'lay_main', name: 'x', nodeId: 'n_root' }, 'invalid').message).toBe('The layout root cannot be a slot: it holds the whole layout. Pick a container inside it')
    expect(p.refuse('layout_slot_add', { layout: 'lay_main', name: 'x', nodeId: 'n_brand' }, 'invalid').message).toBe('Node "n_brand" is inside the slot "sideBar"')
    p.edit('layout_slot_update', { layout: 'lay_main', slot: 'side_bar', name: 'top' })
    expect(p.json(LAYOUT).slots[2].name).toBe('top')
    p.edit('layout_slot_remove', { layout: 'lay_main', slot: 'footer' })
    expect(p.json(LAYOUT).slots.map((slot: Json) => slot.id)).toEqual(['children', 'side_bar'])
    expect(childIds(p.json(DETAIL).root)).not.toContain('n_footer_fill')
    expect(p.refuse('layout_slot_remove', { layout: 'lay_main', slot: 'children' }, 'invalid').message).toBe('The children slot cannot be removed: it holds the page content')
  })

  it('adds, updates and removes a variable (the pages\' values for it go too)', () => {
    const p = project()
    const { variableId } = p.edit('layout_variable_add', { layout: 'lay_main', name: 'Show nav', kind: 'boolean', default: true })
    expect(variableId).toBe('prop_show_nav')
    expect(p.json(LAYOUT).variables[1]).toEqual({ id: 'prop_show_nav', name: 'showNav', kind: 'boolean', default: true })
    expect(p.refuse('layout_variable_add', { layout: 'lay_main', name: 'x', kind: 'slot' }, 'invalid_input')).toBeDefined()
    p.edit('layout_variable_update', { layout: 'lay_main', variable: 'prop_show_nav', default: null, description: 'Whether the header shows' })
    expect(p.json(LAYOUT).variables[1]).toEqual({ id: 'prop_show_nav', name: 'showNav', kind: 'boolean', description: 'Whether the header shows' })
    p.edit('page_set_layout_values', { page: 'pg_index', values: { prop_show_nav: false } })
    expect(p.json(IDX).layoutValues).toEqual({ prop_title: 'Posts', prop_show_nav: false })
    p.edit('layout_variable_remove', { layout: 'lay_main', variable: 'prop_show_nav' })
    expect(p.json(IDX).layoutValues).toEqual({ prop_title: 'Posts' })
    // The header still reads layout.title.
    expect(p.refuse('layout_variable_remove', { layout: 'lay_main', variable: 'prop_title' }, 'invalid').problems).toContainEqual({ path: LAYOUT, message: 'root.children.0.children.0.children.1.props.text.$bind: Layout main has no variable "title"' })
    expect(p.json(NEW_POST).layoutValues).toEqual({ prop_title: 'Write' })
  })
})

describe('pages and their layout', () => {
  it('page_set_layout changes or removes the layout, dropping the values and slot content', () => {
    const p = project()
    p.edit('page_set_layout', { page: 'pg_post_detail', layout: null })
    const detail = p.json(DETAIL)
    expect(detail.layout).toBeUndefined()
    expect(childIds(detail.root)).toEqual(['n_title', 'n_body', 'n_actions'])
    p.edit('page_set_layout', { page: 'pg_index', layout: null })
    expect(p.json(IDX).layoutValues).toBeUndefined()
    expect(p.refuse('page_set_layout', { page: 'pg_index', layout: 'lay_nope' }, 'not_found').message).toBe('No layout "lay_nope"')
  })

  it('page_set_layout_values sets values by variable id; null removes one', () => {
    const p = project()
    p.edit('page_set_layout_values', { page: 'pg_post_detail', values: { prop_title: 'Post' } })
    expect(p.json(DETAIL).layoutValues).toEqual({ prop_title: 'Post' })
    p.edit('page_set_layout_values', { page: 'pg_post_detail', values: { prop_title: null } })
    expect(p.json(DETAIL).layoutValues).toBeUndefined()
    expect(p.refuse('page_set_layout_values', { page: 'pg_index', values: { prop_nope: 'x' } }, 'invalid').message).toBe('Layout main has no variable "prop_nope"')
  })

  it('page_set_slot fills a named slot with a SlotFill at the page root, or clears it', () => {
    const p = project()
    p.edit('page_set_slot', { page: 'pg_post_detail', slot: 'footer', filled: false })
    expect(childIds(p.json(DETAIL).root)).toEqual(['n_title', 'n_body', 'n_actions'])
    const { fillId } = p.edit('page_set_slot', { page: 'pg_post_detail', slot: 'footer', filled: true, nodeIds: ['n_actions'] })
    expect(findNode(p.json(DETAIL).root, fillId)).toMatchObject({ type: 'SlotFill', props: { slot: 'footer' }, children: [{ id: 'n_actions' }] })
    expect(p.refuse('page_set_slot', { page: 'pg_post_detail', slot: 'children', filled: true }, 'invalid').message).toBe('The children slot always shows the page content')
  })
})
