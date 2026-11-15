import { describe, expect, it } from 'vitest'
import { allByTestId, byTestId, click, Failure, settle, typeInto } from '../helpers.ts'
import { byLabel, chooseDevice, combo, inputOf, inspectorHead, layer, menuItem, must, open, openFile, optionLabels, postCard, propInput, propRow, propSelect, readyAll, resetStyle, sectionAdd, select, selectOption, sent, setupHarness, showVariant, sidebarTab, styleField, toggle, typeNumber, typeStyle } from './harness.ts'

/**
 * Components in the Design screen (P4c, U5, V1, V2): the Components section, the hosted component
 * panel over the module (an Instance's values, the variants with the overrides an edit makes while one is
 * active, their states, the interactions and the transition, the properties on the root and the ones
 * bound to a node, the properties modal) and the variant chip over the canvas.
 */

setupHarness()

const ok = (extra: Record<string, unknown> = {}) => () => ({ changed: [], ...extra })
const component = (id: string) => document.body.querySelector<HTMLElement>(`[data-component-id="${id}"]`)
const actionsOf = (id: string) => component(id)!.querySelector('[aria-label="Component actions"]')
const confirmOk = () => click(document.body.querySelector<HTMLElement>('[data-confirm-ok]'))
const POST_CARD = 'cmp_post_card'
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
/** A row of a section's list: the row that holds the field with this accessible name. */
const rowOf = (name: string) => byLabel(name)!.closest<HTMLElement>('.group\\/row')!
const rows = (section: string) => qa(`[${section}] [aria-label$=" property name"], [${section}] [aria-label$=" variable name"]`).map(input => input.getAttribute('aria-label'))
/** Opens the PostCard component with its root selected: with nothing selected the inspector shows only its hint (U-E2), as the hosted editor does. */
const openRoot = async (extra: Parameters<typeof open>[0] = {}) => {
  const mounted = await open(extra, POST_CARD)
  await select('n_card')
  return mounted
}

describe('Components section', () => {
  it('lists the components with where each is used; a row opens the component in the canvas', async () => {
    await open()
    await sidebarTab('Assets')
    expect([...document.body.querySelectorAll('[data-component-id]')].map(row => row.getAttribute('data-component-id'))).toEqual([POST_CARD, 'cmp_tip'])
    expect(component(POST_CARD)!.textContent).toContain('PostCard')
    expect(component(POST_CARD)!.querySelector('[data-usage-count]')?.getAttribute('data-usage-count')).toBe('1')
    expect(component('cmp_tip')!.querySelector('[data-usage-count]')?.getAttribute('data-usage-count')).toBe('1')

    await click(component(POST_CARD)!.querySelector('button[draggable]'))

    expect(sent('bildr:render').at(-1)?.file.id).toBe(POST_CARD)
  })

  it('makes a component from the selection, with the typed name', async () => {
    const { actions } = await open({ component_create: ok({ componentId: 'cmp_badge', nodeId: 'n_instance_1', filePath: 'x' }) })
    await select('n_h1')
    await sidebarTab('Assets')
    await click(document.body.querySelector('[aria-label="Create component"]'))
    // The dialog opens with the layer's name, selected for typing.
    expect(document.body.querySelector<HTMLInputElement>('[data-create-name]')?.value).toBe('Heading')
    await typeInto(document.body.querySelector<HTMLElement>('[data-create-name]'), 'Badge')
    await click(document.body.querySelector('[data-create-submit]'))
    expect(actions.named('component_create').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_h1', name: 'Badge' }])
  })

  it('renames, duplicates and deletes a component', async () => {
    const { actions } = await open({ component_rename: ok(), component_duplicate: ok({ componentId: 'cmp_x', filePath: 'x' }), component_delete: ok({ deletedInstances: [] }) })
    await sidebarTab('Assets')

    await menuItem(actionsOf(POST_CARD), 'Rename')
    const name = document.body.querySelector<HTMLInputElement>('input[aria-label="Component name"]')!
    await typeInto(name, 'Card')
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    await menuItem(actionsOf(POST_CARD), 'Duplicate')
    await menuItem(actionsOf('cmp_tip'), 'Delete')
    await confirmOk()

    expect(actions.named('component_rename').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'Card' }])
    expect(actions.named('component_duplicate').map(call => call.input)).toEqual([{ component: POST_CARD }])
    // The first delete is never forced: only the module's own in-use refusal leads to a forced one.
    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: 'cmp_tip' }])
  })

  it('deletes a component in use only after the module refuses it and the refusal is confirmed, then with its instances', async () => {
    const refusal = 'Component "PostCard" is used by 1 instance: pg_index (n_card). Delete it first'
    const { actions } = await open({
      component_delete: (input: { force?: boolean }) => input.force ? { changed: [], deletedInstances: ['pg_index (n_card)'] } : new Failure(422, 'invalid', refusal)
    })
    await sidebarTab('Assets')

    await menuItem(actionsOf(POST_CARD), 'Delete')
    expect(actions.named('component_delete')).toEqual([])
    await confirmOk()
    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: POST_CARD }])

    // The second confirm shows what the module refused, not the editor's own (possibly stale) usage list.
    expect(document.body.querySelector('[data-confirm]')?.textContent).toContain('pg_index (n_card)')
    await confirmOk()
    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: POST_CARD }, { component: POST_CARD, force: true }])
  })

  it('shows a refusal of the module in the editor', async () => {
    const message = 'Component "Tip" is used by 1 instance: pg_about (n_tip). Delete it first'
    await open({ component_delete: () => new Failure(422, 'invalid', message) })
    await sidebarTab('Assets')
    await menuItem(actionsOf('cmp_tip'), 'Delete')
    await confirmOk()
    expect(byTestId('design-error')?.textContent?.trim()).toBe(message)
  })
})

