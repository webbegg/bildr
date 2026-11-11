/**
 * Component states and interactions (S3.4 runtime, run by all.mjs). Through
 * actions only (the editor UI comes later): a component with a Hover state
 * that changes its background, a click from Primary to "On", and a mouse
 * leave from On back to Primary, with an ease transition. In the draft
 * preview and in the published app, hovering changes the computed
 * background through a CSS transition, clicking (or Enter) switches to On,
 * and leaving goes back; with reduced motion the change is instant. The
 * editor canvas stays static. Shots go to e2e/.shots/interactions/.
 */
import { action, BASE, canvas, check, openEditor, project, run, shot } from './lib.mjs'

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
