import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import { generate } from '../../src/generate/index'
import { applyChanges, project } from './helpers'

/**
 * D10a (S10), "every new item is valid", second verification: a name the generated test file or a composable file
 * already declares, or one a Nuxt composable already has, gives an app that doesn't build or silently loses the
 * generated composable. Plus the checks no other test isolates (mutation gaps).
 */

describe('a name the generated test file or composable file already declares is refused', () => {
  it.each(['describe', 'expect', 'it'])('action %s', (name) => {
    project().refuse('action_create', { entity: 'ent_post', template: 'blank', name }, 'invalid')
  })

  it('a create action named "input"', () => {
    const p = project()
    p.edit('action_update', { action: 'act_create_post', http: { path: '/posts/legacy' } })
    p.refuse('action_create', { entity: 'ent_post', template: 'create', name: 'input' }, 'invalid')
  })

  it('a query named liveQuery', () => {
    project().refuse('query_create', { entity: 'ent_post', result: 'many', name: 'liveQuery' }, 'invalid')
  })

  it('an action named liveQuery', () => {
    project().refuse('action_create', { entity: 'ent_post', template: 'blank', name: 'liveQuery' }, 'invalid')
  })

  it.each([
    ['query_create', { entity: 'ent_post', result: 'many', name: 'route' }],
    ['action_create', { entity: 'ent_post', template: 'delete', name: 'toast' }]
  ])('%s %j (a Nuxt composable name)', (edit, input) => {
    project().refuse(edit as 'query_create', input, 'invalid')
  })

  it('says which composable the name would generate and who already provides it', () => {
    expect(project().refuse('query_create', { entity: 'ent_post', result: 'many', name: 'route' }, 'invalid').message).toContain('`route` would generate useRoute, which Nuxt already provides')
    expect(project().refuse('action_create', { entity: 'ent_post', template: 'delete', name: 'toast' }, 'invalid').message).toContain('`toast` would generate useToast, which Nuxt UI already provides')
    expect(project().refuse('query_create', { entity: 'ent_post', result: 'many', name: 'liveQuery' }, 'invalid').message).toContain('`liveQuery` would generate useLiveQuery')
    expect(project().refuse('action_create', { entity: 'ent_post', template: 'blank', name: 'describe' }, 'invalid').message).toContain('"describe" is declared by the generated test')
  })

  it.each([
    'route', 'router', 'state', 'fetch', 'asyncData', 'head', 'runtimeConfig', 'nuxtApp', 'cookie', 'error', 'lazyFetch', 'seoMeta', // Nuxt
    'attrs', 'slots', 'templateRef', 'id', 'model', // Vue
    'link', // vue-router
    'toast', 'overlay', 'formField', 'kbd', // Nuxt UI
    'colorMode', // @nuxtjs/color-mode
    'script', 'scriptGoogleAnalytics', // Nuxt Scripts
    'variantState' // the project's core layer
  ])('rename to %s, for a query and for an action', (name) => {
    project().refuse('query_rename', { query: 'q_all_posts', name }, 'invalid')
    project().refuse('action_rename', { action: 'act_publish_post', name }, 'invalid')
  })

  it.each(['describe', 'expect', 'it', 'input', 'result'])('rename an action to %s', (name) => {
    project().refuse('action_rename', { action: 'act_publish_post', name }, 'invalid')
  })

  it('a query keeps a name only an action cannot take ("describe" is only a composable, useDescribe)', () => {
    project().edit('query_create', { entity: 'ent_post', result: 'many', name: 'describe' })
  })

  it('still takes a name next to the reserved ones', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'routeStops' })
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'itemise' })
  })
})