describe('Component canvas and the variant being edited', () => {
  /** The chip of a board frame, by its label. */
  const chip = (label: string) => qa('[data-board-label]').find(element => element.textContent?.trim() === label)
  const activeChip = () => q('[data-board-bar][data-active] [data-board-label]')?.textContent?.trim()
  /** The variant a board frame renders (`bildr:render.variant`), by its variant's id. */
  const renderedVariant = (id: string | null) => sent('bildr:render').findLast(message => message.variant?.id === id)?.variant

  it('shows every variant on the board, a frame with its chip each (a state under its base), each rendering its own variant; the Variants section picks the active one', async () => {
    await openRoot()
    await readyAll()
    expect(qa('[data-component-variants] [data-variant-row]').map(row => row.dataset.variantRow)).toEqual(['primary', 'var_compact', 'var_hovered'])
    expect(qa('[data-board-label]').map(element => element.textContent?.trim())).toEqual(['Primary', 'hovered', 'compact'])
    expect(qa('iframe[data-board-variant]').map(frame => frame.dataset.boardVariant)).toEqual(['primary', 'var_hovered', 'var_compact'])
    expect(renderedVariant(null)).toEqual({ id: null, label: 'default' })
    expect(renderedVariant('var_compact')).toEqual({ id: 'var_compact', label: 'compact' })
    expect(renderedVariant('var_hovered')).toEqual({ id: 'var_hovered', label: 'hovered' })
    expect(activeChip()).toBe('Primary')

    await showVariant('var_compact')
    expect(activeChip()).toBe('compact')
    await showVariant(null)
    expect(activeChip()).toBe('Primary')
  })

  it('makes a frame\'s variant the active one with a click on its chip', async () => {
    await openRoot()
    await click(chip('compact')!)
    expect(activeChip()).toBe('compact')
    expect(q('[data-component-variants] [data-variant-row="var_compact"] button[aria-pressed]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('has no variants or chip on a page, and a variant is dropped when its file is left', async () => {
    await openRoot()
    await showVariant('var_compact')
    await openFile('pg_index')
    expect(q('[data-component-variants]')).toBeNull()
    expect(q('[data-board-bar]')).toBeNull()
    await openFile(POST_CARD)
    expect(activeChip()).toBe('Primary')
  })

  it('renames a variant from its chip (a double-click), but not the primary', async () => {
    const { actions } = await open({ component_variant_rename: ok() }, POST_CARD)
    chip('Primary')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    expect(q('[data-board-rename]')).toBeNull()

    chip('compact')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await settle()
    await typeInto(q('[data-board-rename]'), 'dense')

    expect(actions.named('component_variant_rename').map(call => call.input)).toEqual([{ component: POST_CARD, variant: 'var_compact', name: 'dense' }])
  })
})

describe('Properties', () => {
  it('lists the properties of the component on its root, each labelled by what it sets', async () => {
    await open({}, POST_CARD)
    await select('n_card')
    expect(q('[data-component-properties]')?.getAttribute('data-style-section')).toBe('Component properties')
    expect(rows('data-component-properties')).toEqual(['post property name', 'cover property name', 'draftLabel property name', 'actions property name'])
    expect(rowOf('post property name').textContent).toContain('Record')
    expect(rowOf('cover property name').textContent).toContain('Image')
    expect(rowOf('draftLabel property name').textContent).toContain('Text')
    expect(rowOf('actions property name').textContent).toContain('Slot')
  })

  it('shows on another node the properties bound to it (a slot property names its container)', async () => {
    await open({}, POST_CARD)
    await select('n_draft')
    expect(q('[data-component-properties]')?.getAttribute('data-style-section')).toBe('Properties')
    expect(rows('data-component-properties')).toEqual(['draftLabel property name'])
    await select('n_actions')
    expect(rows('data-component-properties')).toEqual(['actions property name'])
  })

  it('adds a property from a prop of the selected node, named after it and bound to it', async () => {
    const { actions } = await open({ component_property_add: ok({ propertyId: 'prop_text' }) }, POST_CARD)
    await select('n_title')
    await menuItem(sectionAdd('data-component-properties'), 'Text')
    expect(actions.named('component_property_add').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'Text', kind: 'text', bindings: [{ nodeId: 'n_title', prop: 'text' }] }])
  })

  it('adds one from a style key (a select over its scale), and a slot from the children of a container', async () => {
    const { actions } = await open({ component_property_add: ok({ propertyId: 'prop_x' }) }, POST_CARD)
    await select('n_card')
    await menuItem(sectionAdd('data-component-properties'), 'Style · Gap')
    await menuItem(sectionAdd('data-component-properties'), 'Slot (children)')
    const [gap, slot] = actions.named('component_property_add').map(call => call.input)
    expect(gap).toMatchObject({ component: POST_CARD, name: 'Gap', kind: 'select', bindings: [{ nodeId: 'n_card', prop: 'gap', target: 'style' }] })
    expect((gap!.options as string[])).toContain('4')
    expect(slot).toEqual({ component: POST_CARD, name: 'Content', kind: 'slot', nodeId: 'n_card' })
  })

  it('offers a prop a property already drives as disabled, and a container that is a slot already', async () => {
    await open({}, POST_CARD)
    await select('n_draft')
    await click(sectionAdd('data-component-properties'))
    const item = (label: string) => qa('[role^="menuitem"]').find(element => element.textContent?.trim().startsWith(label))
    expect(item('Text')?.getAttribute('data-disabled')).not.toBeNull()
    expect(item('Text')?.textContent).toContain('Already a property')
  })

  it('adds a record or a list of an entity of the model: the module\'s entity properties', async () => {
    const { actions } = await open({ component_property_add: ok({ propertyId: 'prop_x' }) }, POST_CARD)
    await select('n_card')
    await menuItem(sectionAdd('data-component-properties'), 'List')
    await click(qa('[role^="menuitem"]').find(element => element.textContent?.trim().startsWith('Post')) ?? null)
    expect(actions.named('component_property_add').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'posts', kind: 'entity', entity: 'ent_post', many: true }])
  })

  it('renames and removes a property from its row', async () => {
    const { actions } = await open({ component_property_update: ok(), component_property_remove: ok() }, POST_CARD)
    await select('n_card')
    await typeInto(byLabel('cover property name'), 'image')
    await click(rowOf('draftLabel property name').querySelector<HTMLElement>('[data-row-remove]'))
    expect(actions.named('component_property_update').map(call => call.input)).toEqual([{ component: POST_CARD, property: 'prop_cover', name: 'image' }])
    expect(actions.named('component_property_remove').map(call => call.input)).toEqual([{ component: POST_CARD, property: 'prop_draft_label' }])
  })

  it('renames the component from the root\'s Name row', async () => {
    const { actions } = await open({ component_rename: ok() }, POST_CARD)
    await select('n_card')
    await typeInto(byLabel('Component name'), 'Card')
    expect(actions.named('component_rename').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'Card' }])
  })
})

