// P3a: component, property, variant (states, interactions, transitions) and instance edits on `.bildr/` files.
import { describe, expect, it } from 'vitest'
import { CARD, childIds, findNode, IDX, project } from './helpers'
import type { Json } from './helpers'

const TIP = '.bildr/modules/blog/components/tip.json'
const NEW_POST = '.bildr/modules/blog/pages/new-post.json'

describe('component_create', () => {
  it('turns a node into a component file with fresh ids and puts an instance in its place', () => {
    const p = project()
    const made = p.edit('component_create', { file: 'pg_index', nodeId: 'n_about' })
    expect(made).toMatchObject({ componentId: 'cmp_grid', nodeId: 'n_instance_1', filePath: '.bildr/modules/blog/components/grid.json' })
    const component = p.json('.bildr/modules/blog/components/grid.json')
    expect(component).toMatchObject({ id: 'cmp_grid', name: 'Grid', properties: [], variants: [] })
    expect(component.root.id).toBe('n_grid_1')
    expect(childIds(component.root)).toEqual(['n_image_1', 'n_column_1'])
    expect(childIds(p.json(IDX).root)).toEqual(['n_head', 'n_list', 'n_quotes', 'n_instance_1'])
    expect(findNode(p.json(IDX).root, 'n_instance_1')).toEqual({ id: 'n_instance_1', type: 'Instance', props: { component: 'cmp_grid' } })
  })

  it('wraps several siblings in a Container, takes a PascalCase name, and refuses a taken one', () => {
    const p = project()
    const made = p.edit('component_create', { file: 'pg_index', nodeIds: ['n_about_text', 'n_about_image'], name: 'about box' })
    expect(made.componentId).toBe('cmp_about_box')
    const component = p.json('.bildr/modules/blog/components/about-box.json')
    expect(component.name).toBe('AboutBox')
    expect(component.root.type).toBe('Container')
    expect(component.root.children.map((child: Json) => child.type)).toEqual(['Column', 'Image'])
    expect(childIds(findNode(p.json(IDX).root, 'n_about'))).toEqual([made.nodeId])
    expect(p.refuse('component_create', { file: 'pg_index', nodeId: 'n_about', name: 'tip' }, 'invalid').message).toBe('A component is already named "Tip" in module "blog"')
    expect(p.refuse('component_create', { file: 'pg_index', nodeId: 'n_page' }, 'forbidden').message).toBe('The page root cannot become a component')
  })
})

describe('component_create from nodes that bind outer names', () => {
  it('refuses a node that binds its List\'s item, naming the nodes', () => {
    const p = project()
    expect(p.refuse('component_create', { file: 'pg_index', nodeId: 'n_card', name: 'Wrapper' }, 'invalid').message)
      .toBe('Can\'t make a component of n_card: it binds "post" (n_card, n_read_more), defined outside it. A component sees only its own properties: pick nodes that don\'t use that name, or unbind it first')
  })

  it('takes a List with the names it binds inside it, and refuses one bound to the page\'s data', () => {
    const p = project()
    expect(p.refuse('component_create', { file: 'pg_index', nodeIds: ['n_quotes', 'n_list'] }, 'invalid').message)
      .toBe('Can\'t make a component of n_quotes, n_list: they bind "quotes" (n_quotes), "posts" (n_list), defined outside them. A component sees only its own properties: pick nodes that don\'t use those names, or unbind them first')
  })
})

describe('component_rename, component_duplicate, component_delete', () => {
  it('renames in place, unique ignoring case', () => {
    const p = project()
    p.edit('component_rename', { component: 'cmp_tip', name: 'Hint' })
    expect(p.json(TIP).name).toBe('Hint')
    expect(p.refuse('component_rename', { component: 'cmp_tip', name: 'postCard' }, 'invalid').message).toBe('A component is already named "PostCard" in module "blog"')
  })

  it('duplicates with new property and variant ids, its states and interactions following them', () => {
    const p = project()
    const { componentId } = p.edit('component_duplicate', { component: 'cmp_post_card' })
    expect(componentId).toBe('cmp_post_card_copy')
    const copy = p.json('.bildr/modules/blog/components/post-card-copy.json')
    expect(copy.name).toBe('PostCardCopy')
    expect(copy.properties.map((property: Json) => property.id)).toEqual(['prop_post_2', 'prop_cover_2', 'prop_draft_label_2', 'prop_actions_2'])
    expect(copy.variants.map((variant: Json) => variant.id)).toEqual(['var_compact_2', 'var_hovered_2'])
    const tip = p.edit('component_duplicate', { component: 'cmp_tip', name: 'Hint' })
    const hint = p.json('.bildr/modules/blog/components/hint.json')
    expect(tip.componentId).toBe('cmp_hint')
    expect(hint.interactions[0].do[0].to).toBe('var_collapsed_2')
  })

  it('refuses to delete a used component unless forced, which deletes its instances', () => {
    const p = project()
    expect(p.refuse('component_delete', { component: 'cmp_tip' }, 'forbidden').message).toBe('Component "Tip" is used by 1 instance: pg_new_post (n_tip). Delete it first, or pass force: true to delete it too')
    const deleted = p.edit('component_delete', { component: 'cmp_tip', force: true })
    expect(deleted.deletedInstances).toEqual(['pg_new_post (n_tip)'])
    expect(deleted.changes.map((change: Json) => [change.path, change.content === null])).toEqual([[TIP, true], [NEW_POST, false]])
  })
})

