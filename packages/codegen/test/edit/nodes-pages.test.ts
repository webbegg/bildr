// P3a (V2, V5): the node and page editing operations over `.bildr/` trees, as change sets.
import { describe, expect, it } from 'vitest'
import { applyEdit, mintId } from '../../src/edit/index'
import { applyChanges, childIds, DETAIL, findNode, IDX, LAYOUT, project } from './helpers'
import { fixtureModelFiles } from '../model/fixture'

describe('change sets', () => {
  it('return only the files an edit changed, in canonical form, and never touch the input', () => {
    const files = fixtureModelFiles()
    const before = JSON.stringify(files)
    const outcome = applyEdit(files, 'node_rename', { file: 'pg_index', nodeId: 'n_h1', name: 'Title' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.changes.map(change => change.path)).toEqual([IDX])
    expect(outcome.changes[0]!.content).toMatch(/^\{\n {2}"\$schema"/)
    expect(outcome.changes[0]!.content!.endsWith('}\n')).toBe(true)
    expect(JSON.stringify(files)).toBe(before)
  })

  it('refuse unknown edits and bad input as invalid_input', () => {
    const files = fixtureModelFiles()
    expect(applyEdit(files, 'nope' as never, {})).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(applyEdit(files, 'node_rename', { file: 'pg_index' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('return the model problems instead of a change set that breaks the model', () => {
    const p = project()
    // The layout's children slot node: deleting it leaves the slot dangling.
    const failure = p.refuse('node_delete', { file: 'lay_main', nodeId: 'n_main' }, 'invalid')
    expect(failure.problems).toEqual([{ path: LAYOUT, message: 'slots.0.nodeId: Unknown node "n_main"' }])
  })
})

describe('id minting', () => {
  it('is a prefix plus the snake-cased name, numbered on collision across the whole model', () => {
    const taken = new Set(['pg_about', 'pg_about_2', 'cmp_post_card'])
    expect(mintId('pg', 'About us', new Set())).toBe('pg_about_us')
    expect(mintId('pg', 'about', taken)).toBe('pg_about_3')
    expect(mintId('cmp', 'PostCard', taken)).toBe('cmp_post_card_2')
    expect(mintId('q', 'featuredPosts', taken)).toBe('q_featured_posts')
    expect(mintId('lay', '!!', taken)).toBe('lay_new')
  })
})

describe('node_insert', () => {
  it('inserts a palette node with its defaults in .bildr terms at the end of the root, with a minted id', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert', { file: 'pg_index', type: 'Button' })
    expect(nodeId).toBe('n_button_1')
    const page = p.json(IDX)
    expect(childIds(page.root).at(-1)).toBe('n_button_1')
    // The hosted `label` is the .bildr `text`.
    expect(findNode(page.root, 'n_button_1')).toEqual({ id: 'n_button_1', type: 'Button', props: { text: 'Button' } })
    expect(p.edit('node_insert', { file: 'pg_index', type: 'Heading' }).nodeId).toBe('n_heading_1')
    expect(findNode(p.json(IDX).root, 'n_heading_1')).toEqual({ id: 'n_heading_1', type: 'Heading', props: { text: 'Heading', level: 2 } })
    const container = p.edit('node_insert', { file: 'pg_index', type: 'Container' }).nodeId
    expect(findNode(p.json(IDX).root, container)).toEqual({ id: 'n_container_1', type: 'Container', style: { p: '4', gap: '3', items: 'start' } })
  })

  it('merges props and style over the defaults, inserts children, and places it at an index of a parent', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert', {
      file: 'pg_index',
      parentId: 'n_head',
      index: 1,
      type: 'Row',
      props: { tag: 'nav' },
      style: { 'gap': '6', 'md:gap': '8' },
      children: [{ type: 'Text', props: { text: 'Hi' } }, { type: 'Link', props: { text: 'Home', to: { page: 'pg_index' } } }]
    })
    const row = findNode(p.json(IDX).root, nodeId)!
    expect(childIds(findNode(p.json(IDX).root, 'n_head'))).toEqual(['n_h1', nodeId, 'n_toggle'])
    expect(row.props).toEqual({ wrap: true, tag: 'nav' })
    expect(row.style).toEqual({ 'gap': '6', 'items': 'center', 'md:gap': '8' })
    expect(row.children.map((child: { id: string }) => child.id)).toEqual(['n_text_1', 'n_link_1'])
    expect(row.children[1].props).toEqual({ text: 'Home', to: { page: 'pg_index' } })
  })

  it('with exact, keeps only the given props and style; with nodes, inserts several in order', () => {
    const p = project()
    const exact = p.edit('node_insert', { file: 'pg_index', type: 'Container', exact: true, style: { p: '2' } })
    expect(findNode(p.json(IDX).root, exact.nodeId)).toEqual({ id: exact.nodeId, type: 'Container', style: { p: '2' } })
    const many = p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', index: 0, nodes: [{ type: 'Text' }, { type: 'Text' }] })
    expect(many.nodeIds).toEqual(['n_text_1', 'n_text_2'])
    expect(childIds(findNode(p.json(IDX).root, 'n_head'))).toEqual(['n_text_1', 'n_text_2', 'n_h1', 'n_toggle'])
  })

  it('refuses unknown types, unknown props, bad style tokens, non-containers and missing trees', () => {
    const p = project()
    expect(p.refuse('node_insert', { file: 'pg_index', type: 'Blink' }, 'invalid').message).toBe('Unknown node type "Blink"')
    expect(p.refuse('node_insert', { file: 'pg_index', type: 'Text', props: { colour: 'x' } }, 'invalid').message).toBe('A Text has no prop "colour"')
    expect(p.refuse('node_insert', { file: 'pg_index', type: 'Text', style: { mt: 'huge' } }, 'invalid').message).toBe('"huge" is not a value of style token "mt"')
    expect(p.refuse('node_insert', { file: 'pg_index', type: 'Text', style: { 'max-md:mt': '2' } }, 'invalid').message).toMatch(/is for desktop-first projects/)
    expect(p.refuse('node_insert', { file: 'pg_index', parentId: 'n_h1', type: 'Text' }, 'invalid').message).toBe('A Heading cannot hold children')
    expect(p.refuse('node_insert', { file: 'pg_index', parentId: 'n_card', type: 'Text' }, 'invalid').message).toBe('An Instance holds only the content of its slots: fill one of its slots instead')
    expect(p.refuse('node_insert', { file: 'pg_nope', type: 'Text' }, 'not_found').message).toBe('No page, component or layout "pg_nope"')
    expect(p.refuse('node_insert', { file: 'pg_index', parentId: 'n_nope', type: 'Text' }, 'not_found').message).toBe('Node "n_nope" not found in pg_index')
  })

  it('inserts into components and layouts too', () => {
    const p = project()
    expect(p.edit('node_insert', { file: 'lay_main', parentId: 'n_footer', type: 'Text' }).nodeId).toBe('n_text_1')
    expect(childIds(findNode(p.json(LAYOUT).root, 'n_footer'))).toEqual(['n_footer_text', 'n_footer_link', 'n_text_1'])
  })
})

describe('node_update_props and node_update_style', () => {
  it('sets and removes props (null), only those the type takes', () => {
    const p = project()
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: 'All posts', level: null } })
    expect(findNode(p.json(IDX).root, 'n_h1')!.props).toEqual({ text: 'All posts' })
    expect(p.refuse('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { src: 'x' } }, 'invalid').message).toBe('A Heading has no prop "src"')
    // Prop values the render rules refuse are model problems.
    expect(p.refuse('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { level: 9 } }, 'invalid').problems).toEqual([{ path: IDX, message: 'root.children.0.children.0.props.level: heading level must be 1–6' }])
  })

  it('sets and removes tokens, at a breakpoint of the project base, on one node, several, or per node', () => {
    const p = project()
    p.edit('node_update_style', { file: 'pg_index', nodeId: 'n_h1', style: { text: '4xl', font: null } })
    expect(findNode(p.json(IDX).root, 'n_h1')!.style).toEqual({ text: '4xl' })
    p.edit('node_update_style', { file: 'pg_index', nodeId: 'n_h1', breakpoint: 'md', style: { text: '5xl' } })
    expect(findNode(p.json(IDX).root, 'n_h1')!.style).toEqual({ 'text': '4xl', 'md:text': '5xl' })
    p.edit('node_update_style', { file: 'pg_index', nodeIds: ['n_h1', 'n_about_title'], style: { color: 'primary' } })
    expect(findNode(p.json(IDX).root, 'n_about_title')!.style.color).toBe('primary')
    p.edit('node_update_style', { file: 'pg_index', updates: [{ nodeId: 'n_h1', style: { color: null } }, { nodeId: 'n_about_title', style: { color: '#ff6600' } }] })
    expect(findNode(p.json(IDX).root, 'n_h1')!.style).toEqual({ 'text': '4xl', 'md:text': '5xl' })
    expect(findNode(p.json(IDX).root, 'n_about_title')!.style.color).toBe('#ff6600')
    expect(p.refuse('node_update_style', { file: 'pg_index', nodeId: 'n_h1', breakpoint: 'max-md', style: { text: 'sm' } }, 'invalid').message).toMatch(/is for desktop-first projects/)
    expect(p.refuse('node_update_style', { file: 'pg_index', nodeId: 'n_h1', style: { bogus: null } }, 'invalid').message).toBe('Unknown style token "bogus"')
  })
})

describe('node_rename and node_set_locked', () => {
  it('names a layer (empty or null removes it) and locks or unlocks nodes', () => {
    const p = project()
    p.edit('node_rename', { file: 'pg_index', nodeId: 'n_h1', name: '  Title  ' })
    expect(findNode(p.json(IDX).root, 'n_h1')!.name).toBe('Title')
    p.edit('node_rename', { file: 'pg_index', nodeId: 'n_h1', name: null })
    expect(findNode(p.json(IDX).root, 'n_h1')!.name).toBeUndefined()
    p.edit('node_set_locked', { file: 'pg_index', nodeIds: ['n_h1', 'n_head'], locked: true })
    expect(findNode(p.json(IDX).root, 'n_head')!.locked).toBe(true)
    p.edit('node_set_locked', { file: 'pg_index', nodeId: 'n_head', locked: false })
    expect(findNode(p.json(IDX).root, 'n_head')!.locked).toBeUndefined()
    expect(findNode(p.json(IDX).root, 'n_h1')!.locked).toBe(true)
  })
})

describe('node_move, node_move_many', () => {
  it('moves a node into a container at its new index; refuses the root and moving into itself', () => {
    const p = project()
    p.edit('node_move', { file: 'pg_index', nodeId: 'n_h1', parentId: 'n_page', index: 0 })
    expect(childIds(p.json(IDX).root)).toEqual(['n_h1', 'n_head', 'n_list', 'n_quotes', 'n_about'])
    p.edit('node_move_many', { file: 'pg_index', moves: [{ nodeId: 'n_about', parentId: 'n_page', index: 0 }, { nodeId: 'n_h1', parentId: 'n_head', index: 0 }] })
    expect(childIds(p.json(IDX).root)).toEqual(['n_about', 'n_head', 'n_list', 'n_quotes'])
    expect(p.refuse('node_move', { file: 'pg_index', nodeId: 'n_page', parentId: 'n_head', index: 0 }, 'invalid').message).toBe('The page root cannot be moved')
    expect(p.refuse('node_move', { file: 'pg_index', nodeId: 'n_about', parentId: 'n_about_text', index: 0 }, 'invalid').message).toBe('A node cannot be moved into itself or its descendants')
  })
})

describe('node_delete, node_duplicate, node_wrap', () => {
  it('deletes nodes with their children, never the root', () => {
    const p = project()
    p.edit('node_delete', { file: 'pg_index', nodeIds: ['n_about', 'n_about_title', 'n_quotes'] })
    expect(childIds(p.json(IDX).root)).toEqual(['n_head', 'n_list'])
    expect(p.refuse('node_delete', { file: 'pg_index', nodeId: 'n_page' }, 'invalid').message).toBe('The page root cannot be deleted')
  })

  it('deleting a component node drops the variant overrides and property bindings on it', () => {
    const p = project()
    p.edit('node_delete', { file: 'cmp_post_card', nodeId: 'n_excerpt' })
    const card = p.json('.bildr/modules/blog/components/post-card.json')
    expect(card.variants[0].overrides.n_excerpt).toBeUndefined()
  })

  it('duplicates right after the original with fresh ids', () => {
    const p = project()
    const { nodeId, nodeIds } = p.edit('node_duplicate', { file: 'pg_index', nodeId: 'n_about' })
    expect(nodeIds).toEqual([nodeId])
    expect(childIds(p.json(IDX).root)).toEqual(['n_head', 'n_list', 'n_quotes', 'n_about', nodeId])
    const copy = findNode(p.json(IDX).root, nodeId)!
    expect(copy.id).toBe('n_grid_1')
    expect(childIds(copy)).toEqual(['n_image_1', 'n_column_1'])
    expect(copy.children[1].children.map((child: { id: string }) => child.id)).toEqual(['n_heading_1', 'n_text_1'])
    expect(copy.style).toEqual(findNode(p.json(IDX).root, 'n_about')!.style)
  })

  it('wraps siblings in a new container where the first was', () => {
    const p = project()
    const { nodeId } = p.edit('node_wrap', { file: 'pg_index', nodeIds: ['n_quotes', 'n_list'], type: 'Column', style: { gap: '8' } })
    expect(childIds(p.json(IDX).root)).toEqual(['n_head', nodeId, 'n_about'])
    const column = findNode(p.json(IDX).root, nodeId)!
    expect(column).toMatchObject({ id: 'n_column_1', type: 'Column', style: { gap: '8', items: 'start' } })
    expect(childIds(column)).toEqual(['n_quotes', 'n_list'])
    expect(p.refuse('node_wrap', { file: 'pg_index', nodeIds: ['n_h1', 'n_list'] }, 'invalid').message).toBe('Only siblings (nodes of one parent) can be wrapped together')
  })
})

describe('pages', () => {
  it('page_create mints the id, defaults the path to /<name>, uses the default module and gives it an empty Page root', () => {
    const p = project()
    const created = p.edit('page_create', { name: 'About us' })
    expect(created).toMatchObject({ pageId: 'pg_about_us', filePath: '.bildr/modules/blog/pages/about-us.json', nodeId: 'n_page_1' })
    expect(p.json('.bildr/modules/blog/pages/about-us.json')).toEqual({
      id: 'pg_about_us', name: 'about-us', path: '/about-us', root: { id: 'n_page_1', type: 'Page', style: { gap: '4' } }
    })
    p.edit('page_create', { name: 'contact', path: '/contact-us', layout: 'lay_main' })
    expect(p.json('.bildr/modules/blog/pages/contact.json')).toMatchObject({ id: 'pg_contact', path: '/contact-us', layout: 'lay_main' })
    expect(p.refuse('page_create', { name: 'other', path: '/contact-us' }, 'invalid').message).toBe('A page already has the path "/contact-us": pg_contact')
    expect(p.refuse('page_create', { name: 'Contact' }, 'invalid').message).toBe('A page is already named "contact" in module "blog"')
    expect(p.refuse('page_create', { name: 'x', module: 'shop' }, 'not_found').message).toBe('No module "shop"')
  })

  it('page_update renames and re-paths a page in its file', () => {
    const p = project()
    p.edit('page_update', { page: 'pg_post_detail', name: 'article', path: '/articles/:slug' })
    expect(p.json(DETAIL)).toMatchObject({ id: 'pg_post_detail', name: 'article', path: '/articles/:slug' })
    expect(p.refuse('page_update', { page: 'pg_post_detail', path: '/' }, 'invalid').message).toBe('A page already has the path "/": pg_index')
  })

  it('page_delete removes the file, refused while links or navigate steps target the page', () => {
    const p = project()
    const created = p.edit('page_create', { name: 'about' })
    const failure = p.refuse('page_delete', { page: 'pg_post_detail' }, 'invalid')
    expect(failure.message).toBe('Page "posts-slug" is the target of 3 links or navigate steps: cmp_post_card (n_title_link), pg_index (n_read_more), pg_new_post (n_form). Change them first')
    p.edit('node_insert', { file: 'pg_index', type: 'Button', interactions: [{ on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_about' } }] }] })
    expect(p.refuse('page_delete', { page: 'pg_about' }, 'invalid').message).toMatch(/pg_index \(n_button_1\)/)
    p.edit('node_delete', { file: 'pg_index', nodeId: 'n_button_1' })
    const deleted = p.edit('page_delete', { page: 'pg_about' })
    expect(deleted.changes).toEqual([{ path: created.filePath, content: null }])
  })
})

describe('applyChanges helper', () => {
  it('is what the module writes', () => {
    expect(applyChanges({ a: '1', b: '2' }, [{ path: 'a', content: null }, { path: 'c', content: '3' }])).toEqual({ b: '2', c: '3' })
  })
})
