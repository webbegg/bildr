/**
 * Component states and interactions (S3.4 runtime, run by all.mjs). Through
 * actions only (the editor UI comes later): a component with a Hover state
 * that changes its background, a click from Primary to "On", and a mouse
 * leave from On back to Primary, with an ease transition. In the draft
 * preview and in the published app, hovering changes the computed
 * background through a CSS transition, clicking (or Enter) switches to On,
 * and leaving goes back; with reduced motion the change is instant. The
 * editor canvas stays static. Shots go to e2e/.shots/interactions/.
 *
 * Then the editor UI (S3.4 "Editor UI", `interactions-ui`): on the variant
 * board, a Hover state added from its "+ Hover / Pressed" tile and its
 * background edited, a ⚡ drag from Primary to "On" making a click
 * interaction (set through its popover), its arrow, a Spring transition from
 * the inspector's Transition popover, the preview running both (computed
 * styles), and × removing the interaction; each step undoes and redoes.
 * Shots go to e2e/.shots/components-p2/.
 *
 * Then the runtime fixes (`interactions-runtime`), in the preview and the
 * published app: an interactive instance in a layout hovers; a Pressed
 * state's own click and a Hover state's own mouse leave fire; a clickable
 * instance nested in another clickable one gets no role=button of its own
 * and its click does not switch the outer one; a clickable component whose
 * root is a Button instance gets no role=button.
 */
import { action, BASE, canvas, check, openEditor, project, run, shot, until } from './lib.mjs'

const RED = 'rgb(255, 0, 0)'
const BLUE = 'rgb(0, 0, 255)'
const GREEN = 'rgb(0, 255, 0)'