describe('The properties modal', () => {
  const openModal = async (extra: Record<string, () => unknown> = {}, property?: string) => {
    const mounted = await open({ component_property_update: ok(), component_property_remove: ok(), ...extra }, POST_CARD)
    await select('n_card')
    await click(must('[data-component-properties] [data-section-action="edit"]'))
    if (property) await click(must(`[data-property-row="${property}"] button`))
    return mounted
  }

  it('lists the properties of the component, the first one\'s details beside them, and closes with Done', async () => {
    await openModal()
    expect(must('[data-properties-modal]').getAttribute('data-properties-kind')).toBe('component')
    expect(qa('[data-property-row]').map(row => row.dataset.propertyRow)).toEqual(['prop_post', 'prop_cover', 'prop_draft_label', 'prop_actions'])
    expect(must('[data-property-details]').dataset.propertyDetails).toBe('prop_post')
    expect(must('[data-property-type]').textContent).toBe('Record')
    await click(must('[data-properties-done]'))
    expect(q('[data-properties-modal]')).toBeNull()
  })

  it('edits the name, the description and Optional of a property, each one update', async () => {
    const { actions } = await openModal({}, 'prop_draft_label')
    await typeInto(must('[data-property-name]'), 'badge')
    await typeInto(must('[data-property-description]'), '  Shown on a draft ')
    await toggle('[data-property-optional]')
    await typeInto(must('[data-property-placeholder]'), '')
    expect(actions.named('component_property_update').map(call => call.input)).toEqual([
      { component: POST_CARD, property: 'prop_draft_label', name: 'badge' },
      { component: POST_CARD, property: 'prop_draft_label', description: 'Shown on a draft' },
      // The property is optional already: the switch turns it off, which removes the flag.
      { component: POST_CARD, property: 'prop_draft_label', optional: null },
      { component: POST_CARD, property: 'prop_draft_label', placeholder: null }
    ])
  })

  it('sets the default of a property in a field of its kind, and resets it', async () => {
    const { actions } = await openModal({}, 'prop_draft_label')
    await typeInto(must('[data-property-default] input'), 'Draft!')
    expect(actions.named('component_property_update').at(-1)?.input).toEqual({ component: POST_CARD, property: 'prop_draft_label', default: 'Draft!' })
  })

  it('keeps the default of a number property when a typo is typed, puts the saved value back, and takes a real number', async () => {
    postCard().properties.push({ id: 'prop_count', name: 'count', kind: 'number', default: 3 })
    const { actions } = await openModal({}, 'prop_count')
    const field = () => must('[data-property-default] input') as HTMLInputElement
    expect(field().value).toBe('3')

    await typeNumber(must('[data-property-default]'), 'abc')
    expect(actions.named('component_property_update')).toEqual([])
    expect(field().value).toBe('3')

    await typeNumber(must('[data-property-default]'), '4')
    expect(actions.named('component_property_update').map(call => call.input)).toEqual([{ component: POST_CARD, property: 'prop_count', default: 4 }])
  })

  it('edits a select\'s options as a comma list, and an entity property\'s entity and whether it is a list', async () => {
    postCard().properties.push({ id: 'prop_size', name: 'size', kind: 'select', options: ['small', 'large'] })
    const { actions } = await openModal({}, 'prop_size')
    expect(inputOf('[data-property-options]').value).toBe('small, large')
    await typeInto(must('[data-property-options]'), 'small, large, huge')
    await typeInto(must('[data-property-options]'), '')
    await click(must('[data-property-row="prop_post"] button'))
    await toggle('[data-property-many]')
    await selectOption(combo('[data-property-entity]'), 'Quote')

    expect(actions.named('component_property_update').map(call => call.input)).toEqual([
      { component: POST_CARD, property: 'prop_size', options: ['small', 'large', 'huge'] },
      { component: POST_CARD, property: 'prop_size', options: null },
      { component: POST_CARD, property: 'prop_post', many: true },
      { component: POST_CARD, property: 'prop_post', entity: 'ent_quote' }
    ])
  })

  it('deletes a property after a confirm, naming what instances lose', async () => {
    const { actions } = await openModal({}, 'prop_actions')
    await click(must('[data-property-delete]'))
    expect(must('[data-confirm]').textContent).toContain('their own content')
    expect(actions.named('component_property_remove')).toEqual([])
    await confirmOk()
    expect(actions.named('component_property_remove').map(call => call.input)).toEqual([{ component: POST_CARD, property: 'prop_actions' }])
  })

  it('moves a property by dragging its row onto another (its new position is the update\'s index)', async () => {
    const { actions } = await openModal()
    const from = must('[data-property-row="prop_actions"]')
    const to = must('[data-property-row="prop_post"]')
    from.dispatchEvent(new Event('dragstart', { bubbles: true }))
    to.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    to.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    await settle()
    expect(actions.named('component_property_update').map(call => call.input)).toEqual([{ component: POST_CARD, property: 'prop_actions', index: 0 }])
  })

  it('opens by itself right after the binding dot creates a property, on the component\'s properties', async () => {
    const { actions } = await open({ component_property_add: ok({ propertyId: 'prop_text' }) }, POST_CARD)
    await select('n_excerpt')
    expect(q('[data-properties-modal]')).toBeNull()
    await menuItem(propRow('text')!.querySelector('[data-binding-dot]'), 'Create property')
    expect(actions.named('component_property_add')).toHaveLength(1)
    expect(must('[data-properties-modal]').getAttribute('data-properties-kind')).toBe('component')
  })
})

