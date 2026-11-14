import { describe, expect, it } from 'vitest'
import { PROPERTY_KINDS } from '../../../codegen/src/model/schemas.ts'
import { allByTestId, byTestId, click, Failure, settle, typeInto } from '../helpers.ts'
import { check, choose, open, postCard, select, sent, setupHarness } from './harness.ts'

/**
 * Components in the Design screen (P4c, V1, V2): the Components section,
 * a component's properties, variants (with the overrides an edit makes while
 * one is active), states, interactions and transition, and an instance's slots.
 */

setupHarness()

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const openTab = (name: string) => click(byTestId(`tab-${name}`))
const fileTab = () => click(byTestId('inspector-tab-file'))
const nodeTab = () => click(byTestId('inspector-tab-node'))
const POST_CARD = 'cmp_post_card'

describe('Components section', () => {
  it('lists the components; a row opens the component in the canvas', async () => {
    await open()
    await openTab('components')
    expect(allByTestId('component-row').map(row => row.textContent?.trim())).toEqual(['PostCard', 'Tip'])

    await click(byTestId(`component-open-${POST_CARD}`))

    expect(sent('bildr:render').at(-1)?.file.id).toBe(POST_CARD)
  })

  it('makes a component from the selection, with the typed name', async () => {
    const { actions } = await open({ component_create: ok({ componentId: 'cmp_badge', nodeId: 'n_instance_1', filePath: 'x' }) })
    await select('n_h1')
    await openTab('components')
    await typeInto(byTestId('component-new-name'), 'Badge')
    await click(byTestId('component-new'))
    expect(actions.named('component_create').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', name: 'Badge' }])
  })

  it('renames, duplicates and deletes a component', async () => {
    const { actions } = await open({ component_rename: ok(), component_duplicate: ok({ componentId: 'cmp_x', filePath: 'x' }), component_delete: ok({ deletedInstances: [] }) })
    await openTab('components')

    await click(byTestId(`component-rename-${POST_CARD}`))
    await typeInto(byTestId('component-rename-input'), 'Card')
    await click(byTestId(`component-duplicate-${POST_CARD}`))
    await click(byTestId('component-delete-cmp_tip'))

    expect(actions.named('component_rename').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'Card' }])
    expect(actions.named('component_duplicate').map(call => call.input)).toEqual([{ component: POST_CARD }])
    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: 'cmp_tip' }])
  })

  it('shows the refusal of a delete in use, and offers to delete the instances too', async () => {
    const message = 'Component "PostCard" is used by 1 instance: pg_index (n_card). Delete it first, or pass force: true to delete it too'
    let refuse = true
    const { actions } = await open({ component_delete: () => refuse ? new Failure(403, 'forbidden', message) : ok({ deletedInstances: ['pg_index (n_card)'] })() })
    await openTab('components')

    await click(byTestId(`component-delete-${POST_CARD}`))
    expect(byTestId('design-error')?.textContent?.trim()).toBe(message)
    refuse = false
    await click(byTestId(`component-delete-force-${POST_CARD}`))

    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: POST_CARD }, { component: POST_CARD, force: true }])
  })
})

describe('Component canvas and variant switcher', () => {
  it('shows the primary variant, and each variant the switcher over the canvas picks', async () => {
    await open({}, POST_CARD)
    expect(sent('bildr:render').at(-1)?.variant).toEqual({ id: null, label: 'default' })
    expect([...byTestId('variant-bar')!.querySelectorAll('button')].map(tab => tab.textContent?.trim())).toEqual(['default', 'compact', 'hovered'])

    await click(byTestId('variant-tab-var_compact'))
    expect(sent('bildr:render').at(-1)?.variant).toEqual({ id: 'var_compact', label: 'compact' })
    await click(byTestId('variant-tab-'))
    expect(sent('bildr:render').at(-1)?.variant).toEqual({ id: null, label: 'default' })
  })

  it('has no switcher on a page, and a variant is dropped when its file is left', async () => {
    await open({}, POST_CARD)
    await click(byTestId('variant-tab-var_compact'))
    const picker = byTestId('file-picker') as HTMLSelectElement
    picker.value = 'pg_index'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(byTestId('variant-bar')).toBeNull()
    picker.value = POST_CARD
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(sent('bildr:render').at(-1)?.variant).toEqual({ id: null, label: 'default' })
  })
})

