/**
 * Components and layouts P0 polish (S1, run by all.mjs): name-first creation
 * in the "New component" / "New layout" dialog (⌥⌘K, the node menu, Assets
 * "+"), with names unique ignoring case (the dialog and the server); the
 * breadcrumb with its navigation stack (a nested component pushes, Esc with
 * nothing selected goes up one level, a crumb goes to its level); the purple
 * context accent (breadcrumb, canvas selection, Publish); instances in
 * purple on a page (Layers, canvas, the inspector's Component tag); and the
 * kit's confirms instead of `confirm()` for deleting a component, a
 * variant, a layout and a page. Shots go to e2e/.shots/components-p0/.
 */
import { action, canvas, check, findNode, openEditor, project, run, shot, until } from './lib.mjs'

const PURPLE = 'rgb(136, 85, 255)'
const BLUE = 'rgb(0, 153, 255)'

const snap = async (page, name) => {
  await page.waitForTimeout(350)
  await shot(page, `components-p0/${name}`)
}

await run('components', async ({ page, errors }) => {
  const native = []
  page.on('dialog', (dialog) => {
    native.push(dialog.message())
    void dialog.dismiss()
  })

  const p = await project('components')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const card = await action('node_insert', {
    projectId: p.id,
    pageId,
    type: 'Card',
    style: { p: '6' },
    children: [{ type: 'Heading', props: { text: 'Latte' } }, { type: 'Button', props: { label: 'Buy' } }]
  })
  const footer = await action('node_insert', { projectId: p.id, pageId, type: 'Text', props: { text: 'Footer text' } })
  const get = () => action('project_get', { projectId: p.id })
  const root = async () => (await get()).pages[0].root

  await openEditor(page, p.id)
  const tooltipOf = async (locator) => {
    await locator.hover()
    const tip = page.getByRole('tooltip')
    await tip.first().waitFor()
    const text = (await tip.first().innerText()).trim()
    await page.mouse.move(700, 800)
    await tip.first().waitFor({ state: 'detached' }).catch(() => {})
    return text
  }
  const createPlus = page.locator('[data-create-component-wrap]')

  // Assets before any component: the empty state says how, and a disabled "+" says why.
  await page.getByRole('tab', { name: 'Assets' }).click()
  check((await page.locator('[data-components-empty]').innerText()).trim() === 'No components yet. Select layers and press ⌥⌘K, or use +.', 'the Components empty state names ⌥⌘K and +')
  const noSelection = await tooltipOf(createPlus)
  check(noSelection.startsWith('Select layers on the page to make a component'), `a disabled Assets "+" explains why (${noSelection})`)
  await page.getByRole('tab', { name: 'Layers' }).click()
  const row = id => page.locator(`[data-layer-id="${id}"]`).first()
  const select = async (id) => {
    await row(id).click()
    await until(async () => await row(id).getAttribute('aria-selected') === 'true')
  }
  const dialog = page.locator('[data-create-dialog]')
  const nameField = page.locator('[data-create-name]')
  const create = page.locator('[data-create-submit]')
  const crumbs = () => page.locator('[data-breadcrumb] [data-crumb]').evaluateAll(els => els.map(el => el.textContent.trim()))
  const bg = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor)
  const color = locator => locator.evaluate(el => getComputedStyle(el).color)
  const canvasAccent = () => canvas(page).locator('[data-canvas-accent]').getAttribute('data-canvas-accent')
  const publish = page.locator('[data-publish]')

  check(await bg(publish) === BLUE, `Publish is the selection blue on a page (${await bg(publish)})`)

  // ⌥⌘K on the Button inside the Card: the dialog opens with the layer's name selected for typing.
  const cardNode = findNode(await root(), n => n.id === card.nodeId)
  const buttonId = cardNode.children[1].id
  await select(buttonId)
  await page.locator('body').press('Control+Alt+k')
  await dialog.waitFor()
  check(await dialog.getAttribute('data-create-dialog') === 'component', '⌥⌘K opens the "New component" dialog')
  check(await page.getByRole('dialog').filter({ hasText: 'New component' }).count() === 1, 'the dialog is titled "New component"')
  const prefill = await until(async () => {
    const state = await nameField.evaluate(el => ({ value: el.value, all: el.selectionStart === 0 && el.selectionEnd === el.value.length, focused: el === document.activeElement }))
    return state.value === 'Button' && state.all && state.focused ? state : null
  })
  check(!!prefill, 'the name is pre-filled from the layer ("Button") and selected for typing')
  await snap(page, 'create-dialog')
  await nameField.press('Enter')
  await page.locator('[data-component-view]').waitFor()
  const buttonDef = await until(async () => (await get()).components.find(c => c.name === 'Button'))
  check(!!buttonDef, 'Enter creates the component "Button"')
  check(JSON.stringify(await crumbs()) === JSON.stringify(['Home', 'Button']), `the new component opens on top of the page: ${(await crumbs()).join(' › ')}`)

  // Esc with nothing selected goes back to the page, with the new instance selected.
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.locator('body').press('Escape')
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  const buttonInstance = findNode(await root(), n => n.type === 'Instance' && n.props.component === buttonDef.id)
  check(!!await until(async () => await row(buttonInstance.id).getAttribute('aria-selected') === 'true'), 'Esc goes back to the page and selects the instance it was made into')
  check(await page.locator('[data-project-menu]').count() === 1, 'the toolbar shows the project menu again on the page')

  // The node menu on the Card: a used name (any case) disables Create and says why.
  await row(card.nodeId).click({ button: 'right' })
  await page.locator('[data-node-menu-search]').waitFor()
  const createItem = page.locator('[role=menu] [role^=menuitem]').filter({ hasText: 'Create component' })
  check((await createItem.innerText()).replace(/\s+/g, '').toLowerCase().endsWith('ctrlaltk'), `the node menu shows the shortcut (${(await createItem.innerText()).replace(/\s+/g, ' ')})`)
  await createItem.click()
  await dialog.waitFor()
  check(await until(async () => (await nameField.inputValue()) === 'Card'), `the Card's dialog is pre-filled "Card" (${await nameField.inputValue()})`)
  await nameField.fill('BUTTON')
  check(await create.isDisabled(), 'Create is disabled for a name already used, ignoring case')
  check(await page.getByRole('alert').filter({ hasText: 'A component named "Button" already exists' }).count() === 1, 'the dialog says the name is taken')
  await nameField.fill('')
  check(await create.isDisabled(), 'Create is disabled while the name is empty')
  await nameField.fill('Card')
  await create.click()
  await page.locator('[data-component-view]').waitFor()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  const cardDef = await until(async () => (await get()).components.find(c => c.name === 'Card'))
  check(!!cardDef, 'Create makes "Card" from the node menu')

  // Inside Card: Edit on the nested Button instance pushes onto the breadcrumb.
  const nested = findNode(cardDef.root, n => n.type === 'Instance')
  await select(nested.id)
  await page.locator('[data-component-instance]').getByRole('button', { name: 'Edit' }).click()
  check(!!await until(async () => JSON.stringify(await crumbs()) === JSON.stringify(['Home', 'Card', 'Button'])), `editing a nested component pushes it: ${(await crumbs()).join(' › ')}`)
  check(await until(async () => await bg(publish) === PURPLE), `Publish turns purple in a component (${await bg(publish)})`)
  check(await color(page.locator('[data-breadcrumb] [aria-current]')) === PURPLE, 'the current crumb is purple')
  const buttonRoot = (await get()).components.find(c => c.id === buttonDef.id).root
  await select(buttonRoot.id)
  check(await until(async () => (await canvasAccent()) === '#85f'), 'the canvas selection is purple in a component')
  check(await bg(row(buttonRoot.id)) === PURPLE, 'the selected Layers row is purple in a component')
  await snap(page, 'breadcrumb')

  // Esc selects the parent first (nothing, at the root), then goes up one level: back to Card, its instance selected.
  await page.locator('body').press('Escape')
  await until(async () => await row(buttonRoot.id).getAttribute('aria-selected') === 'false')
  await page.locator('body').press('Escape')
  check(!!await until(async () => JSON.stringify(await crumbs()) === JSON.stringify(['Home', 'Card'])), `Esc with nothing selected goes up one level: ${(await crumbs()).join(' › ')}`)
  check(!!await until(async () => await row(nested.id).getAttribute('aria-selected') === 'true'), 'going up selects the instance the component was opened from')

  // A crumb goes to its level.
  await page.locator('[data-breadcrumb] [data-crumb="page"]').click()
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  check(true, 'the Home crumb goes back to the page')

  // Instances on a page: purple in Layers, on the canvas and in the inspector head.
  const cardInstance = findNode(await root(), n => n.type === 'Instance' && n.props.component === cardDef.id)
  await select(cardInstance.id)
  check(await row(cardInstance.id).getAttribute('data-layer-kind') === 'instance', 'the instance row is marked as an instance')
  check(await bg(row(cardInstance.id)) === PURPLE, `a selected instance row is a purple pill (${await bg(row(cardInstance.id))})`)
  check(await until(async () => (await canvasAccent()) === '#85f'), 'selecting an instance on a page draws the canvas selection in purple')
  check(await page.locator('[data-inspector-component-tag]').count() === 1, 'the inspector head tags the instance "Component"')
  await snap(page, 'layers-instance')
  await select(footer.nodeId)
  check(await until(async () => (await canvasAccent()) === '#09f'), 'another node on a page is selected in blue')
  check(await color(row(cardInstance.id).locator('.iconify, svg, span[class*="i-lucide"]').first()) === PURPLE, 'an unselected instance row keeps a purple component icon')

  // Assets: purple component and layout icons, the empty Layouts copy, a disabled "+" that says why.
  await page.getByRole('tab', { name: 'Assets' }).click()
  await page.locator('[data-assets]').waitFor()
  check((await page.locator('[data-layouts-empty]').innerText()).trim() === 'No layouts yet. A layout frames pages with a shared nav or footer. Use + to create one.', 'the Layouts empty state says what a layout is and how to make one')
  const componentIcon = page.locator(`[data-component-id="${cardDef.id}"] button[draggable] span`).first()
  check(await color(componentIcon) === PURPLE, `Assets component icons are the purple token (${await color(componentIcon)})`)
  await snap(page, 'assets')

  // New layout from Assets "+": the dialog, then the layout view with its purple breadcrumb.
  await page.getByRole('button', { name: 'New layout' }).click()
  await dialog.waitFor()
  check(await page.getByRole('dialog').filter({ hasText: 'New layout' }).count() === 1, 'Assets "+" opens the "New layout" dialog')
  await nameField.fill('Site layout')
  await nameField.press('Enter')
  await page.locator('[data-layout-view]').waitFor()
  check(JSON.stringify(await crumbs()) === JSON.stringify(['Home', 'Site layout']), `the new layout opens: ${(await crumbs()).join(' › ')}`)
  check(await until(async () => await bg(publish) === PURPLE), `Publish is purple in a layout too (${await bg(publish)})`)
  await snap(page, 'layout-breadcrumb')
  await page.getByRole('button', { name: 'Leave the layout view' }).click()
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'New layout' }).click()
  await dialog.waitFor()
  await nameField.fill('site LAYOUT')
  check(await create.isDisabled(), 'a used layout name (any case) disables Create')
  await nameField.press('Escape')
  await dialog.waitFor({ state: 'detached' })

  // The server refuses duplicates too, and still auto-names for agents.
  let refused = ''
  try {
    await action('component_rename', { projectId: p.id, componentId: buttonDef.id, name: 'card' })
  } catch (error) {
    refused = error.message
  }
  check(/→ 4\d\d: A component named "Card" already exists/.test(refused), `component_rename refuses a used name (${refused})`)

  // Kit confirms: deleting a variant.
  await action('component_variant_add', { projectId: p.id, componentId: buttonDef.id, name: 'Flat' })
  await page.locator(`[data-component-id="${buttonDef.id}"] button[draggable]`).click()
  await page.locator('[data-component-view]').waitFor()
  const inside = await tooltipOf(createPlus)
  check(inside.startsWith('Leave the component to create another'), `inside a component, Assets "+" says "${inside}"`)
  const flatId = await until(async () => (await get()).components.find(c => c.id === buttonDef.id).variants[0]?.id)
  await page.getByRole('tab', { name: 'Layers' }).click()
  await select(buttonRoot.id)
  const flatRow = page.locator(`[data-variant-row="${flatId}"]`)
  await flatRow.hover()
  await flatRow.getByLabel('Flat variant actions').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Delete' }).click()
  const confirm = page.locator('[data-confirm]')
  await confirm.waitFor()
  check((await confirm.innerText()).includes('Instances using it fall back to Primary'), 'deleting a variant asks first: "Instances using it fall back to Primary"')
  await page.locator('[data-confirm-ok]').click()
  check(!!await until(async () => !(await get()).components.find(c => c.id === buttonDef.id).variants.length), 'the confirm deletes the variant')
  await page.getByRole('button', { name: 'Leave the component view' }).click()
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  await page.getByRole('tab', { name: 'Assets' }).click()

  // Deleting a component lists its usages; Cancel keeps it.
  const cardRow = page.locator(`[data-component-id="${cardDef.id}"]`)
  await cardRow.hover()
  await cardRow.getByLabel('Component actions').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Delete' }).click()
  await confirm.waitFor()
  check((await page.locator('[data-confirm-items]').innerText()).includes('page "Home"'), `the component delete confirm lists where it is used (${(await page.locator('[data-confirm-items]').innerText()).trim()})`)
  await snap(page, 'delete-confirm')
  await page.locator('[data-confirm-cancel]').click()
  await confirm.waitFor({ state: 'detached' })
  check((await get()).components.some(c => c.id === cardDef.id), 'Cancel keeps the component')

  // Deleting a layout and a page.
  const layoutId = (await get()).layouts[0].id
  const layoutRow = page.locator(`[data-layout-id="${layoutId}"]`)
  await layoutRow.hover()
  await layoutRow.getByLabel('Layout actions').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Delete' }).click()
  await confirm.waitFor()
  await page.locator('[data-confirm-ok]').click()
  check(!!await until(async () => !(await get()).layouts.length), 'the layout delete confirm deletes the layout')

  const about = await action('page_add', { projectId: p.id, name: 'About' })
  await page.getByRole('tab', { name: 'Pages' }).click()
  const pageRow = page.locator(`[data-page-id="${about.pageId}"]`)
  await pageRow.waitFor()
  await pageRow.hover()
  await pageRow.getByLabel('Page actions').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Delete' }).click()
  await confirm.waitFor()
  check((await page.getByRole('dialog').innerText()).includes('Delete "About"?'), 'deleting a page asks in the kit dialog')
  await page.locator('[data-confirm-ok]').click()
  check(!!await until(async () => !(await get()).pages.some(pg => pg.id === about.pageId)), 'the page delete confirm deletes the page')

  check(native.length === 0, `no native confirm() dialogs${native.length ? `: ${native.join(' | ')}` : ''}`)
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