describe('properties', () => {
  it('adds a camelCase property with a minted id, updates it and removes it with the instance values', () => {
    const p = project()
    const { propertyId } = p.edit('component_property_add', { component: 'cmp_tip', name: 'Footer note', kind: 'text', default: 'Hi', bindings: [{ nodeId: 'n_tip_body', prop: 'text' }], index: 0 })
    expect(propertyId).toBe('prop_footer_note')
    expect(p.json(TIP).properties[0]).toEqual({ id: 'prop_footer_note', name: 'footerNote', kind: 'text', default: 'Hi', bindings: [{ nodeId: 'n_tip_body', prop: 'text' }] })
    p.edit('component_property_update', { component: 'cmp_tip', property: 'prop_footer_note', label: 'Note', default: null, optional: true, index: 4 })
    expect(p.json(TIP).properties[4]).toEqual({ id: 'prop_footer_note', name: 'footerNote', kind: 'text', label: 'Note', optional: true, bindings: [{ nodeId: 'n_tip_body', prop: 'text' }] })
    expect(p.refuse('component_property_add', { component: 'cmp_tip', name: 'title', kind: 'text' }, 'invalid').message).toBe('Tip already has a property "title"')
    p.edit('component_property_remove', { component: 'cmp_tip', property: 'prop_title' })
    expect(p.json(TIP).properties.map((property: Json) => property.id)).not.toContain('prop_title')
    expect(p.json(NEW_POST).root.children[0].props.values).toEqual({ prop_body: 'Keep the title short: the slug becomes the post\'s URL.' })
  })

  it('refuses to remove a property the component\'s nodes still bind, naming them', () => {
    const p = project()
    expect(p.refuse('component_property_remove', { component: 'cmp_post_card', property: 'prop_post' }, 'invalid').message)
      .toBe('PostCard still binds property "post" in n_cover, n_title_link, n_title, n_excerpt, n_draft: unbind them first')
  })

  it('renaming a property rewrites the paths that read it', () => {
    const p = project()
    p.edit('component_property_update', { component: 'cmp_post_card', property: 'prop_post', name: 'article' })
    const card = p.json(CARD)
    expect(card.properties[0]).toMatchObject({ id: 'prop_post', name: 'article' })
    expect(findNode(card.root, 'n_title')!.props.text).toEqual({ $bind: 'article.title' })
    expect(findNode(card.root, 'n_cover')!.props).toMatchObject({ src: { $bind: 'cover' }, alt: { $bind: 'article.title' } })
    expect(findNode(card.root, 'n_title_link')!.props.to.params.slug).toEqual({ $bind: 'article.slug' })
    expect(findNode(card.root, 'n_draft')!.props.visible).toEqual({ not: { $bind: 'article.published' } })
  })

  it('removing a slot property removes the instances\' content for it', () => {
    const p = project()
    p.edit('component_property_remove', { component: 'cmp_post_card', property: 'prop_actions' })
    expect(findNode(p.json(IDX).root, 'n_card')!.children).toEqual([])
  })
})

