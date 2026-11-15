import { describe, expect, it, vi } from 'vitest'
import { byTestId, click, Failure, settle } from '../helpers.ts'
import { boot, find, ok, openIn, postCard, setupHarness, world } from './boot.ts'
import { byLabel, menuItem, open as openDesign, select, sidebarTab } from '../design/harness.ts'
import { interactionKey, parseInteractionKey } from '../../src/editor/useEditor.ts'

/**
 * Components, variants, interactions and layouts through the adapter (U2, S3): the
 * hosted operations, each one module action with the module's input (`component`,
 * `variant`, `index`: the model has no interaction ids, so an interaction is
 * `<variant>:<index>`).
 */

setupHarness()

const inputs = (actions: Awaited<ReturnType<typeof boot>>['actions'], name: string) => actions.named(name).map(call => call.input)

describe('variants', () => {
  it('selectVariant shows a variant of the component being edited and ignores unknown ones', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    editor.selectVariant('var_compact')
    expect(editor.variantId).toBe('var_compact')
    expect(editor.variant?.name).toBe('compact')
    expect(design.variantId.value).toBe('var_compact')
    editor.selectVariant('var_missing')
    expect(editor.variantId).toBeNull()
  })

  it('selected is the node as the variant shows it', async () => {
    const { editor } = await boot({}, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    editor.selectVariant('var_compact')
    editor.selectedId = 'n_card'
    expect(editor.selected?.style).toMatchObject({ gap: '1', p: '3' })
  })

  it('addVariant names it Variant N and makes it the active one', async () => {
    const { editor, actions } = await boot({ component_variant_add: ok({ variantId: 'var_variant3' }) }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    await editor.addVariant()
    expect(inputs(actions, 'component_variant_add')).toEqual([{ component: 'cmp_post_card', name: 'Variant 3' }])
  })

  it('addState adds a hover or pressed state of a base variant (the primary is "")', async () => {
    const { editor, actions } = await boot({ component_state_add: ok({ variantId: 'var_s' }) }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    await editor.addState(null, 'pressed')
    await editor.addState('var_compact', 'hover')
    expect(inputs(actions, 'component_state_add')).toEqual([
      { component: 'cmp_post_card', baseVariant: '', kind: 'pressed' },
      { component: 'cmp_post_card', baseVariant: 'var_compact', kind: 'hover' }
    ])
  })

  it('renameVariant skips a blank or unchanged name', async () => {
    const { editor, actions } = await boot({ component_variant_rename: ok() }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    await editor.renameVariant('var_compact', ' tight ')
    await editor.renameVariant('var_compact', 'compact')
    await editor.renameVariant('var_compact', ' ')
    expect(inputs(actions, 'component_variant_rename')).toEqual([{ component: 'cmp_post_card', variant: 'var_compact', name: 'tight' }])
  })

  it('edits in a variant are overrides: one node, or a batch in one action', async () => {
    const { editor, actions } = await boot({ component_variant_set_override: ok() }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    editor.selectVariant('var_compact')
    await editor.setOverride('n_card', { style: { gap: null } })
    await editor.updateStyles([{ nodeId: 'n_card', style: { p: '2' } }, { nodeId: 'n_cover', style: { rounded: 'lg' } }])
    await editor.setOverride('n_card', {})
    expect(inputs(actions, 'component_variant_set_override')).toEqual([
      { component: 'cmp_post_card', variant: 'var_compact', nodeId: 'n_card', style: { gap: null } },
      { component: 'cmp_post_card', variant: 'var_compact', overrides: [{ nodeId: 'n_card', style: { p: '2' } }, { nodeId: 'n_cover', style: { rounded: 'lg' } }] }
    ])
  })

  it('updateStyle on several nodes while a variant is active is one batched override, like updateStyles', async () => {
    const { editor, actions } = await boot({ component_variant_set_override: ok() }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    editor.selectVariant('var_compact')
    await editor.updateStyle(['n_card', 'n_cover'], { p: '2' })
    expect(inputs(actions, 'component_variant_set_override')).toEqual([
      { component: 'cmp_post_card', variant: 'var_compact', overrides: [{ nodeId: 'n_card', style: { p: '2' } }, { nodeId: 'n_cover', style: { p: '2' } }] }
    ])
  })

  it('updateStyle on several nodes in a variant resets an override and unsets a primary token, per node, in the same batch', async () => {
    const { editor, actions } = await boot({ component_variant_set_override: ok() }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    editor.selectVariant('var_compact')
    const cover = find(postCard().root, 'n_cover')!
    cover.style = { ...cover.style, rounded: 'md' }
    await editor.reload()
    await settle()
    await editor.updateStyle(['n_card', 'n_cover'], { gap: null, rounded: null })
    expect(inputs(actions, 'component_variant_set_override')).toEqual([
      { component: 'cmp_post_card', variant: 'var_compact', overrides: [{ nodeId: 'n_card', style: { gap: null } }, { nodeId: 'n_cover', unset: ['rounded'] }] }
    ])
  })

  it('the variant board follows the remembered choice, else two variants', async () => {
    const { editor } = await boot({}, 'pg_index')
    expect(editor.variantBoard).toBe(false)
    await openIn(editor, 'component', 'cmp_post_card')
    expect(editor.variantBoard).toBe(true)
    editor.setVariantBoard(false)
    expect(editor.variantBoard).toBe(false)
  })
})

describe('interactions and transitions', () => {
  it('an interaction is its variant and index; add selects it', async () => {
    expect(parseInteractionKey(interactionKey(null, 2))).toEqual({ variantId: '', index: 2 })
    expect(parseInteractionKey(interactionKey('var_a', 0))).toEqual({ variantId: 'var_a', index: 0 })
    const { editor, actions } = await boot({ component_interaction_add: ok({ index: 0 }) }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    const key = await editor.addInteraction('var_compact', 'click', '', 0.5)
    expect(inputs(actions, 'component_interaction_add')).toEqual([{ component: 'cmp_post_card', variant: 'var_compact', on: 'click', to: '', delay: 0.5 }])
    expect(key).toBe('var_compact:0')
    expect(editor.interactionId).toBe('var_compact:0')
  })

  it('update and remove address the interaction by variant and index', async () => {
    const { editor, actions } = await boot({ component_interaction_update: ok(), component_interaction_remove: ok() }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    editor.interactionId = ':1'
    await editor.updateInteraction(':1', { on: 'mouseenter', to: 'var_hovered', delay: null })
    await editor.removeInteraction(':1')
    expect(inputs(actions, 'component_interaction_update')).toEqual([{ component: 'cmp_post_card', variant: '', index: 1, on: 'mouseenter', to: 'var_hovered', delay: null }])
    expect(inputs(actions, 'component_interaction_remove')).toEqual([{ component: 'cmp_post_card', variant: '', index: 1 }])
    expect(editor.interactionId).toBeNull()
  })

  it('a selected interaction never points at another one after a row of its owner goes or comes', async () => {
    postCard().interactions = [
      { on: 'mouseenter', do: [{ kind: 'setVariant', to: 'var_compact' }] },
      { on: 'click', do: [{ kind: 'setVariant', to: 'var_compact' }] },
      { on: 'appear', do: [{ kind: 'setVariant', to: '' }] }
    ]
    const { editor } = await boot({
      component_interaction_remove: (input) => {
        postCard().interactions!.splice(Number(input.index), 1)
        return { changed: [] }
      }
    }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    editor.interactionId = ':1'
    await editor.removeInteraction(':0')
    await settle()
    expect(editor.interactionId).toBeNull()

    // An outside change (undo, a model event) that adds a row ahead of the selection does the same.
    editor.interactionId = ':0'
    postCard().interactions!.unshift({ on: 'appear', do: [{ kind: 'setVariant', to: '' }] })
    await editor.reload()
    await settle()
    expect(editor.interactionId).toBeNull()

    // An edit that keeps the rows keeps the selection.
    editor.interactionId = ':1'
    await editor.reload()
    await settle()
    expect(editor.interactionId).toBe(':1')
  })

  it('setTransition sets the component\'s own or a variant\'s, null clears it', async () => {
    const { editor, actions } = await boot({ component_transition_set: ok() }, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    await editor.setTransition(null, { type: 'ease', duration: 0.2, easing: 'ease-out' })
    await editor.setTransition('var_compact', null)
    expect(inputs(actions, 'component_transition_set')).toEqual([
      { component: 'cmp_post_card', transition: { type: 'ease', duration: 0.2, easing: 'ease-out' } },
      { component: 'cmp_post_card', variant: 'var_compact', transition: null }
    ])
  })

  it('previewInteractions opens the app on a page showing the component, or says to place one', async () => {
    const { editor, toasts } = await boot({}, 'pg_index')
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    editor.previewInteractions('cmp_post_card')
    editor.previewInteractions('cmp_tip')
    editor.previewInteractions('cmp_missing')
    expect(open.mock.calls).toEqual([['/', '_blank'], ['/posts/new', '_blank']])
    open.mockRestore()
    expect(toasts.map(toast => toast.title)).toEqual(['Nothing to preview yet'])
  })
})

describe('creating and opening components and layouts', () => {
  it('createComponent asks for the name, then makes it from the selected siblings and opens it nested', async () => {
    const { editor, actions } = await boot({ component_create: ok({ componentId: 'cmp_head', nodeId: 'n_inst' }) }, 'pg_index')
    editor.selectedId = 'n_head'
    editor.createComponent()
    expect(editor.createRequest).toMatchObject({ kind: 'component', nodeIds: ['n_head'] })
    expect(await editor.confirmCreate(' Head ')).toBe(true)
    expect(inputs(actions, 'component_create')).toEqual([{ file: 'pg_index', nodeId: 'n_head', name: 'Head' }])
    expect(editor.createRequest).toBeNull()
  })

  it('creating a layout from the top-level layers selected on a page without one', async () => {
    delete world.model.modules.blog!.pages.find(page => page.id === 'pg_index')!.layout
    const { editor, actions } = await boot({ layout_create_from_selection: ok({ layoutId: 'lay_main', slotNodeId: 'n', filePath: 'x' }) }, 'pg_index')
    expect(editor.layoutFromSelection).toEqual({ reason: 'Select the layers to share, such as a nav and a footer' })
    editor.selectedIds = ['n_head', 'n_list']
    expect(editor.layoutFromSelection).toEqual({ nodeIds: ['n_head', 'n_list'] })
    editor.createLayoutFromSelection()
    expect(editor.createRequest).toMatchObject({ kind: 'layout', name: 'Layout', nodeIds: ['n_head', 'n_list'] })
    await editor.confirmCreate('site')
    expect(inputs(actions, 'layout_create_from_selection')).toEqual([{ page: 'pg_index', nodeIds: ['n_head', 'n_list'], name: 'site' }])
    expect(editor.layoutId).toBe('lay_main')
    expect(editor.selectedIds).toEqual([])
  })

  it('createLayout makes an empty layout and opens it', async () => {
    const { editor, actions } = await boot({ layout_create: ok({ layoutId: 'lay_main', slotNodeId: 'n', filePath: 'x' }) }, 'pg_index')
    editor.createLayout()
    expect(editor.createRequest).toMatchObject({ kind: 'layout', nodeIds: [] })
    await editor.confirmCreate('docs')
    expect(inputs(actions, 'layout_create')).toEqual([{ name: 'docs' }])
    expect(editor.layoutId).toBe('lay_main')
  })

  it('a refused create keeps the dialog open', async () => {
    const { editor } = await boot({ layout_create: () => ({ ok: false }) }, 'pg_index')
    editor.createLayout()
    expect(await editor.confirmCreate('docs')).toBe(false)
    expect(editor.createRequest).not.toBeNull()
  })

  it('detachInstance and replaceInstance act on an instance of the tree being edited', async () => {
    const { editor, actions } = await boot({ instance_detach: ok({ nodeId: 'n_plain' }), instance_replace: ok() }, 'pg_index')
    await editor.detachInstance('n_head')
    await editor.detachInstance('n_card')
    expect(inputs(actions, 'instance_detach')).toEqual([{ file: 'pg_index', nodeId: 'n_card' }])
    expect(editor.selectedId).toBe('n_plain')
    await editor.replaceInstance('n_card', 'cmp_tip')
    await editor.replaceInstance('n_card', 'cmp_tip', { all: true })
    expect(inputs(actions, 'instance_replace')).toEqual([
      { file: 'pg_index', nodeId: 'n_card', component: 'cmp_tip' },
      { file: 'pg_index', nodeId: 'n_card', component: 'cmp_tip', all: true }
    ])
  })

  it('openProperties opens the modal of the component or layout being edited', async () => {
    const { editor } = await boot({}, 'pg_index')
    editor.openProperties()
    expect(editor.propertiesRequest).toBeNull()
    await openIn(editor, 'component', 'cmp_post_card')
    editor.openProperties('prop_post', { focusName: true })
    expect(editor.propertiesRequest).toEqual({ kind: 'component', id: 'cmp_post_card', propertyId: 'prop_post', focusName: true })
  })

  it('a deleted component leaves its level of the breadcrumb', async () => {
    const { editor, design } = await boot({}, 'pg_index')
    await openIn(editor, 'component', 'cmp_post_card')
    expect(editor.editStack).toHaveLength(1)
    world.model.modules.blog!.components = world.model.modules.blog!.components.filter(component => component.id !== 'cmp_post_card')
    await design.refresh()
    await settle()
    expect(editor.editStack).toEqual([])
    expect(editor.componentId).toBeNull()
  })
})

describe('pages and the project', () => {
  it('addPage creates the page and shows it', async () => {
    const { editor, actions } = await boot({ page_create: ok({ pageId: 'pg_new_post', filePath: 'x', nodeId: 'n' }) }, 'pg_index')
    expect(await editor.addPage('About')).toBe(true)
    expect(inputs(actions, 'page_create')).toEqual([{ name: 'About' }])
    expect(editor.pageId).toBe('pg_new_post')
  })

  it('renameProject is project_update, and the unchanged name is nothing', async () => {
    const { editor, actions, design } = await boot({ project_update: ok() }, 'pg_index')
    expect(await editor.renameProject(design.model.value!.project.name)).toBe(false)
    expect(await editor.renameProject(' Journal ')).toBe(true)
    expect(inputs(actions, 'project_update')).toEqual([{ name: 'Journal' }])
  })

  it('run and runOnPage are the store\'s edit: a refusal is the store\'s error', async () => {
    const { editor, actions } = await boot({ page_update: ok(), node_rename: ok() }, 'pg_index')
    await editor.run('page_update', { page: 'pg_index', path: '/home' })
    await editor.runOnPage('node_rename', { nodeId: 'n_head', name: 'x' })
    expect(inputs(actions, 'page_update')).toEqual([{ page: 'pg_index', path: '/home' }])
    expect(inputs(actions, 'node_rename')).toEqual([{ file: 'pg_index', nodeId: 'n_head', name: 'x' }])
  })
})

describe('the Interactions section', () => {
  it('closes the open popover when a row of its list goes, and Delete never reaches another interaction', async () => {
    postCard().interactions = [
      { on: 'mouseenter', do: [{ kind: 'setVariant', to: 'var_compact' }] },
      { on: 'click', do: [{ kind: 'setVariant', to: 'var_compact' }] },
      { on: 'appear', do: [{ kind: 'setVariant', to: '' }] }
    ]
    const { actions } = await openDesign({
      component_interaction_remove: (input) => {
        postCard().interactions!.splice(Number(input.index), 1)
        return { changed: [] }
      }
    }, 'cmp_post_card')
    await select('n_card')
    await click(byLabel('Edit Click → compact'))
    expect(document.body.querySelector('[data-interaction-remove]')).not.toBeNull()

    await click(byLabel('Remove Mouse enter → compact'))
    expect(document.body.querySelector('[data-interaction-remove]')).toBeNull()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    await settle()
    expect(actions.named('component_interaction_remove').map(call => call.input)).toEqual([{ component: 'cmp_post_card', variant: '', index: 0 }])
  })
})

describe('deleting a component', () => {
  const IN_USE = 'Component "Tip" is used by 1 instance: pg_about (n_tip). Delete it first'
  const del = async (id: string) => {
    await sidebarTab('Assets')
    await menuItem(document.body.querySelector(`[data-component-id="${id}"] [aria-label="Component actions"]`), 'Delete')
  }
  const confirmOk = () => click(document.body.querySelector<HTMLElement>('[data-confirm-ok]'))
  const confirmText = () => document.body.querySelector('[data-confirm]')?.textContent ?? null

  it('sends the delete unforced; only the module\'s "in use" refusal offers force, showing that refusal', async () => {
    const { actions } = await openDesign({
      component_delete: input => input.force ? { changed: [], deletedInstances: ['pg_about (n_tip)'] } : new Failure(422, 'invalid', IN_USE)
    })
    await del('cmp_tip')
    await confirmOk()
    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: 'cmp_tip' }])
    expect(confirmText()).toContain(IN_USE)

    await confirmOk()
    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: 'cmp_tip' }, { component: 'cmp_tip', force: true }])
  })

  it('never forces on the client\'s own usage list: a component it lists as used but the module deletes goes without force', async () => {
    const { actions } = await openDesign({ component_delete: () => ({ changed: [], deletedInstances: [] }) })
    await del('cmp_tip')
    await confirmOk()
    expect(actions.named('component_delete').map(call => call.input)).toEqual([{ component: 'cmp_tip' }])
    expect(confirmText()).toBeNull()
  })

  it('leaves the refusal in the editor when the user declines to force it', async () => {
    const { actions } = await openDesign({ component_delete: () => new Failure(422, 'invalid', IN_USE) })
    await del('cmp_tip')
    await confirmOk()
    await click(document.body.querySelector<HTMLElement>('[data-confirm-cancel]'))
    expect(byTestId('design-error')?.textContent?.trim()).toBe(IN_USE)
    expect(actions.named('component_delete')).toHaveLength(1)
  })

  it('offers no force for a refusal that is not "in use"', async () => {
    const { actions } = await openDesign({ component_delete: () => new Failure(403, 'forbidden', 'Not allowed') })
    await del('cmp_tip')
    await confirmOk()
    expect(confirmText()).toBeNull()
    expect(actions.named('component_delete')).toHaveLength(1)
  })
})