describe('Properties', () => {
  const addProperty = async (kind: string, name = 'subtitle') => {
    await typeInto(byTestId('prop-add-name'), name)
    await choose('prop-add-kind', kind)
  }

  it('offers every property kind of the model', async () => {
    await open({}, POST_CARD)
    await fileTab()
    const options = [...(byTestId('prop-add-kind') as HTMLSelectElement).options].map(option => option.value)
    expect(options).toEqual([...PROPERTY_KINDS])
  })

  it('adds a text property', async () => {
    const { actions } = await open({ component_property_add: ok({ propertyId: 'prop_subtitle' }) }, POST_CARD)
    await fileTab()
    await addProperty('text')
    await click(byTestId('prop-add'))
    expect(actions.named('component_property_add').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'subtitle', kind: 'text' }])
  })

  it('adds a select with its options, an entity list with its entity, and a slot', async () => {
    const { actions } = await open({ component_property_add: ok({ propertyId: 'prop_x' }) }, POST_CARD)
    await fileTab()
    await addProperty('select', 'size')
    await typeInto(byTestId('prop-add-options'), 'small, large')
    await click(byTestId('prop-add'))
    await addProperty('entity', 'posts')
    await choose('prop-add-entity', 'ent_post')
    await check('prop-add-many', true)
    await click(byTestId('prop-add'))
    await addProperty('slot', 'footer')
    await click(byTestId('prop-add'))
    expect(actions.named('component_property_add').map(call => call.input)).toEqual([
      { component: POST_CARD, name: 'size', kind: 'select', options: ['small', 'large'] },
      { component: POST_CARD, name: 'posts', kind: 'entity', entity: 'ent_post', many: true },
      { component: POST_CARD, name: 'footer', kind: 'slot' }
    ])
  })

  it('renames, labels, sets the default of and removes a property', async () => {
    const { actions } = await open({ component_property_update: ok(), component_property_remove: ok() }, POST_CARD)
    await fileTab()
    await typeInto(byTestId('property-name-prop_cover'), 'image')
    await typeInto(byTestId('property-default-prop_draft_label'), 'Draft!')
    await check('property-optional-prop_cover', true)
    await click(byTestId('property-remove-prop_cover'))
    expect(actions.named('component_property_update').map(call => call.input)).toEqual([
      { component: POST_CARD, property: 'prop_cover', name: 'image' },
      { component: POST_CARD, property: 'prop_draft_label', default: 'Draft!' },
      { component: POST_CARD, property: 'prop_cover', optional: true }
    ])
    expect(actions.named('component_property_remove').map(call => call.input)).toEqual([{ component: POST_CARD, property: 'prop_cover' }])
  })

  it('binds a property to a prop or a style key of the selected node, and unbinds', async () => {
    const { actions } = await open({
      component_property_update: (input) => {
        const property = postCard().properties.find(entry => entry.id === input.property)!
        if (input.bindings === null) delete property.bindings
        else property.bindings = input.bindings as never
        return { changed: [] }
      }
    }, POST_CARD)
    await fileTab()
    await select('n_title')

    await choose('property-bind-target-prop_draft_label', 'prop:text')
    await click(byTestId('property-bind-prop_draft_label'))
    await choose('property-bind-target-prop_draft_label', 'style:bg')
    await click(byTestId('property-bind-prop_draft_label'))
    await click(byTestId('property-unbind-prop_draft_label-0'))

    const bound = { nodeId: 'n_draft', prop: 'text' }
    const title = { nodeId: 'n_title', prop: 'text' }
    const background = { nodeId: 'n_title', prop: 'bg', target: 'style' }
    expect(actions.named('component_property_update').map(call => call.input)).toEqual([
      { component: POST_CARD, property: 'prop_draft_label', bindings: [bound, title] },
      { component: POST_CARD, property: 'prop_draft_label', bindings: [bound, title, background] },
      { component: POST_CARD, property: 'prop_draft_label', bindings: [title, background] }
    ])
  })

  it('points a slot property at the selected container', async () => {
    const { actions } = await open({ component_property_update: ok() }, POST_CARD)
    await fileTab()
    await select('n_card')
    await click(byTestId('property-slot-prop_actions'))
    expect(actions.named('component_property_update').map(call => call.input)).toEqual([{ component: POST_CARD, property: 'prop_actions', nodeId: 'n_card' }])
  })
})