describe('what the generator declares is in the reserved set (drift guard)', () => {
  const generated = () => generate(project().model())

  it('every const the generated use-case tests declare is refused as an action name', () => {
    const names = new Set<string>(['describe', 'expect', 'it'])
    for (const file of generated().filter(entry => /\/test\/application\/.*\.test\.ts$/.test(entry.path))) {
      for (const match of file.content.matchAll(/^\s*const (\w+) =/gm)) names.add(match[1]!)
      for (const match of file.content.matchAll(/^import \{([^}]+)\} from '(?![./#])[^']+'/gm)) for (const name of match[1]!.split(',')) names.add(name.trim())
    }
    expect([...names]).toEqual(expect.arrayContaining(['input', 'result', 'describe']))
    for (const name of names) project().refuse('action_create', { entity: 'ent_post', template: 'blank', name }, 'invalid')
  })

  it('every use… a generated composable imports from a package is refused as the query or action that would declare it', () => {
    const names = new Set<string>()
    for (const file of generated().filter(entry => /\/app\/composables\//.test(entry.path))) {
      for (const match of file.content.matchAll(/^import \{([^}]+)\} from '(?![./#])[^']+'/gm)) {
        for (const name of match[1]!.split(',').map(entry => entry.trim())) if (/^use[A-Z]/.test(name)) names.add(name.slice(3, 4).toLowerCase() + name.slice(4))
      }
    }
    expect([...names]).toContain('liveQuery')
    for (const name of names) {
      project().refuse('query_create', { entity: 'ent_post', result: 'many', name }, 'invalid')
      project().refuse('action_create', { entity: 'ent_post', template: 'blank', name }, 'invalid')
    }
  })
})

describe('checks no other test isolates', () => {
  it('create on an entity with a required read-only field and no default is refused; with a default the use-case sets it', () => {
    const p = project()
    p.edit('entity_create', { name: 'badge', source: 'ds_main', fields: [{ name: 'label', type: 'text', required: true }, { name: 'code', type: 'text', required: true }] })
    p.edit('action_delete', { action: 'act_create_badge' })
    const path = '.bildr/modules/blog/entities/badge.json'
    const entity = p.json(path)
    entity.fields[1].readonly = true
    const files = { ...p.files, [path]: `${JSON.stringify(entity, null, 2)}\n` }
    const outcome = applyEdit(files, 'action_create', { entity: 'ent_badge', template: 'create', name: 'addBadge' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).toContain('read-only field (code)')
    entity.fields[1].default = 'x'
    const withDefault = { ...files, [path]: `${JSON.stringify(entity, null, 2)}\n` }
    const filled = applyEdit(withDefault, 'action_create', { entity: 'ent_badge', template: 'create', name: 'addBadge' })
    expect(filled.ok).toBe(true)
    if (filled.ok) expect(JSON.parse(applyChanges(withDefault, filled.changes)['.bildr/modules/blog/actions/add-badge.json']!).steps[1].set).toEqual({ code: 'x' })
  })

  it('a return with a value on an action with no output is refused', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    p.refuse('action_update', { action: 'act_tidy_posts', steps: [{ kind: 'return', if: true, value: 'x' }] }, 'invalid')
  })

  it('a page argument that no longer fits a parameter only pages read is refused', () => {
    const p = project()
    p.edit('query_update', { query: 'q_all_posts', inPlace: true, params: [{ name: 'x', type: 'text', default: 'a' }] })
    p.edit('page_use_add', { page: 'pg_index', as: 'everything', query: 'q_all_posts', args: { x: 'abc' } })
    expect(p.refuse('query_update', { query: 'q_all_posts', inPlace: true, params: [{ name: 'x', type: 'integer', default: 1 }] }, 'invalid').message).toContain('passes "abc"')
  })
})

describe('routes that name one file', () => {
  it('a trailing slash is the same route: refused as a route clash, not by the duplicate-path backstop', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'sweepPosts' })
    const message = p.refuse('action_update', { action: 'act_sweep_posts', http: { path: '/posts/tidy-posts/' } }, 'invalid').message
    expect(message).toContain('already answers POST /posts/tidy-posts')
    expect(message).not.toContain('would both generate')
  })

  it('routes that differ only by letter case are one file on a case-insensitive file system: refused', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'sweepPosts' })
    expect(p.refuse('action_update', { action: 'act_sweep_posts', http: { path: '/posts/Tidy-Posts' } }, 'invalid').message).toContain('would both generate')
  })
})