await run('interactions', async ({ page, context, errors }) => {
  const p = await project('interactions')
  const { pages } = await action('project_get', { projectId: p.id })
  const pageId = pages[0].id
  const box = await action('node_insert', { projectId: p.id, pageId, type: 'Container', style: { bg: '#ff0000', p: '8' }, children: [{ type: 'Text', props: { text: 'Toggle' } }] })
  const { componentId, nodeId } = await action('component_create', { projectId: p.id, pageId, nodeId: box.nodeId, name: 'Toggle' })
  const rootId = (await action('project_get', { projectId: p.id })).components[0].root.id
  const { variantId: hoverId } = await action('component_state_add', { projectId: p.id, componentId, baseVariantId: '', kind: 'hover' })
  await action('component_variant_set_override', { projectId: p.id, componentId, variantId: hoverId, nodeId: rootId, style: { bg: '#0000ff' } })
  const { variantId: onId } = await action('component_variant_add', { projectId: p.id, componentId, name: 'On' })
  await action('component_variant_set_override', { projectId: p.id, componentId, variantId: onId, nodeId: rootId, style: { bg: '#00ff00' } })
  await action('component_interaction_add', { projectId: p.id, componentId, on: 'click', to: onId })
  await action('component_interaction_add', { projectId: p.id, componentId, variantId: onId, on: 'mouseleave', to: '' })
  await action('component_transition_set', { projectId: p.id, componentId, transition: { type: 'ease', duration: 0.6, easing: 'linear' } })
  const def = (await action('project_get', { projectId: p.id })).components[0]
  check(def.variants.find(v => v.id === hoverId)?.name === 'Primary · Hover' && def.interactions?.length === 1, 'the actions make a "Primary · Hover" state and a click interaction')

  /** The instance's rendered root on `target` (a page or a frame). */
  const rootOf = target => target.locator(`[data-bildr-id="${nodeId}"]`).first()
  const bg = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor)
  const transitions = locator => locator.evaluate(el => el.getAnimations().filter(a => a.transitionProperty).map(a => a.transitionProperty))
  const away = () => page.mouse.move(700, 820)

  /** Hover, click, Enter and leave on the instance in `url`; `label` names the place in messages. */
  async function exercise(url, label) {
    await page.goto(url)
    const root = rootOf(page)
    await root.waitFor()
    // The pointer may still be where the last step left it: move off and let any hover settle.
    await away()
    await page.waitForTimeout(800)
    check(await bg(root) === RED, `${label}: the instance starts in Primary (red)`)
    check(await root.getAttribute('role') === 'button' && await root.getAttribute('tabindex') === '0', `${label}: a click interaction on a Container root makes it role=button, tabindex=0`)

    await root.hover()
    await page.waitForTimeout(120)
    const running = await transitions(root)
    const midway = await bg(root)
    check(running.includes('background-color'), `${label}: hovering runs a background-color transition (${running.join(', ') || 'none'})`)
    check(midway !== RED && midway !== BLUE, `${label}: midway through, the background is between red and blue (${midway})`)
    await page.waitForTimeout(800)
    check(await bg(root) === BLUE, `${label}: hover shows the Hover state (blue)`)
    await shot(page, `interactions/${label}-hover`)

    await root.click()
    await page.waitForTimeout(800)
    check(await bg(root) === GREEN, `${label}: clicking switches to On (green)`)
    await away()
    await page.waitForTimeout(800)
    check(await bg(root) === RED, `${label}: leaving goes back to Primary (red)`)

    await root.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    check(await bg(root) === GREEN, `${label}: Enter on the focused instance clicks it (green)`)
  }

  // The draft preview (▶).
  await exercise(`${BASE}/preview/${p.id}`, 'preview')

  // Reduced motion: instant, no transition.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${BASE}/preview/${p.id}`)
  await rootOf(page).waitFor()
  await away()
  await page.waitForTimeout(300)
  await rootOf(page).hover()
  await page.waitForTimeout(40)
  check(await bg(rootOf(page)) === BLUE && !(await transitions(rootOf(page))).length, 'preview with reduced motion: the hover state shows at once, without a transition')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // Appear with a spring, and a Toggle nested in another component keeping its own state.
  const fade = await action('node_insert', { projectId: p.id, pageId, type: 'Container', style: { opacity: '20', p: '4' }, children: [{ type: 'Text', props: { text: 'Fades in' } }] })
  const fadeCmp = await action('component_create', { projectId: p.id, pageId, nodeId: fade.nodeId, name: 'Fade' })
  const fadeRoot = (await action('project_get', { projectId: p.id })).components.find(c => c.id === fadeCmp.componentId).root.id
  const { variantId: shownId } = await action('component_variant_add', { projectId: p.id, componentId: fadeCmp.componentId, name: 'Shown' })
  await action('component_variant_set_override', { projectId: p.id, componentId: fadeCmp.componentId, variantId: shownId, nodeId: fadeRoot, style: { opacity: '100' } })
  await action('component_interaction_add', { projectId: p.id, componentId: fadeCmp.componentId, on: 'appear', to: shownId, delay: 0.2 })
  await action('component_transition_set', { projectId: p.id, componentId: fadeCmp.componentId, transition: { type: 'spring', stiffness: 120, damping: 14 } })
  const wrapBox = await action('node_insert', { projectId: p.id, pageId, type: 'Column', style: { p: '2' } })
  const wrapCmp = await action('component_create', { projectId: p.id, pageId, nodeId: wrapBox.nodeId, name: 'Wrap' })
  await action('node_insert', { projectId: p.id, componentId: wrapCmp.componentId, type: 'Instance', props: { component: componentId } })
  await page.goto(`${BASE}/preview/${p.id}`)
  const fader = page.locator(`[data-bildr-id="${fadeCmp.nodeId}"]`).first()
  await fader.waitFor()
  const opacity = () => fader.evaluate(el => Number(getComputedStyle(el).opacity))
  const early = await opacity()
  await page.waitForTimeout(450)
  const timing = await fader.evaluate(el => getComputedStyle(el).transitionTimingFunction)
  check(early < 0.5 && timing.startsWith('linear('), `preview: an appear interaction springs the instance in with a linear() curve (${early}, ${timing.slice(0, 24)}…)`)
  await page.waitForTimeout(2500)
  check(await opacity() === 1, 'preview: after appearing, the instance shows its Shown variant')
  const nested = page.locator(`[data-bildr-id="${wrapCmp.nodeId}"][role="button"]`).first()
  await away()
  await page.waitForTimeout(800)
  const nestedBefore = await bg(nested)
  await nested.hover()
  await page.waitForTimeout(800)
  check(nestedBefore === RED && await bg(nested) === BLUE, `preview: a Toggle nested in another component hovers on its own (${nestedBefore} → blue)`)
  await away()

  // The published app.
  await action('project_publish', { projectId: p.id })
  await exercise(`${BASE}/p/${p.slug}`, 'published')

  // The editor canvas stays static.
  await openEditor(page, p.id)
  const frame = canvas(page)
  const inCanvas = rootOf(frame)
  await inCanvas.waitFor()
  await inCanvas.hover()
  await page.waitForTimeout(400)
  check(await bg(inCanvas) === RED, 'editor canvas: hovering an instance keeps Primary (static)')
  check(await inCanvas.getAttribute('role') === null && await inCanvas.getAttribute('data-bildr-interactive') === null, 'editor canvas: the instance gets no interaction handlers or role')
  await inCanvas.click()
  await page.waitForTimeout(400)
  check(await bg(inCanvas) === RED, 'editor canvas: clicking selects without switching the variant')
  await shot(page, 'interactions/editor-static')

  check(!errors.length, `no console errors (${errors.slice(0, 3).join(' | ')})`)
  void context
})