describe('variants', () => {
  it('adds, renames and deletes a variant (its states, interactions to it and instances using it go back to the primary)', () => {
    const p = project()
    const { variantId } = p.edit('component_variant_add', { component: 'cmp_tip', name: 'Loud' })
    expect(variantId).toBe('var_loud')
    expect(p.json(TIP).variants[1]).toEqual({ id: 'var_loud', name: 'loud', overrides: {} })
    p.edit('component_variant_rename', { component: 'cmp_tip', variant: 'var_loud', name: 'shout' })
    expect(p.json(TIP).variants[1].name).toBe('shout')
    const state = p.edit('component_state_add', { component: 'cmp_tip', baseVariant: 'var_collapsed', kind: 'hover' })
    expect(state.variantId).toBe('var_collapsed_hover')
    expect(p.json(TIP).variants.map((variant: Json) => [variant.name, variant.state])).toEqual([['collapsed', undefined], ['collapsedHover', { of: 'var_collapsed', kind: 'hover' }], ['shout', undefined]])
    p.edit('component_variant_delete', { component: 'cmp_tip', variant: 'var_collapsed' })
    const tip = p.json(TIP)
    expect(tip.variants.map((variant: Json) => variant.id)).toEqual(['var_loud'])
    expect(tip.interactions).toBeUndefined()
    expect(p.json(NEW_POST).root.children[0].props.variant).toBeUndefined()
  })

  it('sets sparse overrides: a null or the primary\'s value resets one, unset removes a primary token', () => {
    const p = project()
    p.edit('component_variant_set_override', { component: 'cmp_tip', variant: 'var_collapsed', nodeId: 'n_tip_title', props: { text: 'Psst' }, style: { font: 'bold' } })
    expect(p.json(TIP).variants[0].overrides.n_tip_title).toEqual({ props: { text: 'Psst' }, style: { font: 'bold' } })
    p.edit('component_variant_set_override', { component: 'cmp_tip', variant: 'var_collapsed', nodeId: 'n_tip_title', props: { text: null }, style: { font: 'medium' } })
    expect(p.json(TIP).variants[0].overrides.n_tip_title).toBeUndefined()
    p.edit('component_variant_set_override', { component: 'cmp_tip', variant: 'var_collapsed', overrides: [{ nodeId: 'n_tip', unset: ['rounded'], style: { py: null } }] })
    expect(p.json(TIP).variants[0].overrides.n_tip).toEqual({ unset: ['gap', 'rounded'] })
    expect(p.refuse('component_variant_set_override', { component: 'cmp_tip', variant: 'var_collapsed', nodeId: 'n_tip', style: { gap: '2' }, unset: ['gap'] }, 'invalid').message).toBe('"gap" cannot be both set and removed')
  })

  it('adds, updates and removes interactions, and sets transitions', () => {
    const p = project()
    const { index } = p.edit('component_interaction_add', { component: 'cmp_tip', variant: 'var_collapsed', on: 'mouseenter', to: '', delay: 0.5 })
    expect(index).toBe(1)
    expect(p.json(TIP).variants[0].interactions[1]).toEqual({ on: 'mouseenter', do: [{ kind: 'setVariant', to: '', delay: 0.5 }] })
    p.edit('component_interaction_update', { component: 'cmp_tip', variant: 'var_collapsed', index: 1, on: 'appear', delay: null })
    expect(p.json(TIP).variants[0].interactions[1]).toEqual({ on: 'appear', do: [{ kind: 'setVariant', to: '' }] })
    p.edit('component_interaction_remove', { component: 'cmp_tip', index: 0 })
    expect(p.json(TIP).interactions).toBeUndefined()
    expect(p.refuse('component_interaction_remove', { component: 'cmp_tip', index: 3 }, 'not_found').message).toBe('The primary variant of Tip has no interaction 3')
    p.edit('component_transition_set', { component: 'cmp_tip', transition: { type: 'spring', stiffness: 400 } })
    expect(p.json(TIP).transition).toEqual({ type: 'spring', stiffness: 400 })
    p.edit('component_transition_set', { component: 'cmp_tip', variant: 'var_collapsed', transition: { type: 'instant' } })
    expect(p.json(TIP).variants[0].transition).toEqual({ type: 'instant' })
    p.edit('component_transition_set', { component: 'cmp_tip', transition: null })
    expect(p.json(TIP).transition).toBeUndefined()
  })
})

