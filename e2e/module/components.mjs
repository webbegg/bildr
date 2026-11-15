/**
 * Components and layouts P0 polish on the module editor (condensed port of e2e/components.mjs, S1):
 * name-first creation in the "New component" / "New layout" dialog (⌥⌘K, the node menu), with names
 * unique ignoring case (the dialog and the module); the breadcrumb with its navigation stack (Esc with
 * nothing selected goes up a level, a crumb goes to its level); the purple context accent (the editor's
 * `data-editor-context`, the canvas accent, the instance's Component section); and the kit's confirm instead
 * of `confirm()` for deleting a page. Each creation or deletion is checked in the `.bildr` files. Shots go to e2e/module/.shots/components-p0/.
 *
 * Dropped or condensed (the hosted script is 617 lines of the hosted publish and project menus):
 * - the Assets "+" tooltips and empty-state copy, the Publish button colours (`[data-publish]`) and the
 *   project menu (`[data-project-menu]`): no publish or project list here; the accent is checked on the
 *   canvas and the editor root instead;
 * - nested-component breadcrumb stacks of three levels, and the component, variant and layout delete
 *   confirms (the unforced-first flow of U8): one level is checked here, and those confirms are covered
 *   by test/design/components.test.ts and test/editor/components.test.ts.
 */
import { action, bildr, bildrFiles, check, findNode, lastStep, openEditor, run, scene, shot, until } from './lib.mjs'

const snap = async (page, name) => {
  await page.waitForTimeout(350)
  await shot(page, `components-p0/${name}`)
}

await run('components', async ({ page, errors }) => {
  const s = await scene('components')
  const card = await s.ins({ type: 'Card', style: { p: '6' }, children: [{ type: 'Heading', props: { text: 'Latte' } }, { type: 'Button', props: { text: 'Buy' } }] })
  await s.ins({ type: 'Text', props: { text: 'Footer text' } })
  const buttonId = s.node(card).children[1].id

  await openEditor(page, s.file)
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
  const accent = () => canvasAccent(page)
  const context = () => page.locator('[data-testid="design"]').getAttribute('data-editor-context')
  const componentFiles = () => bildrFiles('modules/blog/components/').map(path => bildr(path)).filter(def => def.name !== 'PostCard' && def.name !== 'Tip')

  check(await context() === 'page' && await accent() === '#09f', `on a page the context is "page" and the canvas accent is the selection blue (${await context()}, ${await accent()})`)

  // ⌥⌘K on the Button inside the Card: the dialog opens with the layer's name selected for typing.
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
  const buttonDef = await until(() => componentFiles().find(def => def.name === 'Button'))
  check(!!buttonDef, 'Enter writes the component "Button" (.bildr/modules/blog/components)')
  check((await crumbs()).at(-1) === 'Button', `the new component opens on top of the page: ${(await crumbs()).join(' › ')}`)
  check(await context() === 'component', 'the editor context is "component" (the purple accent)')
  check(await until(async () => (await accent()) === '#85f'), `the canvas accent is the context purple (${await accent()})`)
  await snap(page, 'component-view')

  // Esc with nothing selected goes back to the page, with the new instance selected.
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.locator('body').press('Escape')
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  const buttonInstance = findNode(s.doc().root, n => n.type === 'Instance' && n.props?.component === buttonDef.id)
  check(!!buttonInstance && !!await until(async () => await row(buttonInstance.id).getAttribute('aria-selected') === 'true'), 'Esc goes back to the page and selects the instance it was made into')
  check(await context() === 'page', 'back on the page the context is "page" again')

  // The node menu on the Card: a used name (any case) disables Create and says why.
  await row(card).click({ button: 'right' })
  await page.locator('[data-node-menu-search]').waitFor()
  const createItem = page.locator('[role=menu] [role^=menuitem]').filter({ hasText: 'Create component' })
  check((await createItem.innerText()).replace(/\s+/g, '').toLowerCase().endsWith('ctrlaltk'), `the node menu shows the shortcut (${(await createItem.innerText()).replace(/\s+/g, ' ')})`)
  await createItem.click()
  await dialog.waitFor()
  check(await until(async () => (await nameField.inputValue()) === 'Card'), `the Card's dialog is pre-filled "Card" (${await nameField.inputValue()})`)
  await nameField.fill('BUTTON')
  check(await create.isDisabled(), 'Create is disabled for a name already used, ignoring case')
  check(await page.getByRole('alert').filter({ hasText: 'A component named "Button" already exists' }).count() === 1, 'the dialog says the name is taken')
  const refused = await action('component_create', { file: s.file, nodeId: card, name: 'button' }).then(() => null, e => e.message)
  check(/already|exists|unique/i.test(refused ?? ''), `the module refuses the same name too (${refused})`)
  await nameField.fill('')
  check(await create.isDisabled(), 'Create is disabled while the name is empty')
  await nameField.fill('Card')
  await create.click()
  await page.locator('[data-component-view]').waitFor()
  const cardDef = await until(() => componentFiles().find(def => def.name === 'Card'))
  check(!!cardDef, 'Create writes the component "Card"')
  check(await lastStep() === 'component_create', `it is one undo step (${await lastStep()})`)
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.locator('body').press('Escape')
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })

  // The instance on the page is purple (Layers) and its inspector says it is a Component.
  const cardInstance = findNode(s.doc().root, n => n.type === 'Instance' && n.props?.component === cardDef.id)
  await select(cardInstance.id)
  check(await page.locator('[data-component-instance]').count() === 1, 'an instance shows the Component section in the inspector')
  await snap(page, 'instance-selected')

  // A crumb goes to its level: Edit the Card component, then click the page crumb.
  await page.locator('[data-component-instance]').getByRole('button', { name: 'Edit' }).click()
  await page.locator('[data-component-view]').waitFor()
  check((await crumbs()).length === 2, `Edit opens the definition (${(await crumbs()).join(' › ')})`)
  await page.locator('[data-breadcrumb] [data-crumb]').first().click()
  await page.locator('[data-breadcrumb]').waitFor({ state: 'detached' })
  check(true, 'the page crumb goes back to the page')

  // The kit's confirm for deleting a page (no browser confirm()); the component, variant and layout confirms
  // are checked in the unit tests of their panels (components.test.ts), not repeated here.
  page.on('dialog', () => check(false, 'no browser confirm() is used'))

  // Delete the page by its row menu: the confirm, Cancel, then OK.
  const extra = await scene('components-extra')
  await page.getByRole('tab', { name: 'Pages' }).click()
  const pageRow = page.locator(`[data-page-id="${extra.pageId}"]`)
  await pageRow.hover()
  await pageRow.getByLabel('Page actions').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Delete' }).click()
  await page.locator('[data-confirm]').waitFor()
  await page.locator('[data-confirm-cancel]').click()
  await page.locator('[data-confirm]').waitFor({ state: 'detached' })
  check(!!bildr(extra.filePath), 'Cancel keeps the page file')
  await pageRow.hover()
  await pageRow.getByLabel('Page actions').click()
  await page.locator('[role^=menuitem]').filter({ hasText: 'Delete' }).click()
  await page.locator('[data-confirm]').waitFor()
  await page.locator('[data-confirm-ok]').click()
  check(!!await until(() => bildr(extra.filePath) === undefined), 'OK deletes the page file')

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})

/** The canvas accent colour the active frame draws selections in. */
function canvasAccent(page) {
  return page.frameLocator('iframe[title="Canvas"]').locator('[data-canvas-accent]').getAttribute('data-canvas-accent')
}