describe('Variants and states', () => {
  it('adds a variant from the section\'s + (named like the primary\'s next), and shows it', async () => {
    const { actions } = await openRoot({ component_variant_add: ok({ variantId: 'var_large' }) })
    await menuItem(sectionAdd('data-component-variants'), 'New variant')
    expect(actions.named('component_variant_add').map(call => call.input)).toEqual([{ component: POST_CARD, name: 'Variant 3' }])
  })

  it('renames a variant from its menu, and deletes it after a confirm', async () => {
    const { actions } = await openRoot({ component_variant_rename: ok(), component_variant_delete: ok() })
    await menuItem(byLabel('compact variant actions'), 'Rename')
    await typeInto(must('input[aria-label="compact variant name"]'), 'dense')
    await menuItem(byLabel('compact variant actions'), 'Delete')
    expect(must('[data-confirm]').textContent).toContain('fall back to Primary')
    expect(actions.named('component_variant_delete')).toEqual([])
    await confirmOk()
    expect(actions.named('component_variant_rename').map(call => call.input)).toEqual([{ component: POST_CARD, variant: 'var_compact', name: 'dense' }])
    expect(actions.named('component_variant_delete').map(call => call.input)).toEqual([{ component: POST_CARD, variant: 'var_compact' }])
  })

  it('cannot rename or delete the primary: it is the component itself', async () => {
    await openRoot()
    await click(byLabel('Primary variant actions'))
    await settle()
    const item = (label: string) => qa('[role^="menuitem"]').find(element => element.textContent?.trim().startsWith(label))
    expect(item('Rename')?.getAttribute('data-disabled')).not.toBeNull()
    expect(item('Delete')?.getAttribute('data-disabled')).not.toBeNull()
  })

  it('adds a pressed state to the primary and a hover state to a variant; a state that exists is disabled, and a state has none', async () => {
    const { actions } = await openRoot({ component_state_add: ok({ variantId: 'var_x' }) })
    await menuItem(byLabel('Primary variant actions'), 'Add pressed state')
    await menuItem(byLabel('compact variant actions'), 'Add hover state')
    expect(actions.named('component_state_add').map(call => call.input)).toEqual([
      { component: POST_CARD, baseVariant: '', kind: 'pressed' },
      { component: POST_CARD, baseVariant: 'var_compact', kind: 'hover' }
    ])

    // The primary has a hover state already.
    byLabel('Primary variant actions')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(qa('[role^="menuitem"]').find(element => element.textContent?.trim().startsWith('Add hover state'))?.getAttribute('data-disabled')).not.toBeNull()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    // A state (hovered) shows by itself from the pointer: its menu has no state to add.
    byLabel('hovered variant actions')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(qa('[role^="menuitem"]').some(element => element.textContent?.includes('state'))).toBe(false)
  })

  it('edits of the style and props of a node while a variant is active are that variant\'s overrides', async () => {
    const { actions } = await openRoot({ component_variant_set_override: ok(), node_update_style: ok(), node_update_props: ok() })
    await showVariant('var_compact')
    await select('n_title')

    await typeStyle('w', 'full')
    await selectOption(propSelect('level'), '3')

    expect(actions.named('component_variant_set_override').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_title', style: { w: 'full' } },
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_title', props: { level: 3 } }
    ])
    expect(actions.named('node_update_style')).toEqual([])
    expect(actions.named('node_update_props')).toEqual([])
  })

  it('shows the node with the active variant\'s overrides applied, and a breakpoint-prefixed key at the device', async () => {
    const { actions } = await openRoot({ component_variant_set_override: ok() })
    await showVariant('var_compact')
    await select('n_card')
    expect(styleField('p')!.querySelector('input')!.value).toBe('3')

    // The board shows the variants at one breakpoint; with it off the device frames come back, of the active variant.
    await toggle('[data-variant-board-toggle]')
    await chooseDevice('tablet')
    await typeStyle('p', '8')
    expect(actions.named('component_variant_set_override').at(-1)?.input).toEqual({ component: POST_CARD, variant: 'var_compact', nodeId: 'n_card', style: { 'md:p': '8' } })
  })

  it('clearing a token the variant overrides gives back the primary\'s; clearing one only the primary sets unsets it', async () => {
    const { actions } = await openRoot({ component_variant_set_override: ok() })
    await showVariant('var_compact')
    await select('n_card')
    await resetStyle('padding')
    await showVariant('var_hovered')
    await resetStyle('padding')

    expect(actions.named('component_variant_set_override').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_card', style: { p: null } },
      { component: POST_CARD, variant: 'var_hovered', nodeId: 'n_card', unset: ['p'] }
    ])
  })

  it('lists what the active variant overrides once, in the inspector\'s section, each resettable', async () => {
    const { actions } = await openRoot({ component_variant_set_override: ok() })
    await showVariant('var_compact')
    await select('n_card')
    expect(qa('[data-variant-overrides]')).toHaveLength(1)
    expect(allByTestId('override')).toEqual([])
    expect(qa('[data-variant-overrides] [data-override]').map(row => row.dataset.override)).toEqual(['style:gap', 'style:p'])

    await select('n_excerpt')
    qa('[data-variant-overrides] [data-field-state="set"]')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))
    await settle()

    expect(actions.named('component_variant_set_override').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: 'var_compact', nodeId: 'n_excerpt', props: { hidden: null } }
    ])
  })
})

