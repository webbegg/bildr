/**
 * Interactions on any node (B3, S2) on the module editor, all through the inspector: on the golden blog's index page a Button is
 * inserted in the header (the Insert panel), and the Interactions section gives it a click that shows a message; the message is
 * changed to going to the post detail page with a slug (a step added, the first one removed); the interaction is removed; and the
 * Checkbox `n_toggle`'s change is read as "Set showDrafts · Blog preferences to the checkbox's value". A node that takes no events has no
 * section, and a new interaction left unfinished is kept as a row that says it is not saved. The page's file is checked after
 * each step, and the running app still renders it.
 *
 * An action that takes no input (B7) is made in setup (a blank action whose input is taken away: the one place a module action is
 * called). The Button's click runs it from the inspector with nothing to choose, the file holds the step with no `args`, and a click on
 * the Button in the running app calls the action's route.
 *
 * An action that takes input but has no optimistic update (fix/action-server-call) is made at the end: the update template over a Note
 * (in a memory data source, with a sample row), whose steps are given a title to set. A Button runs it with the note's id, and a click in
 * the running app sends the PATCH and the note's title changes.
 *
 * (`interactions.mjs` is the component's variant interactions, the hover and click of a card, written by the module's actions.)
 * Shots go to e2e/module/.shots/.
 */
import { action, appApi, appShows, bildr, check, findNode, openApp, openEditor, quiesce, quiet, run, shot, until } from './lib.mjs'

const INDEX = 'modules/blog/pages/index.json'