describe('Variants and states', () => {
  it('adds, renames and deletes a variant', async () => {
    const { actions } = await open({ component_variant_add: ok({ variantId: 'var_large' }), component_variant_rename: ok(), component_variant_delete: ok() }, POST_CARD)
    await fileTab()
    await typeInto(byTestId('variant-add-name'), 'large')
    await click(byTestId('variant-add'))
    await typeInto(byTestId('variant-rename-var_compact'), 'dense')
    await click(byTestId('variant-delete-var_compact'))
    expect(actions.named('component_variant_add').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'large' }])
    expect(actions.named('component_variant_rename').map(call => call.input)).toEqual([{ component: POST_CARD, variant: 'var_compact', name: 'dense' }])
    expect(actions.named('component_variant_delete').map(call => call.input)).toEqual([{ component: POST_CARD, variant: 'var_compact' }])
  })

  it('adds a pressed state to the primary and a hover state to a variant; a state that exists has no button', async () => {
    const { actions } = await open({ component_state_add: ok({ variantId: 'var_x' }) }, POST_CARD)
    await fileTab()
    expect(byTestId('state-add--hover')).toBeNull()
    await click(byTestId('state-add--pressed'))
    await click(byTestId('state-add-var_compact-hover'))
    expect(actions.named('component_state_add').map(call => call.input)).toEqual([
      { component: POST_CARD, baseVariant: '', kind: 'pressed' },
      { component: POST_CARD, baseVariant: 'var_compact', kind: 'hover' }
    ])
  })

  it('edits of the style and props of a node while a variant is active are that variant\'s overrides', async () => {
    const { actions } = await open({ component_variant_set_override: ok(), node_update_style: ok(), node_update_props: ok() }, POST_CARD)
    await fileTab()
    await click(byTestId('variant-activate-var_compact'))
    await nodeTab()
    await select('n_title')

    await typeInto(byTestId('style-p'), '2')
    await choose('prop-level', '3')

    expect(actions.named('component_variant_set_override').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_title', style: { p: '2' } },
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_title', props: { level: 3 } }
    ])
    expect(actions.named('node_update_style')).toEqual([])
    expect(actions.named('node_update_props')).toEqual([])
  })

  it('shows the node with the active variant\'s overrides applied, and a breakpoint-prefixed key at the device', async () => {
    const { actions } = await open({ component_variant_set_override: ok() }, POST_CARD)
    await fileTab()
    await click(byTestId('variant-activate-var_compact'))
    await nodeTab()
    await select('n_card')
    expect((byTestId('style-p') as HTMLInputElement).value).toBe('3')

    await click(byTestId('device-tablet'))
    await typeInto(byTestId('style-p'), '8')
    expect(actions.named('component_variant_set_override').at(-1)?.input).toEqual({ component: POST_CARD, variant: 'var_compact', nodeId: 'n_card', style: { 'md:p': '8' } })
  })

  it('clearing a token the variant overrides gives back the primary\'s; clearing one only the primary sets unsets it', async () => {
    const { actions } = await open({ component_variant_set_override: ok() }, POST_CARD)
    await fileTab()
    await click(byTestId('variant-activate-var_compact'))
    await nodeTab()
    await select('n_card')
    await typeInto(byTestId('style-p'), '')
    await click(byTestId('variant-tab-var_hovered'))
    await typeInto(byTestId('style-p'), '')

    expect(actions.named('component_variant_set_override').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_card', style: { p: null } },
      { component: POST_CARD, variant: 'var_hovered', nodeId: 'n_card', unset: ['p'] }
    ])
  })

  it('lists the active variant\'s overrides, each resettable', async () => {
    const { actions } = await open({ component_variant_set_override: ok() }, POST_CARD)
    await fileTab()
    await click(byTestId('variant-activate-var_compact'))
    expect(allByTestId('override').map(row => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual(expect.arrayContaining([expect.stringContaining('gap'), expect.stringContaining('hidden')]))

    await click(byTestId('override-reset-n_card-gap'))
    await click(byTestId('override-reset-n_excerpt-hidden'))

    expect(actions.named('component_variant_set_override').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_card', style: { gap: null } },
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_excerpt', props: { hidden: null } }
    ])
  })
})

