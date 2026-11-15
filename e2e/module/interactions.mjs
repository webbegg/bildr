/**
 * Component states and interactions on the module editor (condensed port of e2e/interactions.mjs,
 * S3.4): a component with a Hover state that changes its background, a click from Primary to "On" and
 * a mouse leave from On back to Primary, with an ease transition. They are made through the editor's
 * actions and checked in the component's `.bildr` file; the running app next to the editor then
 * shows them: hovering changes the computed background through a CSS transition, clicking (or Enter)
 * switches to On, and leaving goes back. The editor's own canvas stays static, and its preview mode
 * runs the same interactions. Shots go to e2e/module/.shots/interactions/.
 *
 * Dropped or condensed:
 * - the hosted "published app" runs: the running app (`nuxt dev`) is the one under test;
 * - the editor UI half (`interactions-ui`: the variant board's "+ Hover / Pressed" tile, the ⚡ drag,
 *   the arrow, the Transition popover, each step's undo and redo): the module's board and popovers are
 *   unit-tested (test/editor/components.test.ts); here the same data is made by actions, and the board is
 *   only opened and checked for its Hover state tile;
 * - the `interactions-runtime` cases (an interactive instance in a layout, a Pressed state's own click, nested
 *   clickable instances and role=button): kept to the click/hover/leave loop on a page, with reduced motion.
 */
import { action, appShows, bildr, canvas, check, lastStep, openApp, openEditor, run, scene, shot, until } from './lib.mjs'

await run('interactions', async ({ page, browser, errors }) => {
  const s = await scene('interactions')
  const box = await s.ins({ type: 'Container', style: { p: '6', bg: 'muted' }, children: [{ type: 'Text', props: { text: 'Interactive card' } }] })
  const made = await action('component_create', { file: s.file, nodeId: box, name: 'Toggle card' })
  const component = made.componentId
  const root = bildr(made.filePath).root.id
  const { variantId: on } = await action('component_variant_add', { component, name: 'On' })
  await action('component_variant_set_override', { component, variant: on, nodeId: root, style: { bg: 'primary' } })
  const { variantId: hover } = await action('component_state_add', { component, baseVariant: '', kind: 'hover' })
  await action('component_variant_set_override', { component, variant: hover, nodeId: root, style: { bg: 'secondary' } })
  await action('component_interaction_add', { component, variant: '', on: 'click', to: on })
  await action('component_interaction_add', { component, variant: on, on: 'mouseleave', to: '' })
  await action('component_transition_set', { component, transition: { type: 'ease', duration: 0.2, easing: 'ease-in-out' } })

  const def = bildr(made.filePath)
  const states = def.variants.map(v => v.name)
  check(states.includes('on') && def.variants.length === 2, `the component file has the On variant and a Hover state (${states.join(', ')})`)
  check(def.variants.find(v => v.id === hover)?.overrides?.[root]?.style?.bg === 'secondary', 'the Hover state overrides the background')
  check(JSON.stringify(def.interactions ?? []).includes(on) && JSON.stringify(def.variants.find(v => v.id === on)?.interactions ?? []).includes('mouseleave'), 'a click goes to On and a mouse leave from On goes back')
  check(def.transition?.type === 'ease', `the component has an ease transition (${JSON.stringify(def.transition)})`)
  check(await lastStep() === 'component_transition_set', 'each edit is an undo step')

  // The editor's canvas stays static; the variant board shows the states.
  await openEditor(page, component)
  // (a component with 2+ variants opens on the board)
  await page.waitForTimeout(800)
  await shot(page, 'interactions/board')
  check(!!await until(async () => await page.locator('[data-board-variant], [data-variant-row]').count() >= 2), 'the variant board lists the primary and the variants')
  await openEditor(page, s.file)
  const bg = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor)
  const card = canvas(page).getByText('Interactive card').locator('xpath=..')
  const before = await bg(card)
  await card.hover()
  await page.waitForTimeout(500)
  check(await bg(card) === before, 'the editor canvas stays static: hovering changes nothing')

  // The running app: the Hover state, the click, the leave.
  const shown = await appShows(browser, s.path, 'Interactive card')
  check(shown.html.includes('Interactive card'), `the running app renders the instance (${shown.status})`)
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' })
  const live = await openApp(context, s.path)
  const cardIn = live.getByText('Interactive card').locator('xpath=..')
  await cardIn.waitFor({ timeout: 30_000 })
  const primary = await bg(cardIn)
  await cardIn.hover()
  const hovered = await until(async () => {
    const color = await bg(cardIn)
    return color !== primary && color
  })
  check(!!hovered, `hovering changes the computed background (${primary} → ${hovered})`)
  await shot(live, 'interactions/hovered')
  // (the card sits at the top left of the page: leave to the bottom right)
  const away = { x: 1270, y: 790 }
  await live.mouse.move(away.x, away.y)
  check(!!await until(async () => (await bg(cardIn)) === primary), 'leaving goes back to the primary background')
  await cardIn.click()
  await live.mouse.move(away.x, away.y)
  const switched = await until(async () => {
    const color = await bg(cardIn)
    return color !== primary && color
  })
  check(!!switched, `clicking switches to On (${switched})`)
  await cardIn.hover()
  await live.mouse.move(away.x, away.y)
  check(!!await until(async () => (await bg(cardIn)) === primary), 'a mouse leave from On goes back to the primary')
  await shot(live, 'interactions/after-leave')

  // Reduced motion: the change is instant (no transition on the computed style).
  const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const quiet = await openApp(calm, s.path)
  const calmCard = quiet.getByText('Interactive card').locator('xpath=..')
  await calmCard.waitFor({ timeout: 30_000 })
  const duration = await calmCard.evaluate(el => getComputedStyle(el).transitionDuration)
  check(/^0s(, 0s)*$/.test(duration) || duration === '', `with reduced motion the transition is instant (${duration})`)
  await context.close()
  await calm.close()

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