await run('node-interactions', async ({ page, browser, errors }) => {
  const head = () => findNode(bildr(INDEX).root, node => node.id === 'n_head')
  const section = page.locator('[data-node-interactions]')
  const fields = page.locator('[data-node-interaction-fields]')

  // Setup: an action that takes no input (a blank action over Post, whose input is taken away). Nothing else here calls a module action.
  await action('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
  await action('action_update', { action: 'act_tidy_posts', input: {} })

  await openEditor(page, 'pg_index')

  // A Button in the header: select the header row, then insert from the Insert panel.
  await page.locator('[data-sidebar-switcher] [role=tab]').filter({ hasText: /^Layers$/ }).click()
  await page.locator('[data-layer-id="n_head"]').click()
  await page.locator('[data-insert-button]').click()
  await page.locator('[data-palette-type="Button"]').click()
  const button = await until(() => head()?.children.find(node => node.type === 'Button'))
  check(!!button, `the Insert panel puts a Button in the header (${button?.id})`)
  check(await until(async () => (await page.locator('[data-inspector-head] p').first().innerText()).includes(button.id)), 'and selects it')
  await section.waitFor()
  check((await section.locator('h3').innerText()) === 'Interactions', 'the inspector shows an Interactions section for it')
  check(await section.locator('[data-node-interaction]').count() === 0, 'with no interaction yet')
  check(await page.locator('[data-style-section="Variant changes"]').count() === 0, 'and no component variant section: this is a page')

  // The events a Button takes.
  await section.locator('[data-section-action="add"]').click()
  const events = await page.locator('[role=menuitem]').evaluateAll(items => items.map(item => `${item.textContent.trim().replace(/\s+/g, ' ')}${item.hasAttribute('data-disabled') ? '*' : ''}`))
  check(events.join('|') === 'Click|Mouse enter|Mouse leave|AppearNot generated yet*', `the "+" lists click, mouse enter, mouse leave, and Appear as not generated yet (${events.join('|')})`)
  await page.getByRole('menuitem', { name: 'Click', exact: true }).click()
  await fields.waitFor()
  check((await section.locator('[data-node-interaction-toggle]').innerText()).includes('When Click'), 'picking Click opens its steps under a row "When Click"')

  // Click → Show message: nothing is written until the title is.
  await page.locator('[data-interaction-add-step]').click()
  const kinds = await page.locator('[role=menuitem]').allInnerTexts()
  check(kinds.map(kind => kind.trim()).join('|') === 'Set state|Run action|Go to page|Show message', `Add step offers each kind (${kinds.join('|')})`)
  await page.getByRole('menuitem', { name: 'Show message', exact: true }).click()
  check((await page.locator('[data-step="0"]').innerText()).includes('Write a title') && !head().children.find(node => node.id === button.id).interactions, 'a message with no title says so, and nothing is written yet')
  await page.locator('[data-step="0"] input[data-step-title], [data-step="0"] [data-step-title] input').first().fill('Saved')
  await page.locator('[data-step="0"] [data-step-title] input, [data-step="0"] input[data-step-title]').first().press('Enter')
  const withToast = await until(() => head().children.find(node => node.id === button.id).interactions && head().children.find(node => node.id === button.id))
  check(JSON.stringify(withToast?.interactions) === JSON.stringify([{ on: 'click', do: [{ kind: 'toast', title: 'Saved' }] }]), `the file has click → a message “Saved” (${JSON.stringify(withToast?.interactions)})`)
  check(await until(async () => (await section.locator('[data-node-interaction-toggle]').innerText()).replace(/\s+/g, ' ').trim() === 'When Click → Show “Saved”'), 'and the row reads "When Click → Show “Saved”"')
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await shot(page, 'b3-interactions-toast-step')

  // The app still renders the page with the message.
  check(await quiesce(60_000), 'the app regenerates with the message')
  await quiet()
  const withMessage = await appShows(browser, '/', 'Show drafts')
  check(withMessage.html.includes('Show drafts') && withMessage.html.includes('Posts'), 'the running app still renders the page')

  // Change it to Go to page: the post detail page, with a slug. Go to page can follow a message (in order), then the message goes.
  await page.locator('[data-interaction-add-step]').click()
  await page.getByRole('menuitem', { name: 'Go to page', exact: true }).click()
  check((await page.locator('[data-step="1"]').innerText()).includes('Choose a page'), 'a second step, Go to page, asks for the page first')
  await page.locator('[data-step="1"] [data-step-page]').click()
  await page.getByRole('option', { name: '/posts/:slug', exact: true }).click()
  check((await page.locator('[data-step="1"]').innerText()).includes('Give a value for slug'), 'and for a value for the :slug of its path')
  check(head().children.find(node => node.id === button.id).interactions[0].do.length === 1, 'nothing is written while it is incomplete')
  await page.locator('[data-step="1"] [data-value-way-select]').click()
  const ways = await page.getByRole('option').allInnerTexts()
  check(ways.map(way => way.trim()).join('|') === 'A fixed value|A value from the page', `the slug is a fixed value or a name from the page (${ways.join('|')})`)
  await page.getByRole('option', { name: 'A fixed value', exact: true }).click()
  await page.locator('[data-step="1"] input[data-value-fixed], [data-step="1"] [data-value-fixed] input').first().fill('hello-world')
  await page.locator('[data-step="1"] input[data-value-fixed], [data-step="1"] [data-value-fixed] input').first().press('Enter')
  const both = await until(() => head().children.find(node => node.id === button.id).interactions[0].do.length === 2 && head().children.find(node => node.id === button.id))
  check(JSON.stringify(both?.interactions[0].do[1]) === JSON.stringify({ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'hello-world' } } }), `the file goes to the post detail page with the slug, in order after the message (${JSON.stringify(both?.interactions[0].do)})`)
  check(!both?.interactions[0].do.some(step => 'when' in step), 'with no "when": no action comes first')
  await page.locator('[data-step="0"] [data-step-remove]').click()
  const changed = await until(() => head().children.find(node => node.id === button.id).interactions[0].do.length === 1 && head().children.find(node => node.id === button.id))
  check(JSON.stringify(changed?.interactions) === JSON.stringify([{ on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'hello-world' } } }] }]), `removing the message leaves click → Go to page (${JSON.stringify(changed?.interactions)})`)
  check(await until(async () => (await section.locator('[data-node-interaction-toggle]').innerText()).replace(/\s+/g, ' ').trim() === 'When Click → Go to posts-slug'), 'the row reads "When Click → Go to posts-slug"')
  check(await page.locator('[data-step="0"] [data-step-remove]').count() === 0, 'the only step of a saved interaction can\'t be removed (the interaction can)')
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await shot(page, 'b3-interactions-navigate-step')
  check(await quiesce(60_000), 'the app regenerates with the page link')
  await quiet()
  const withGo = await appShows(browser, '/', 'Show drafts')
  check(withGo.html.includes('Show drafts'), 'the running app still renders the page with the Go to page click')

  // Remove it from its row.
  await section.locator('[data-node-interaction-delete]').click()
  const gone = await until(() => !head().children.find(node => node.id === button.id).interactions)
  check(gone, 'removing the row takes the interaction out of the file')
  check(await until(async () => await section.locator('[data-interactions-empty]').count() === 1), 'and the section says nothing happens yet')

  // A new interaction left unfinished is not lost: its row says it is not saved, also after another node was selected.
  await section.locator('[data-section-action="add"]').click()
  await page.getByRole('menuitem', { name: 'Click', exact: true }).click()
  await fields.waitFor()
  await page.locator('[data-interaction-add-step]').click()
  await page.getByRole('menuitem', { name: 'Show message', exact: true }).click()
  await page.locator('[data-layer-id="n_head"]').click()
  check(await until(async () => await section.count() === 0), 'a node that takes no events has no Interactions section')
  await page.locator(`[data-layer-id="${button.id}"]`).click()
  check(await until(async () => (await section.locator('[data-node-interaction-toggle]').innerText()).replace(/\s+/g, ' ').trim().startsWith('When Click → not saved yet')), 'the unfinished click is still there, as a row that says it is not saved, when the button is selected again')
  check(!head().children.find(node => node.id === button.id).interactions, 'and nothing was written')
  await section.locator('[data-node-interaction-delete]').click()
  check(await until(async () => await section.locator('[data-interactions-empty]').count() === 1), 'removing it drops the draft')

  // Click → Run action on an action that takes no input: nothing to choose, no `args` in the file, and the running app calls it.
  await section.locator('[data-section-action="add"]').click()
  await page.getByRole('menuitem', { name: 'Click', exact: true }).click()
  await fields.waitFor()
  await page.locator('[data-interaction-add-step]').click()
  await page.getByRole('menuitem', { name: 'Run action', exact: true }).click()
  await page.locator('[data-step="0"] [data-step-action]').click()
  const choices = (await page.getByRole('option').allInnerTexts()).map(choice => choice.replace(/\s+/g, ' ').trim())
  check(choices.includes('Tidy posts'), `the action that takes no input is a choice, not disabled with a reason (${choices.join(' | ')})`)
  await page.getByRole('option', { name: 'Tidy posts', exact: true }).click()
  check(await until(async () => (await page.locator('[data-step="0"] [data-step-no-input]').innerText()).trim() === 'This action takes no input'), 'the step says it takes no input, and asks for nothing')
  const tidy = await until(() => head().children.find(node => node.id === button.id).interactions && head().children.find(node => node.id === button.id))
  check(JSON.stringify(tidy?.interactions) === JSON.stringify([{ on: 'click', do: [{ kind: 'runAction', action: 'act_tidy_posts' }] }]), `the file has click → run the action, with no args (${JSON.stringify(tidy?.interactions)})`)
  check(bildr(INDEX).uses.actions?.some(use => use.action === 'act_tidy_posts'), 'and the page uses the action')
  check(await until(async () => (await section.locator('[data-node-interaction-toggle]').innerText()).replace(/\s+/g, ' ').trim() === 'When Click → Run Tidy posts'), 'the row reads "When Click → Run Tidy posts"')
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await shot(page, 'b7-interactions-no-input-action')
  check(await quiesce(60_000), 'the app regenerates with the action called with nothing')
  await quiet()
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const live = await openApp(context, '/')
    const label = tidy.props?.text ?? 'Button'
    const seen = []
    live.on('request', request => seen.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, '')}`))
    live.on('pageerror', error => seen.push(`pageerror: ${error.message}`))
    const tidyButton = live.locator('button', { hasText: label }).first()
    await tidyButton.waitFor({ timeout: 30_000 })
    const answered = live.waitForResponse(answer => answer.request().method() === 'POST' && answer.url().includes('/api/blog/posts/tidy-posts'), { timeout: 30_000 }).catch(() => undefined)
    await tidyButton.click()
    const response = await answered
    check(!!response?.ok(), `a click on the Button in the running app calls the action (${response ? response.status() : `no call; the page made ${seen.join(', ')}; its buttons: ${(await live.locator('button').allInnerTexts()).join(' | ')}`})`)
  } finally {
    await context.close()
  }

  // The checkbox's change, as the golden blog has it.
  await page.locator('[data-layer-id="n_toggle"]').click()
  check(await until(async () => await section.locator('[data-node-interaction]').count() === 1), 'selecting the checkbox shows its one interaction')
  const row = await section.locator('[data-node-interaction-toggle]').innerText()
  check(row.replace(/\s+/g, ' ').trim() === 'When Change → Set showDrafts · Blog preferences to the checkbox\'s value', `its row reads "When Change → Set showDrafts · Blog preferences to the checkbox's value" (${row.replace(/\s+/g, ' ').trim()})`)
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await shot(page, 'b3-interactions-section')
  await section.locator('[data-node-interaction] button[aria-label^="Edit"]').click()
  await fields.waitFor()
  const state = (await page.locator('[data-step="0"] [data-step-state]').innerText()).trim()
  const field = (await page.locator('[data-step="0"] [data-step-field]').innerText()).trim()
  const value = (await page.locator('[data-step="0"] [data-value-way-select]').innerText()).trim()
  check(state === 'Blog preferences' && field === 'showDrafts' && value === 'The control\'s value', `its step is Blog preferences, showDrafts, the control's value (${state} | ${field} | ${value})`)
  check(await page.locator('[data-interaction-add-step]').count() === 0 && (await page.locator('[data-interaction-no-more]').innerText()).startsWith('Set state runs on its own'), 'and no step can follow Set state')
  const words = await fields.innerText()
  check(!/setState|\$event|composable|runAction/.test(words), 'the steps have none of the code\'s words')
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await shot(page, 'b3-interactions-checkbox-step')
  const toggle = findNode(bildr(INDEX).root, node => node.id === 'n_toggle')
  check(JSON.stringify(toggle.interactions[0].do[0].value) === JSON.stringify({ $event: 'checked' }), 'the file is untouched by looking at it')

  // The toggle's value: the opposite of its current value, then back (one update each, the event named).
  await page.locator('[data-step="0"] [data-value-way-select]').click()
  await page.getByRole('option', { name: 'The opposite of its current value', exact: true }).click()
  const flipped = await until(() => findNode(bildr(INDEX).root, node => node.id === 'n_toggle').interactions[0].do[0].value.not)
  check(JSON.stringify(flipped) === JSON.stringify({ $bind: 'preferences.showDrafts' }), 'choosing the opposite writes { not: { $bind: preferences.showDrafts } }')
  await page.locator('[data-step="0"] [data-value-way-select]').click()
  await page.getByRole('option', { name: 'The control\'s value', exact: true }).click()
  const back = await until(() => findNode(bildr(INDEX).root, node => node.id === 'n_toggle').interactions[0].do[0].value.$event)
  check(back === 'checked', 'and the control\'s value puts the golden step back')
  check(await quiesce(60_000), 'the app regenerates')
  await quiet()
  const final = await appShows(browser, '/', 'Show drafts')
  check(final.html.includes('Show drafts'), 'the running app renders the golden page again')

  // The detail page's Publish button: an action with its parameter, then a message when it worked.
  const publishFile = () => JSON.stringify(findNode(bildr('modules/blog/pages/post-detail.json').root, node => node.id === 'n_publish').interactions)
  const publishBefore = publishFile()
  await openEditor(page, 'pg_post_detail')
  await page.locator('[data-sidebar-switcher] [role=tab]').filter({ hasText: /^Layers$/ }).click()
  await page.locator('[data-layer-id="n_publish"]').click()
  await section.waitFor()
  const publish = (await section.locator('[data-node-interaction-toggle]').innerText()).replace(/\s+/g, ' ').trim()
  check(publish === 'When Click → Run Publish post, then show “Post published”', `the Publish button's row reads its steps in order (${publish})`)
  await section.locator('[data-node-interaction-toggle]').click()
  await fields.waitFor()
  check((await page.locator('[data-step="0"] [data-step-action]').innerText()).trim() === 'Publish post' && (await page.locator('[data-step="0"] [data-value-way-select]').innerText()).trim() === 'A value from the page' && (await page.locator('[data-step="1"] [data-step-when]').innerText()).trim() === 'if it worked', 'its first step runs Publish post with a value from the page, the second shows its message if it worked')
  await page.locator('[data-interaction-add-step]').click()
  const after = (await page.locator('[role=menuitem]').allInnerTexts()).map(item => item.trim())
  check(after.join('|') === 'Go to page|Show message', `only Go to page and Show message can follow an action (${after.join('|')})`)
  await page.keyboard.press('Escape')
  await section.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await shot(page, 'b3-interactions-action-step')
  check(publishFile() === publishBefore, 'and looking at it writes nothing: the file is as it was')

  // An action with input and no optimistic update, run from a Button: the running app sends the request and the row changes.
  // A Note in a memory data source (no database migration), with one sample row, and the update template over it. The template's steps
  // change nothing, so its update step gets a field to set; the row changes only if the request reaches the server.
  const ROW = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b77'
  await action('datasource_create', { name: 'scratch', kind: 'memory' })
  await action('entity_create', { name: 'note', source: 'ds_scratch', fields: [{ name: 'title', type: 'text', required: true }] })
  await action('fixture_row_create', { entity: 'ent_note', values: { id: ROW, title: 'Before the click' } })
  await action('action_create', { entity: 'ent_note', template: 'update', name: 'retitleNote' })
  const template = bildr('modules/blog/actions/retitle-note.json')
  await action('action_update', {
    action: 'act_retitle_note',
    steps: template.steps.map(step => step.kind === 'repository' ? { ...step, set: { title: 'Retitled' } } : step)
  })
  const retitleAction = bildr('modules/blog/actions/retitle-note.json')
  check(!retitleAction.client.optimistic && retitleAction.input.params?.length === 1 && retitleAction.http.method === 'PATCH', `the update action takes an id and has no optimistic update (${JSON.stringify(retitleAction.client)})`)
  await action('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Retitle the note' } })
  const retitleButton = head().children.find(node => node.props?.text === 'Retitle the note')
  check(!!retitleButton, `a Button for it is in the header (${retitleButton?.id})`)
  await action('node_interaction_add', { file: 'pg_index', nodeId: retitleButton.id, on: 'click', do: [{ kind: 'runAction', action: 'act_retitle_note', args: { id: ROW } }] })
  check(await quiesce(60_000), 'the app regenerates with the update action called with the note\'s id')
  await quiet()
  const titleOf = async () => (await appApi('/api/blog/notes?limit=100&offset=0'))?.body?.items?.find(row => row.id === ROW)?.title
  check(await until(async () => (await titleOf()) === 'Before the click', 90_000), `the note starts as "Before the click" (${await titleOf()})`)
  const retitleContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const live = await openApp(retitleContext, '/')
    const seen = []
    live.on('request', request => seen.push(`${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, '')}`))
    live.on('pageerror', error => seen.push(`pageerror: ${error.message}`))
    const click = live.locator('button', { hasText: 'Retitle the note' }).first()
    await click.waitFor({ timeout: 30_000 })
    const answered = live.waitForResponse(answer => answer.request().method() === 'PATCH' && answer.url().includes(`/api/blog/notes/${ROW}`), { timeout: 30_000 }).catch(() => undefined)
    await click.click()
    const response = await answered
    check(!!response?.ok(), `a click on the Button sends the action's request (${response ? response.status() : `no request; the page made ${seen.filter(entry => !entry.includes('/_nuxt/')).join(', ') || 'only module loads'}`})`)
    check(await until(async () => (await titleOf()) === 'Retitled'), `and the row's title changes to "Retitled" (${await titleOf()})`)
  } finally {
    await retitleContext.close()
  }

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
}, { ignore: [/ERR_INCOMPLETE_CHUNKED_ENCODING/, /ERR_CONNECTION_(REFUSED|RESET)/] })