await run('interactions-ui', async ({ page, context, errors }) => {
  const p = await project('interactions-ui')
  const projectId = p.id
  const pageId = p.pages[0].id
  const get = () => action('project_get', { projectId })
  const box = await action('node_insert', { projectId, pageId, type: 'Container', style: { bg: '#ff0000', p: '8' }, children: [{ type: 'Text', props: { text: 'Toggle' } }] })
  const { componentId, nodeId } = await action('component_create', { projectId, pageId, nodeId: box.nodeId, name: 'Toggle' })
  const def = async () => (await get()).components.find(c => c.id === componentId)
  const rootId = (await def()).root.id
  const { variantId: onId } = await action('component_variant_add', { projectId, componentId, name: 'On' })
  await action('component_variant_set_override', { projectId, componentId, variantId: onId, nodeId: rootId, style: { bg: '#00ff00' } })

  const snap = async (name) => {
    await page.waitForTimeout(400)
    await shot(page, `components-p2/${name}`)
  }
  const undo = async () => {
    await page.mouse.move(700, 820)
    await page.locator('body').press('Control+z')
  }
  const redo = async () => {
    // The editor redoes once it has heard of the undo.
    await until(() => page.getByRole('button', { name: 'Redo', exact: true }).isEnabled(), 5000)
    await page.mouse.move(700, 820)
    await page.locator('body').press('Control+Shift+z')
  }
  /** Esc, then waits for the menu or popover to be gone: the editor skips keys typed inside one. */
  const dismiss = async () => {
    const gone = () => until(async () => await page.locator('[data-dismissable-layer]').count() === 0, 1500)
    await page.keyboard.press('Escape')
    // A focused field may take the first Esc (it reverts its draft).
    if (!await gone()) await page.keyboard.press('Escape')
    check(await gone(), 'Esc closes the menu or popover')
  }
  /** Undoes, checks `undone`, redoes and checks `done`, all against the stored component. */
  async function undoRedo(label, undone, done) {
    await undo()
    check(!!await until(async () => undone(await def())), `undo reverts ${label}`)
    await redo()
    check(!!await until(async () => done(await def())), `redo brings back ${label}`)
  }

  await openEditor(page, projectId)
  await page.getByRole('tab', { name: 'Assets' }).click()
  await page.locator(`[data-component-id="${componentId}"] button[draggable]`).click()
  await page.locator('[data-component-view]').waitFor()
  await page.locator('[data-board-frame="primary"]').waitFor()

  // 1. "+ Hover / Pressed" under Primary: Hover.
  const tile = page.locator('[data-board-state-add="primary"]')
  check(await tile.count() === 1 && await page.locator(`[data-board-state-add="${onId}"]`).count() === 1, 'each base variant has a "+ Hover / Pressed" tile under it')
  await tile.click()
  await page.locator('[role=menuitem]').filter({ hasText: 'Pressed' }).waitFor()
  await page.locator('[role=menuitem]').filter({ hasText: 'Hover' }).click()
  const hoverOf = d => d.variants.find(v => v.state?.of === '' && v.state.kind === 'hover')
  const hover = await until(async () => hoverOf(await def()))
  check(!!hover && hover.name === 'Primary · Hover', `the Hover tile adds a "Primary · Hover" state (${hover?.name})`)
  const hoverId = hover?.id
  const hoverFrame = page.locator(`[data-board-frame="${hoverId}"]`)
  await hoverFrame.waitFor()
  const [primaryBox, hoverBox, onBox] = await Promise.all(['primary', hoverId, onId].map(key => page.locator(`[data-board-frame="${key}"]`).boundingBox()))
  check(Math.abs(hoverBox.x - primaryBox.x) < 1 && hoverBox.y > primaryBox.y + primaryBox.height && Math.abs(onBox.y - primaryBox.y) < 1, 'the state frame sits under its base, the base variants side by side')
  const link = page.locator('[data-board-link="primary"]')
  check(await link.count() === 1 && await link.evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(136, 85, 255)', 'a purple line joins Primary and its Hover state')
  check((await hoverFrame.locator('[data-board-label]').textContent()).trim() === 'Primary · Hover', 'the state\'s chip reads "Primary · Hover"')
  check(await page.locator('[data-board-frame][data-active]').getAttribute('data-board-frame') === hoverId, 'the new state is the active variant')
  // The tile moved under the state, where the floating bar may cover it: open its menu from the keyboard.
  await tile.focus()
  await page.keyboard.press('Enter')
  const hoverItem = page.locator('[role=menuitem]').filter({ hasText: 'Hover' })
  check(await hoverItem.getAttribute('data-disabled') !== null, 'the tile\'s menu disables the Hover that exists')
  await dismiss()
  await undoRedo('the Hover state', d => !hoverOf(d), d => hoverOf(d)?.id === hoverId)

  // …then its background, edited in the inspector while the state is active.
  await hoverFrame.locator('[data-board-label]').click()
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.locator(`[data-layer-id="${rootId}"]`).first().click()
  await page.waitForTimeout(300)
  const fill = page.locator('[data-style-row="bg"]').first()
  await fill.locator('[data-style-key="bg"]').click()
  const picker = page.locator('[data-color-picker]')
  await picker.waitFor()
  await picker.getByRole('button', { name: 'Custom' }).click()
  await picker.getByLabel('Hex').fill('0000FF')
  await picker.getByLabel('Hex').press('Enter')
  const hoverBg = d => hoverOf(d)?.overrides[rootId]?.style?.bg
  check(!!await until(async () => hoverBg(await def()) === '#0000ff'), 'the Hover state\'s background is set from the inspector')
  await dismiss()
  await undoRedo('the Hover background', d => !hoverBg(d), d => hoverBg(d) === '#0000ff')
  await snap('board-states')

  // 2. Drag ⚡ from Primary to "On": a click interaction and its popover.
  const handle = await page.locator('[data-board-handle="primary"]').boundingBox()
  const target = await page.locator(`[data-board-frame="${onId}"]`).boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + Math.min(target.height / 2, 120), { steps: 12 })
  check(await page.locator('[data-board-linking]').count() === 1, 'dragging ⚡ draws a dashed line')
  await page.mouse.up()
  const firstOf = d => d.interactions?.[0]
  const created = await until(async () => firstOf(await def()))
  check(created?.on === 'click' && created.to === onId, `dropping on "On" adds a click interaction to it (${JSON.stringify(created)})`)
  const popover = page.locator('[data-interaction-popover]').filter({ has: page.locator('[data-interaction-fields]') })
  check(!!await until(() => popover.isVisible()), 'the Interaction popover opens')
  const on = popover.locator('[data-interaction-on]')
  await on.click()
  await page.locator('[role=option]').filter({ hasText: 'Mouse enter' }).click()
  check(!!await until(async () => firstOf(await def())?.on === 'mouseenter'), 'the popover changes the event to Mouse enter')
  await on.click()
  await page.locator('[role=option]').filter({ hasText: /^\s*Click\s*$/ }).click()
  check(!!await until(async () => firstOf(await def())?.on === 'click'), 'and back to Click')
  await popover.locator('[data-interaction-delay]').fill('0.2')
  await popover.locator('[data-interaction-delay]').press('Enter')
  check(!!await until(async () => firstOf(await def())?.delay === 0.2), `the popover sets a delay (${JSON.stringify(firstOf(await def()))})`)
  await dismiss()
  await undoRedo('the delay', d => firstOf(d)?.delay === undefined, d => firstOf(d)?.delay === 0.2)
  // Delay, Click, Mouse enter, then the drag itself.
  for (let i = 0; i < 4; i++) await undo()
  check(!!await until(async () => !firstOf(await def())), 'undo goes back to before the drag')
  for (let i = 0; i < 4; i++) await redo()
  check(!!await until(async () => firstOf(await def())?.delay === 0.2), 'redo brings the interaction back')
  const interactionId = (await def()).interactions[0].id

  // The arrow.
  const arrow = page.locator(`[data-interaction-arrow="${interactionId}"]`)
  check(!!await until(async () => await arrow.count() === 1), 'the interaction shows as an arrow on the board')
  check(await arrow.locator('path').last().evaluate(el => getComputedStyle(el).stroke) === 'rgb(136, 85, 255)', 'the arrow is purple')
  await page.locator(`[data-interaction-label="${interactionId}"]`).click()
  check(!!await until(() => popover.isVisible()), 'clicking the arrow opens its popover')
  check(await arrow.getAttribute('data-selected') !== null, 'and selects it')
  await snap('interaction-arrow')
  await dismiss()
  await page.mouse.move(700, 820)
  await page.keyboard.press('Delete')
  check(!!await until(async () => !(await def()).interactions?.length), 'Delete removes the selected arrow\'s interaction')
  await undo()
  check(!!await until(async () => (await def()).interactions?.[0]?.id === interactionId), 'undo brings it back')

  // 3. The inspector: Primary's Interactions row, and a Spring transition.
  await page.locator('[data-board-frame="primary"] [data-board-label]').click()
  await page.locator(`[data-layer-id="${rootId}"]`).first().click()
  const row = page.locator(`[data-interaction-row="${interactionId}"]`)
  await row.waitFor()
  check((await row.textContent()).includes('Click → On'), `the Interactions section lists "Click → On" (${(await row.textContent()).trim()})`)
  const transitionRow = page.locator('[data-transition-row]')
  check((await transitionRow.textContent()).trim() === 'Ease 0.3s', `the Transition row shows the default (${(await transitionRow.textContent()).trim()})`)
  await transitionRow.click()
  const fields = page.locator('[data-transition-fields]')
  await fields.waitFor()
  await fields.getByRole('button', { name: 'Spring' }).click()
  check(!!await until(async () => (await def()).transition?.type === 'spring'), 'the Spring tab sets a spring transition on the component')
  await fields.locator('[data-transition-stiffness]').waitFor()
  check(await fields.locator('[data-transition-curve] path').count() === 1, 'the popover draws the curve')
  await fields.locator('[data-transition-preview]').click()
  await snap('transition-popover')
  await dismiss()
  check(!!await until(async () => (await transitionRow.textContent()).trim() === 'Spring'), 'the Transition row reads "Spring"')
  await undoRedo('the transition', d => !d.transition, d => d.transition?.type === 'spring')
  await hoverFrame.locator('[data-board-label]').click()
  check(!!await until(async () => (await page.locator('[data-transition-row]').textContent()).trim() === 'Inherit'), 'a state without its own transition shows "Inherit"')
  await page.locator('[data-board-frame="primary"] [data-board-label]').click()

  // ⌘K offers "Preview interactions".
  await page.mouse.move(700, 820)
  await page.locator('body').press('Control+k')
  await page.keyboard.type('Preview interactions')
  check(!!await until(() => page.getByRole('option').filter({ hasText: 'Preview interactions' }).first().isVisible()), '⌘K offers "Preview interactions"')
  await dismiss()

  // 4. The preview (⌘P in the component view, on a page showing it): hover changes the background, the click switches to On.
  await page.mouse.move(700, 820)
  const opened = context.waitForEvent('page')
  await page.locator('body').press('Control+p')
  const preview = await opened
  check(preview.url().includes(`/preview/${projectId}`), `⌘P in the component view opens the preview (${preview.url()})`)
  const inst = preview.locator(`[data-bildr-id="${nodeId}"]`).first()
  await inst.waitFor()
  const bg = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor)
  await preview.mouse.move(5, 800)
  await preview.waitForTimeout(1500)
  check(await bg(inst) === RED, `preview: Primary is red (${await bg(inst)})`)
  await inst.hover()
  check(!!await until(async () => await bg(inst) === BLUE), `preview: hovering shows the Hover state (${await bg(inst)})`)
  await inst.click()
  check(!!await until(async () => await bg(inst) === GREEN), `preview: clicking switches to On (${await bg(inst)})`)
  await preview.close()

  // 5. × removes the interaction.
  await row.locator('[data-interaction-delete]').click()
  check(!!await until(async () => !(await def()).interactions?.length), '× removes the interaction')
  check(!!await until(async () => await arrow.count() === 0), 'and its arrow')
  await undoRedo('the removal', d => d.interactions?.[0]?.id === interactionId, d => !d.interactions?.length)

  // The instance's variant select lists base variants only.
  await page.locator('[data-breadcrumb-done]').click()
  await page.locator(`[data-layer-id="${nodeId}"]`).first().click()
  await page.locator('[data-instance-variant] button').first().click()
  const options = await page.locator('[role=option]').allTextContents()
  check(options.some(o => o.includes('On')) && !options.some(o => o.includes('Hover')), `the instance's variant select lists base variants only (${options.map(o => o.trim()).join(', ')})`)
  await page.keyboard.press('Escape')

  check(!errors.length, `no console errors (${errors.slice(0, 3).join(' | ')})`)
})