describe('instances', () => {
  it('instance_set_values sets values by property id (null removes) and the variant', () => {
    const p = project()
    p.edit('instance_set_values', { file: 'pg_new_post', nodeId: 'n_tip', values: { prop_body: null, prop_tone: 'elevated' }, variant: null })
    expect(p.json(NEW_POST).root.children[0].props).toEqual({ component: 'cmp_tip', values: { prop_title: 'Writing tips', prop_tone: 'elevated' } })
    expect(p.refuse('instance_set_values', { file: 'pg_new_post', nodeId: 'n_tip', values: { prop_nope: 1 } }, 'invalid').message).toBe('Tip has no property "prop_nope"')
    expect(p.refuse('instance_set_values', { file: 'pg_new_post', nodeId: 'n_form', values: {} }, 'invalid').message).toBe('Node "n_form" is a Form, not a component instance')
    expect(p.refuse('instance_set_values', { file: 'pg_new_post', nodeId: 'n_tip', values: { prop_tone: 'loud' } }, 'invalid').problems).toEqual([{ path: NEW_POST, message: 'root.children.0.props.values.prop_tone: "loud" is not one of the options of tone (muted, elevated)' }])
  })

  it('instance_set_slot fills a slot (moving nodes in) or clears it', () => {
    const p = project()
    p.edit('instance_set_slot', { file: 'pg_index', nodeId: 'n_card', slot: 'prop_actions', filled: false })
    expect(findNode(p.json(IDX).root, 'n_card')!.children).toEqual([])
    const { fillId } = p.edit('instance_set_slot', { file: 'pg_index', nodeId: 'n_card', slot: 'prop_actions', filled: true })
    expect(fillId).toBe('n_slot_fill_1')
    expect(findNode(p.json(IDX).root, 'n_card')!.children).toEqual([{ id: 'n_slot_fill_1', type: 'SlotFill', props: { slot: 'prop_actions' } }])
    expect(p.refuse('instance_set_slot', { file: 'pg_index', nodeId: 'n_card', slot: 'prop_post', filled: true }, 'invalid').message).toBe('PostCard has no slot property "prop_post"')
  })

  it('instance_detach puts the tree the instance renders in its place: values, variant and slot content applied', () => {
    const p = project()
    const { nodeId } = p.edit('instance_detach', { file: 'pg_new_post', nodeId: 'n_tip' })
    const detached = findNode(p.json(NEW_POST).root, nodeId)!
    expect(p.json(NEW_POST).root.children[0].id).toBe(nodeId)
    // The root takes the instance's style and the component's name; the collapsed variant's overrides apply.
    expect(detached).toMatchObject({ type: 'Column', name: 'Tip', style: { px: '4', py: '2', rounded: 'md', bg: 'muted', maxW: 'xl', mb: '4' } })
    expect(detached.style.gap).toBeUndefined()
    const texts = (detached.children as Json[]).flatMap(child => [child, ...(child.children ?? [])]).map(node => [node.type, node.props])
    expect(texts).toEqual([
      ['Row', undefined],
      ['Text', { text: 'Writing tips' }],
      ['Button', { text: 'Show', variant: 'ghost', size: 'xs', color: 'neutral', icon: 'i-lucide-lightbulb' }]
    ])
  })

  it('instance_detach substitutes bound values and keeps slot content', () => {
    const p = project()
    const { nodeId } = p.edit('instance_detach', { file: 'pg_index', nodeId: 'n_card' })
    const card = findNode(p.json(IDX).root, nodeId)!
    expect(card.type).toBe('Card')
    // The cover is hidden: its `visible` reads the empty default.
    expect(card.children.map((child: Json) => child.type)).toEqual(['Link', 'Text', 'Text', 'Row'])
    expect(card.children[0].children[0].props.text).toEqual({ $bind: 'post.title' })
    expect(card.children[0].props.to).toEqual({ page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } })
    expect(card.children[2].props).toEqual({ text: 'Draft', visible: { not: { $bind: 'post.published' } } })
    expect(childIds(card.children[3])).toEqual(['n_read_more'])
  })

  it('instance_replace keeps same-named values, variant and slots, and refuses cycles', () => {
    const p = project()
    const copy = p.edit('component_duplicate', { component: 'cmp_tip', name: 'Hint' })
    p.edit('instance_replace', { file: 'pg_new_post', nodeId: 'n_tip', component: copy.componentId })
    expect(p.json(NEW_POST).root.children[0].props).toEqual({ component: 'cmp_hint', variant: 'var_collapsed_2', values: { prop_title_2: 'Writing tips', prop_body_2: 'Keep the title short: the slug becomes the post\'s URL.' } })
    p.edit('node_insert', { file: 'cmp_hint', type: 'Instance', props: { component: 'cmp_tip' } })
    expect(p.refuse('instance_replace', { file: 'cmp_hint', nodeId: 'n_instance_1', component: 'cmp_hint' }, 'invalid').message).toBe('"Hint" cannot contain itself')
  })
})

describe('the post card stays valid', () => {
  it('after a property update on a fixture component', () => {
    const p = project()
    p.edit('component_property_update', { component: 'cmp_post_card', property: 'prop_draft_label', name: 'badge', placeholder: null })
    expect(p.json(CARD).properties[2]).toMatchObject({ id: 'prop_draft_label', name: 'badge' })
    expect(p.json(CARD).properties[2].placeholder).toBeUndefined()
  })
})