describe('Interactions and transition', () => {
  it('adds an interaction to the primary, going to the first variant', async () => {
    const { actions } = await open({ component_interaction_add: ok({ index: 0 }) }, POST_CARD)
    await fileTab()
    await click(byTestId('interaction-add'))
    expect(actions.named('component_interaction_add').map(call => call.input)).toEqual([{ component: POST_CARD, variant: '', on: 'click', to: 'var_compact' }])
  })

  it('edits and removes an interaction of a variant', async () => {
    postCard().variants[0]!.interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: '' }] }]
    const { actions } = await open({
      component_interaction_update: (input) => {
        const interaction = postCard().variants[0]!.interactions![Number(input.index)]!
        if (input.on) interaction.on = input.on as 'click'
        if (input.to !== undefined) interaction.do[0].to = String(input.to)
        if (input.delay === null) delete interaction.do[0].delay
        else if (input.delay !== undefined) interaction.do[0].delay = Number(input.delay)
        return { changed: [] }
      },
      component_interaction_remove: ok()
    }, POST_CARD)
    await fileTab()
    await click(byTestId('variant-activate-var_compact'))

    await choose('interaction-on-0', 'mouseenter')
    await choose('interaction-to-0', 'var_compact')
    await typeInto(byTestId('interaction-delay-0'), '0.5')
    await typeInto(byTestId('interaction-delay-0'), '')
    await click(byTestId('interaction-remove-0'))

    const base = { component: POST_CARD, variant: 'var_compact', index: 0 }
    expect(actions.named('component_interaction_update').map(call => call.input)).toEqual([
      { ...base, on: 'mouseenter' }, { ...base, to: 'var_compact' }, { ...base, delay: 0.5 }, { ...base, delay: null }
    ])
    expect(actions.named('component_interaction_remove').map(call => call.input)).toEqual([base])
  })

  it('sets the transition of the component: ease keeps its duration and easing, spring takes stiffness and damping, none removes it', async () => {
    const { actions } = await open({
      component_transition_set: (input) => {
        if (input.transition) postCard().transition = input.transition as never
        else delete postCard().transition
        return { changed: [] }
      }
    }, POST_CARD)
    await fileTab()
    await typeInto(byTestId('transition-duration'), '0.5')
    await choose('transition-easing', 'linear')
    await choose('transition-type', 'spring')
    await choose('transition-type', 'none')
    expect(actions.named('component_transition_set').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: '', transition: { type: 'ease', duration: 0.5, easing: 'ease-out' } },
      { component: POST_CARD, variant: '', transition: { type: 'ease', duration: 0.5, easing: 'linear' } },
      { component: POST_CARD, variant: '', transition: { type: 'spring', stiffness: 400, damping: 25 } },
      { component: POST_CARD, variant: '', transition: null }
    ])
  })
})

describe('Instance inspector', () => {
  it('names an instance by its component in the layers and the inspector', async () => {
    await open()
    expect(document.body.querySelector('[data-testid="layer"][data-node-id="n_card"]')?.textContent).toContain('PostCard')
    await select('n_card')
    expect(byTestId('inspector-node')?.textContent).toContain('PostCard')
  })

  it('offers the variants of the component, not its states (those follow the pointer)', async () => {
    await open()
    await select('n_card')
    const options = [...(byTestId('instance-variant') as HTMLSelectElement).options].map(option => option.value)
    expect(options).toEqual(['', 'var_compact'])
  })

  it('clears and fills a slot, detaches, and replaces the component', async () => {
    const { actions } = await open({ instance_set_slot: ok({ fillId: null }), instance_detach: ok(), instance_replace: ok() })
    await select('n_card')

    await check('instance-slot-prop_actions', false)
    await click(byTestId('instance-detach'))
    await choose('instance-replace', 'cmp_tip')

    expect(actions.named('instance_set_slot').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card', slot: 'prop_actions', filled: false }])
    expect(actions.named('instance_detach').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card' }])
    expect(actions.named('instance_replace').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card', component: 'cmp_tip' }])
  })
})