await run('interactions-runtime', async ({ page, errors }) => {
  const YELLOW = 'rgb(255, 255, 0)'
  const p = await project('interactions-runtime')
  const projectId = p.id
  const pageId = p.pages[0].id
  const get = () => action('project_get', { projectId })
  /** A component made from a Container with a Text, its instance on `pid`. */
  const make = async (name, style, text, pid = pageId) => {
    const box = await action('node_insert', { projectId, pageId: pid, type: 'Container', style: { ...style, p: '4' }, children: [{ type: 'Text', props: { text } }] })
    const made = await action('component_create', { projectId, pageId: pid, nodeId: box.nodeId, name })
    const def = (await get()).components.find(d => d.id === made.componentId)
    return { ...made, rootId: def.root.id }
  }
  const variant = async (componentId, rootId, name, color) => {
    const { variantId } = await action('component_variant_add', { projectId, componentId, name })
    await action('component_variant_set_override', { projectId, componentId, variantId, nodeId: rootId, style: { bg: color } })
    return variantId
  }
  const instant = componentId => action('component_transition_set', { projectId, componentId, transition: { type: 'instant' } })
  const bg = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor)
  const away = () => page.mouse.move(1390, 840)

  // Hov: a Hover state, red → blue.
  const hov = await make('Hov', { bg: '#ff0000' }, 'Hover me')
  const { variantId: hovH } = await action('component_state_add', { projectId, componentId: hov.componentId, baseVariantId: '', kind: 'hover' })
  await action('component_variant_set_override', { projectId, componentId: hov.componentId, variantId: hovH, nodeId: hov.rootId, style: { bg: '#0000ff' } })
  await instant(hov.componentId)

  // Press: Primary clicks to A (green), its Pressed state clicks to B (yellow).
  const pr = await make('Press', { bg: '#ff0000' }, 'Press me')
  const prA = await variant(pr.componentId, pr.rootId, 'A', '#00ff00')
  const prB = await variant(pr.componentId, pr.rootId, 'B', '#ffff00')
  const { variantId: prP } = await action('component_state_add', { projectId, componentId: pr.componentId, baseVariantId: '', kind: 'pressed' })
  await action('component_interaction_add', { projectId, componentId: pr.componentId, on: 'click', to: prA })
  await action('component_interaction_add', { projectId, componentId: pr.componentId, variantId: prP, on: 'click', to: prB })
  await instant(pr.componentId)

  // Leave: its Hover state's mouse leave goes to B (yellow).
  const lv = await make('Leave', { bg: '#ff0000' }, 'Leave me')
  const lvB = await variant(lv.componentId, lv.rootId, 'B', '#ffff00')
  const { variantId: lvH } = await action('component_state_add', { projectId, componentId: lv.componentId, baseVariantId: '', kind: 'hover' })
  await action('component_interaction_add', { projectId, componentId: lv.componentId, variantId: lvH, on: 'mouseleave', to: lvB })
  await instant(lv.componentId)

  // Outer: clicks to On (green), with a Press instance inside.
  const outerBox = await action('node_insert', { projectId, pageId, type: 'Column', style: { p: '4', bg: '#ff0000' } })
  const outer = await action('component_create', { projectId, pageId, nodeId: outerBox.nodeId, name: 'Outer' })
  const outerRoot = (await get()).components.find(d => d.id === outer.componentId).root.id
  await action('node_insert', { projectId, componentId: outer.componentId, parentId: outerRoot, type: 'Instance', props: { component: pr.componentId } })
  const outerOn = await variant(outer.componentId, outerRoot, 'On', '#00ff00')
  await action('component_interaction_add', { projectId, componentId: outer.componentId, on: 'click', to: outerOn })
  await instant(outer.componentId)

  // Via: clicks to On; its root is an instance of Btn, whose root is a Button.
  const btn = await action('node_insert', { projectId, pageId, type: 'Button', props: { label: 'Native' } })
  const btnC = await action('component_create', { projectId, pageId, nodeId: btn.nodeId, name: 'Btn' })
  const wrapped = await action('node_insert', { projectId, pageId, type: 'Instance', props: { component: btnC.componentId } })
  const via = await action('component_create', { projectId, pageId, nodeId: wrapped.nodeId, name: 'Via' })
  const { variantId: viaOn } = await action('component_variant_add', { projectId, componentId: via.componentId, name: 'On' })
  await action('component_interaction_add', { projectId, componentId: via.componentId, on: 'click', to: viaOn })

  // A layout with a Hov instance, on page "Two".
  const { layoutId } = await action('layout_create', { projectId, name: 'Site' })
  const layoutRoot = (await get()).layouts.find(l => l.id === layoutId).root.id
  await action('node_insert', { projectId, layoutId, parentId: layoutRoot, index: 0, type: 'Instance', props: { component: hov.componentId } })
  const two = await action('page_add', { projectId, name: 'Two', slug: 'two' })
  await action('page_set_layout', { projectId, pageId: two.pageId, layoutId })
  await action('node_insert', { projectId, pageId: two.pageId, type: 'Text', props: { text: 'Page two' } })
  await action('project_publish', { projectId })

  const nodes = (await get()).pages[0].root.children
  const instanceOf = componentId => nodes.find(n => n.type === 'Instance' && n.props.component === componentId)?.id
  const rootOf = id => page.locator(`[data-bildr-id="${id}"]`).first()

  for (const [base, label] of [[`${BASE}/preview/${projectId}`, 'preview'], [`${BASE}/p/${p.slug}`, 'published']]) {
    await page.goto(base)
    const press = rootOf(instanceOf(pr.componentId))
    await press.waitFor()
    await away()
    await press.click()
    await page.waitForTimeout(200)
    const pressed = await bg(press)
    check(pressed === YELLOW, `${label}: a click while the Pressed state shows runs that state's click (→ B, yellow), not Primary's (${pressed})`)

    const leave = rootOf(instanceOf(lv.componentId))
    await leave.hover()
    await page.waitForTimeout(100)
    await away()
    await page.waitForTimeout(200)
    const left = await bg(leave)
    check(left === YELLOW, `${label}: the Hover state's mouse leave fires (→ B, yellow) (${left})`)

    const outerEl = rootOf(instanceOf(outer.componentId))
    check(await outerEl.getAttribute('role') === 'button', `${label}: the outer clickable instance is role=button`)
    const nestedRoles = await outerEl.evaluate(el => el.querySelectorAll('[role="button"]').length)
    check(nestedRoles === 0, `${label}: no role=button inside the outer role=button (${nestedRoles})`)
    const inner = outerEl.locator('[data-bildr-interactive]').first()
    check(await inner.getAttribute('tabindex') === null, `${label}: the nested clickable instance gets no tabindex`)
    await inner.click()
    await page.waitForTimeout(200)
    const innerBg = await bg(inner)
    const outerBg = await bg(outerEl)
    check(innerBg === YELLOW && outerBg === RED, `${label}: clicking the nested instance switches it (${innerBg}) but not the outer one (${outerBg})`)
    await away()
    await page.waitForTimeout(100)
    await outerEl.click({ position: { x: 4, y: 4 } })
    await page.waitForTimeout(200)
    check(await bg(outerEl) === GREEN, `${label}: clicking the outer instance itself still switches it (green)`)

    const viaEl = rootOf(instanceOf(via.componentId))
    const tag = await viaEl.evaluate(el => el.tagName)
    check(tag === 'BUTTON' && await viaEl.getAttribute('role') === null && await viaEl.getAttribute('tabindex') === null, `${label}: a clickable component whose root is a Button instance renders a <button> without role or tabindex (<${tag}>)`)

    await page.goto(`${base}/two`)
    const text = page.getByText('Hover me').first()
    await text.waitFor()
    const hovered = text.locator('xpath=..')
    await away()
    await page.waitForTimeout(200)
    const before = await bg(hovered)
    await hovered.hover()
    await page.waitForTimeout(300)
    const after = await bg(hovered)
    check(before === RED && after === BLUE && await hovered.getAttribute('data-bildr-interactive') !== null, `${label}: an interactive instance in a layout hovers (${before} → ${after})`)
  }

  check(!errors.length, `no console errors (${errors.slice(0, 3).join(' | ')})`)
})
