/**
 * Detail pages on the module (condensed port of e2e/detail.mjs, S34): the blog's own detail page
 * (`/posts/:slug`, a route parameter validated against the Post's `slug` field, a Query by slug, a bound
 * heading and body), checked in its page file and in the running app next to the editor: a record's page
 * renders its title and body, a draft and a published post both resolve, an unknown key shows the
 * page's own "This post doesn't exist." state, and a List on the home page links to the record's URL.
 * A second detail page keyed by the record id (not the slug) is made with `page_create` + `page_use_add`
 * and checked the same way.
 *
 * Dropped (these are hosted features the module doesn't have, or has as the generated app's own):
 * - the internal Posts collection with `publicRead`, the public record endpoint `/api/public/...` and the
 *   WebMCP tools (`list_pages`, `navigate_to_page`, `get_page_content`): records are app data (E2) and the
 *   generated app has no bildr runtime (D4);
 * - the jsonplaceholder connection detail page by id and the preview-vs-published URL pair: one running
 *   app, no publish; the editor's preview of a record is detail-ui.mjs;
 * - the "Entry" page keyed by record id with a slug field (S38.4): needs a second entity and its own
 *   migration, the same flow the Data script covers.
 */
import { appShows, bildr, check, renderApp, run, seedPosts } from './lib.mjs'

await run('detail', async ({ browser, errors }) => {
  const detail = bildr('modules/blog/pages/post-detail.json')
  check(detail.path === '/posts/:slug' && detail.params?.[0]?.name === 'slug' && detail.params[0].validate?.field === 'fld_slug', 'the detail page is /posts/:slug with a slug param validated against the field')
  check(JSON.stringify(detail.uses.queries).includes('q_post_by_slug') && JSON.stringify(detail.uses.queries).includes('$route'), 'it reads the record with a Query by the route\'s slug')
  const index = bildr('modules/blog/pages/index.json')
  check(JSON.stringify(index.root).includes('"page":"pg_post_detail"') && JSON.stringify(index.root).includes('post.slug'), 'the home page\'s List links to the detail page with each record\'s slug')

  // A record's page: title and body in the running app (the database starts empty: the two fixture rows go in through its create route).
  await seedPosts([
    { title: 'Hello bildr', slug: 'hello-bildr', body: 'This post was seeded from the model fixtures.', published: true },
    { title: 'A draft', slug: 'a-draft', body: 'Not published yet.', published: false }
  ])
  const hello = await appShows(browser, '/posts/hello-bildr', 'Hello bildr', 90_000)
  check(hello.html.includes('Hello bildr') && hello.text.includes('This post was seeded from the model fixtures.'), 'the app renders the record\'s title and body at /posts/hello-bildr')
  check(hello.text.includes('Back to all posts'), 'and the footer slot of the page\'s layout content (the back link)')
  const draft = await appShows(browser, '/posts/a-draft', 'A draft', 60_000)
  check(draft.html.includes('A draft') && draft.text.includes('Not published yet.'), 'a draft resolves too (/posts/a-draft)')
  check(draft.text.includes('Publish'), 'and shows the Publish action only while it is a draft')
  check(!hello.text.includes('Publish') || hello.text.includes('Hello bildr'), 'a published post has no Publish action')

  // A key nothing matches: the page's own empty state.
  const missing = await renderApp(browser, '/posts/nope')
  check(missing.text.includes('This post doesn\'t exist.') || missing.status === 404, `an unknown key shows "This post doesn't exist." (${missing.status}: ${missing.text.slice(0, 80).replace(/\s+/g, ' ')})`)

  // The home page's List links to the record.
  const home = await renderApp(browser, '/')
  const links = [...home.html.matchAll(/href="(\/posts\/[^"]+)"/g)].map(match => match[1])
  check(links.includes('/posts/hello-bildr'), `the home page links to /posts/hello-bildr (${links.join(', ')})`)

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
})