describe('Interactions and transition', () => {
  const pickTarget = async (event: string, target: string) => {
    await menuItem(sectionAdd('data-component-interactions'), event)
    await click(qa('[role^="menuitem"]').find(element => element.textContent?.trim().startsWith(target)) ?? null)
  }

  it('adds an interaction to the primary from "+": the event, then the variant it goes to', async () => {
    const { actions } = await open({ component_interaction_add: ok({ index: 0 }) }, POST_CARD)
    await select('n_card')
    await pickTarget('Click', 'compact')
    expect(actions.named('component_interaction_add').map(call => call.input)).toEqual([{ component: POST_CARD, on: 'click', to: 'var_compact' }])
  })

  it('offers a variant as a target, never a state, and a state\'s own list says it shows from the pointer', async () => {
    await openRoot()
    await click(sectionAdd('data-component-interactions'))
    expect(qa('[role^="menuitem"]').map(item => item.textContent?.trim().split(/\s/)[0])).toEqual(expect.arrayContaining(['Click', 'Mouse', 'Appear']))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    await showVariant('var_hovered')
    expect(must('[data-component-interactions]').textContent).toContain('A state shows from the pointer')
  })

  it('lists the interactions of the active variant as rows, edits one in its popover and removes it', async () => {
    postCard().variants[0]!.interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: '' }] }]
    const { actions } = await openRoot({
      component_interaction_update: (input) => {
        const interaction = postCard().variants[0]!.interactions![Number(input.index)]!
        if (input.on) interaction.on = input.on as 'click'
        if (input.to !== undefined) interaction.do[0].to = String(input.to)
        if (input.delay === null) delete interaction.do[0].delay
        else if (input.delay !== undefined) interaction.do[0].delay = Number(input.delay)
        return { changed: [] }
      },
      component_interaction_remove: ok()
    })
    await showVariant('var_compact')
    expect(qa('[data-interaction-row]').map(row => row.dataset.interactionRow)).toEqual(['var_compact:0'])
    expect(q('[data-interaction-row]')?.textContent).toContain('Click → Primary')

    await click(byLabel('Edit Click → Primary'))
    await selectOption(combo('[data-interaction-on]'), 'Mouse enter')
    await typeInto(must('[data-interaction-delay]'), '0.5')
    await typeInto(must('[data-interaction-delay]'), '')
    await click(must('[data-interaction-remove]'))

    const base = { component: POST_CARD, variant: 'var_compact', index: 0 }
    expect(actions.named('component_interaction_update').map(call => call.input)).toEqual([
      { ...base, on: 'mouseenter' }, { ...base, delay: 0.5 }, { ...base, delay: null }
    ])
    expect(actions.named('component_interaction_remove').map(call => call.input)).toEqual([base])
  })

  it('removes an interaction from its row\'s ×', async () => {
    postCard().interactions = [{ on: 'appear', do: [{ kind: 'setVariant', to: 'var_compact' }] }]
    const { actions } = await openRoot({ component_interaction_remove: ok() })
    expect(q('[data-interaction-row=":0"]')?.textContent).toContain('Appear → compact')
    await click(byLabel('Remove Appear → compact'))
    expect(actions.named('component_interaction_remove').map(call => call.input)).toEqual([{ component: POST_CARD, variant: '', index: 0 }])
  })

  it('sets the transition of the component: ease keeps its duration and easing, spring takes the defaults, instant is one', async () => {
    const { actions } = await openRoot({
      component_transition_set: (input) => {
        if (input.transition) postCard().transition = input.transition as never
        else delete postCard().transition
        return { changed: [] }
      }
    })
    expect(must('[data-transition-row]').textContent).toContain('Ease 0.2s')
    await click(must('[data-transition-row]'))
    await typeInto(must('[data-transition-duration]'), '0.5')
    await selectOption(combo('[data-transition-easing]'), 'Linear')
    const type = (label: string) => click(qa('[data-transition-type] button').find(button => button.textContent?.trim() === label) ?? null)
    await type('Spring')
    await type('Instant')
    expect(actions.named('component_transition_set').map(call => call.input)).toEqual([
      { component: POST_CARD, transition: { type: 'ease', duration: 0.5, easing: 'ease-out' } },
      { component: POST_CARD, transition: { type: 'ease', duration: 0.5, easing: 'linear' } },
      { component: POST_CARD, transition: { type: 'spring', stiffness: 300, damping: 30 } },
      { component: POST_CARD, transition: { type: 'instant' } }
    ])
  })

  it('sets the transition of a variant, shown as Inherit until it has its own, and clears it with Inherit', async () => {
    const { actions } = await openRoot({ component_transition_set: ok() })
    await showVariant('var_compact')
    expect(must('[data-transition-row]').textContent).toContain('Inherit')
    await click(must('[data-transition-row]'))
    expect(q('[data-transition-inherit]')).toBeNull()
    await click(qa('[data-transition-type] button').find(button => button.textContent?.trim() === 'Instant') ?? null)
    expect(actions.named('component_transition_set').map(call => call.input)).toEqual([{ component: POST_CARD, variant: 'var_compact', transition: { type: 'instant' } }])
  })
})

describe('Instance inspector', () => {
  it('names an instance by its component in the layers and the inspector', async () => {
    await open()
    expect(layer('n_card')?.textContent).toContain('PostCard')
    await select('n_card')
    expect(inspectorHead()?.textContent).toContain('PostCard')
  })

  it('has a Component section with the component and its Edit button, which opens it on top of the page', async () => {
    await open()
    await select('n_card')
    expect(must('[data-component-instance]').textContent).toContain('PostCard')
    await click(must('[data-component-instance] button'))
    expect(sent('bildr:render').at(-1)?.file.id).toBe(POST_CARD)
  })

  it('offers the variants of the component, not its states (those follow the pointer)', async () => {
    await open()
    await select('n_card')
    expect(await optionLabels(combo('[data-instance-variant]'))).toEqual(['Primary', 'compact'])
  })

  it('picks the variant of an instance, and goes back to the primary with Reset', async () => {
    const { actions } = await open({ instance_set_values: ok() })
    await select('n_card')
    await selectOption(combo('[data-instance-variant]'), 'compact')
    expect(actions.named('instance_set_values').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card', variant: 'var_compact' }])
  })

  it('clears and fills a slot, detaches, and replaces the component', async () => {
    const { actions } = await open({ instance_set_slot: ok({ fillId: null }), instance_detach: ok(), instance_replace: ok() })
    await select('n_card')

    await toggle('[data-instance-slot="prop_actions"]')
    await click(must('[data-instance-detach]'))
    await selectOption(combo('[data-instance-replace]'), 'Tip')

    expect(actions.named('instance_set_slot').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card', slot: 'prop_actions', filled: false }])
    expect(actions.named('instance_detach').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card' }])
    expect(actions.named('instance_replace').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card', component: 'cmp_tip' }])
  })
})

describe('A typo in a number field is refused, never committed as a removal', () => {
  it('keeps the value an instance gives a number property (the field shows the default while it has none)', async () => {
    postCard().properties.push({ id: 'prop_count', name: 'count', kind: 'number', default: 3 })
    const { actions } = await open({ instance_set_values: ok() })
    await select('n_card')

    await typeNumber(propRow('prop_count'), 'abc')
    expect(actions.named('instance_set_values')).toEqual([])
    expect(propInput('prop_count')?.value).toBe('3')

    await typeNumber(propRow('prop_count'), '5')
    expect(actions.named('instance_set_values').map(call => call.input)).toEqual([{ file: 'pg_index', nodeId: 'n_card', values: { prop_count: 5 } }])
  })

  it('does not turn a field of spaces into the number 0 (REL-005): an instance\'s number keeps its value', async () => {
    postCard().properties.push({ id: 'prop_count', name: 'count', kind: 'number', default: 3 })
    const { actions } = await open({ instance_set_values: ok() })
    await select('n_card')

    await typeNumber(propRow('prop_count'), '   ')
    expect(actions.named('instance_set_values')).toEqual([])
    expect(propInput('prop_count')?.value).toBe('3')
  })

  it('keeps a number prop of a node (an Input\'s rows)', async () => {
    const { actions } = await open({ node_update_props: ok() }, 'pg_new_post')
    await select('n_title')

    await typeNumber(propRow('rows'), '4x')
    expect(actions.named('node_update_props')).toEqual([])
    expect(propInput('rows')?.value).toBe('3')

    await typeNumber(propRow('rows'), '4')
    expect(actions.named('node_update_props').map(call => call.input)).toEqual([{ file: 'pg_new_post', nodeId: 'n_title', props: { rows: 4 } }])
  })

  it('keeps the numbers of a transition and the delay of an interaction in the model\'s range: a blank one goes back to its default, a too big one is clamped', async () => {
    postCard().transition = { type: 'ease', duration: 0.2, easing: 'ease-out' }
    postCard().interactions = [{ on: 'click', do: [{ kind: 'setVariant', to: 'var_compact' }] }]
    const { actions } = await openRoot({ component_interaction_update: ok(), component_transition_set: ok() })

    await click(must('[data-transition-row]'))
    await typeInto(must('[data-transition-duration]'), '99')
    await typeInto(must('[data-transition-duration]'), '')
    await click(byLabel('Edit Click → compact'))
    await typeInto(must('[data-interaction-delay]'), '99')
    await typeInto(must('[data-interaction-delay]'), '')

    expect(actions.named('component_transition_set').map(call => call.input)).toEqual([
      { component: POST_CARD, transition: { type: 'ease', duration: 10, easing: 'ease-out' } },
      { component: POST_CARD, transition: { type: 'ease', easing: 'ease-out' } }
    ])
    expect(actions.named('component_interaction_update').map(call => call.input)).toEqual([
      { component: POST_CARD, variant: '', index: 0, delay: 10 },
      { component: POST_CARD, variant: '', index: 0, delay: null }
    ])
  })
})
