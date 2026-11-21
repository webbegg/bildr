import { describe, expect, it } from 'vitest'
import { fileKind, loadModel } from '../../src/model/load'
import { fixtureModelFiles } from './fixture'

const load = (files: Record<string, string>) => loadModel(files)
/** The fixture files with one file patched: keys are dotted paths (`root.children.1.props.x`), values replace what's there. */
const edit = (path: string, patch: Record<string, unknown>) => {
  const files = fixtureModelFiles()
  const json = JSON.parse(files[path]!)
  for (const [keyPath, value] of Object.entries(patch)) {
    const keys = keyPath.split('.')
    const parent = keys.slice(0, -1).reduce((node, key) => node[key], json)
    parent[keys.at(-1)!] = value
  }
  files[path] = JSON.stringify(json)
  return files
}
const problems = (files: Record<string, string>) => {
  const result = load(files)
  return result.ok ? [] : result.problems.map(problem => `${problem.path}: ${problem.message}`)
}

describe('fileKind', () => {
  it('maps .bildr paths to file kinds', () => {
    expect(fileKind('.bildr/bildr.json')).toBe('project')
    expect(fileKind('.bildr/manifest.json')).toBe('manifest')
    expect(fileKind('.bildr/datasources/main.json')).toBe('datasource')
    expect(fileKind('.bildr/layouts/main.json')).toBe('layout')
    expect(fileKind('.bildr/modules/blog/module.json')).toBe('module')
    expect(fileKind('.bildr/modules/blog/entities/post.json')).toBe('entity')
    expect(fileKind('.bildr/modules/blog/actions/create-post.json')).toBe('action')
    expect(fileKind('.bildr/modules/blog/pages/index.json')).toBe('page')
    expect(fileKind('.bildr/modules/blog/other/x.json')).toBeUndefined()
    expect(fileKind('.bildr/.cache/health.json')).toBeUndefined()
    // Only normalized paths: `.`/`..` segments, empty segments and leftovers of atomic writes are not model files.
    for (const path of ['.bildr/modules/../entities/x.json', '.bildr/modules/./entities/x.json', '.bildr/modules/../module.json', '.bildr//theme.json', '.bildr/datasources/./main.json', '.bildr/modules/blog/entities/post.json.tmp']) {
      expect(fileKind(path), path).toBeUndefined()
    }
  })
})

describe('loadModel on the golden fixture', () => {
  it('loads every file into one model', () => {
    const result = load(fixtureModelFiles())
    expect(result.ok ? [] : result.problems).toEqual([])
    if (!result.ok) return
    const blog = result.model.modules.blog!
    expect(result.model.project.name).toBe('Blog')
    expect(result.model.datasources.map(ds => ds.name)).toEqual(['catalog', 'main', 'quotes', 'weather'])
    expect(result.model.layouts.map(layout => layout.name)).toEqual(['main'])
    expect(Object.keys(result.model.modules)).toEqual(['blog'])
    expect(blog.entities.map(entity => entity.name)).toEqual(['Post', 'Quote'])
    expect(blog.repositories).toHaveLength(2)
    expect(blog.queries.map(query => query.name)).toEqual(['allPosts', 'featuredPosts', 'latestQuotes', 'postBySlug'])
    expect(blog.queries.find(query => query.name === 'featuredPosts')!.description).toBe('published posts, newest first, at most `limit`.')
    expect(blog.actions.map(action => action.name)).toEqual(['createPost', 'publishPost'])
    expect(blog.state.map(state => state.name)).toEqual(['preferences'])
    expect(blog.components.map(component => component.name)).toEqual(['PostCard', 'Tip'])
    expect(blog.pages.map(page => page.path)).toEqual(['/', '/posts/new', '/posts/:slug', '/catalog/:category', '/weather/:city'])
    expect(blog.fixtures[0]!.rows).toHaveLength(2)
    expect(result.model.manifest?.files['layers/blog/shared/domain/post.ts']?.owner).toBe('managed')
  })
})

describe('loadModel problems', () => {
  it('reports a project file that is valid JSON but not an object, instead of throwing (review RELIABILITY-003)', () => {
    for (const text of ['null', '42', '[]', '"x"']) {
      const files = fixtureModelFiles()
      files['.bildr/bildr.json'] = text
      const result = loadModel(files)
      expect(result.ok, text).toBe(false)
      expect(!result.ok && result.problems[0]!.path, text).toBe('.bildr/bildr.json')
    }
  })

  it('reports invalid JSON and schema errors with the file path', () => {
    const files = fixtureModelFiles()
    files['.bildr/theme.json'] = '{ nope'
    expect(problems(files)).toEqual([expect.stringMatching(/^\.bildr\/theme\.json: Invalid JSON/)])
    expect(problems(edit('.bildr/modules/blog/entities/post.json', { name: 'post' })))
      .toEqual([expect.stringMatching(/^\.bildr\/modules\/blog\/entities\/post\.json: name: /)])
  })

  it('requires bildr.json and refuses unknown files', () => {
    const files = fixtureModelFiles()
    delete files['.bildr/bildr.json']
    files['.bildr/modules/blog/notes/x.json'] = '{}'
    expect(problems(files)).toEqual([
      '.bildr/bildr.json: Missing project file',
      '.bildr/modules/blog/notes/x.json: Unknown model file'
    ])
  })

  it('refuses a schemaVersion newer than this bildr', () => {
    expect(problems(edit('.bildr/bildr.json', { schemaVersion: 99 })))
      .toEqual(['.bildr/bildr.json: schemaVersion 99 is newer than this bildr supports (1). Update bildr.'])
  })

  it('migrates older files step by step before validating', () => {
    const files = edit('.bildr/modules/blog/entities/post.json', { idStrategy: undefined, ids: 'uuid' })
    const migrate = (raw: Record<string, unknown>) => {
      const post = raw['.bildr/modules/blog/entities/post.json'] as Record<string, unknown>
      const { ids, ...rest } = post
      const project = raw['.bildr/bildr.json'] as Record<string, unknown>
      return { ...raw, '.bildr/bildr.json': { ...project, schemaVersion: 2 }, '.bildr/modules/blog/entities/post.json': { ...rest, idStrategy: ids } }
    }
    const result = loadModel(files, { current: 2, migrations: { 1: migrate } })
    expect(result.ok ? result.model.project.schemaVersion : result.problems).toBe(2)
    expect(problems(edit('.bildr/bildr.json', { schemaVersion: 1 })).length).toBe(0)
    const missing = loadModel(fixtureModelFiles(), { current: 2, migrations: {} })
    expect(missing).toEqual({ ok: false, problems: [{ path: '.bildr/bildr.json', message: 'No migration from schemaVersion 1 to 2' }] })
  })

  it('checks references across files', () => {
    expect(problems(edit('.bildr/modules/blog/repositories/post.json', { entity: 'ent_nope', datasource: 'ds_nope' })))
      .toEqual([
        '.bildr/modules/blog/repositories/post.json: entity: Unknown entity "ent_nope"',
        '.bildr/modules/blog/repositories/post.json: datasource: Unknown data source "ds_nope"'
      ])
    expect(problems(edit('.bildr/modules/blog/queries/all-posts.json', { from: 'ent_nope' })))
      .toEqual(['.bildr/modules/blog/queries/all-posts.json: from: Unknown entity "ent_nope"'])
    expect(problems(edit('.bildr/modules/blog/pages/index.json', { layout: 'lay_nope' })))
      .toEqual(['.bildr/modules/blog/pages/index.json: layout: Unknown layout "lay_nope"'])
    expect(problems(edit('.bildr/modules/blog/actions/create-post.json', { 'client.invalidates': ['ent_nope'] })))
      .toEqual(['.bildr/modules/blog/actions/create-post.json: client.invalidates.0: Unknown entity "ent_nope"'])
  })

  it('checks component instances and page links', () => {
    const files = edit('.bildr/modules/blog/pages/index.json', { 'root.children.1.children.0.props.component': 'cmp_nope' })
    expect(problems(files)).toEqual(['.bildr/modules/blog/pages/index.json: root.children.1.children.0.props.component: Unknown component "cmp_nope"'])
    expect(problems(edit('.bildr/layouts/main.json', { 'root.children.0.children.0.children.0.props.to.page': 'pg_nope' }))).toEqual(['.bildr/layouts/main.json: root.children.0.children.0.children.0.props.to.page: Unknown page "pg_nope"'])
  })

  it('checks node props against the render rules and toast steps for a title', () => {
    const index = '.bildr/modules/blog/pages/index.json'
    expect(problems(edit(index, { 'root.children.1.props.layout': 'masonry' })))
      .toEqual([`${index}: root.children.1.props.layout: layout must be one of stack, grid, row`])
    const toggle = 'root.children.0.children.1'
    expect(problems(edit(index, { [`${toggle}.interactions`]: [{ on: 'change', do: [{ kind: 'toast' }] }] })))
      .toEqual([`${index}: ${toggle}.interactions.0.do.0.title: A "toast" step needs a title`])
    expect(problems(edit(index, { [`${toggle}.interactions`]: [{ on: 'change', do: [{ kind: 'toast', title: 'Saved', color: 'pink' }] }] })))
      .toEqual([`${index}: ${toggle}.interactions.0.do.0.color: A toast color must be one of primary, secondary, success, info, warning, error, neutral`])
  })

  it('refuses duplicate ids and names', () => {
    const files = fixtureModelFiles()
    // The later file in path order is the duplicate.
    files['.bildr/modules/blog/entities/z-post.json'] = files['.bildr/modules/blog/entities/post.json']!
    expect(problems(files)).toEqual([
      '.bildr/modules/blog/entities/z-post.json: id: Duplicate id "ent_post" (also in .bildr/modules/blog/entities/post.json)',
      '.bildr/modules/blog/entities/z-post.json: name: Duplicate entity name "Post" in module "blog"'
    ])
  })

  it('refuses a module whose folder and name differ, and dependsOn cycles', () => {
    expect(problems(edit('.bildr/modules/blog/module.json', { name: 'news' })))
      .toEqual(['.bildr/modules/blog/module.json: name: Module name "news" must match its folder "blog"'])
    const files = edit('.bildr/modules/blog/module.json', { dependsOn: ['shop'] })
    files['.bildr/modules/shop/module.json'] = JSON.stringify({ id: 'mod_shop', name: 'shop', label: 'Shop', dependsOn: ['blog'] })
    expect(problems(files)).toEqual(['.bildr/modules/blog/module.json: dependsOn: Module dependency cycle: blog → shop → blog'])
  })

  it('refuses module names that collide with Nuxt aliases or the core layer', () => {
    const files = fixtureModelFiles()
    files['.bildr/modules/app/module.json'] = JSON.stringify({ id: 'mod_app', name: 'app', label: 'App', dependsOn: [] })
    files['.bildr/modules/core/module.json'] = JSON.stringify({ id: 'mod_core', name: 'core', label: 'Core', dependsOn: [] })
    expect(problems(files)).toEqual([
      '.bildr/modules/app/module.json: name: "app" is reserved (Nuxt aliases and the core layer use it)',
      '.bildr/modules/core/module.json: name: "core" is reserved (Nuxt aliases and the core layer use it)'
    ])
  })

  it('refuses an action without a repository step: nothing would do its work', () => {
    for (const steps of [[{ kind: 'validate' }], [{ kind: 'validate' }, { kind: 'assert', unless: { repository: 'repo_post', op: 'findBySlug', args: { slug: { $input: 'slug' } } }, error: 'slug_taken', errorData: { slug: { $input: 'slug' } } }]]) {
      expect(problems(edit('.bildr/modules/blog/actions/create-post.json', { steps })), JSON.stringify(steps))
        .toEqual(['.bildr/modules/blog/actions/create-post.json: steps: An action needs a "repository" step (create, update or delete), or a last "return" step that always runs ("if": true), to do its work'])
    }
  })

  it('accepts an action whose work is a last return step that always runs (a blank action), and still refuses one that only validates', () => {
    const path = '.bildr/modules/blog/actions/create-post.json'
    expect(problems(edit(path, { steps: [{ kind: 'validate' }, { kind: 'return', if: true, value: null }] }))).toEqual([])
    expect(problems(edit(path, { steps: [{ kind: 'validate' }] }))).toHaveLength(1)
  })

  it('refuses a return-only action whose return may not run: the use-case would have no answer on some runs', () => {
    const path = '.bildr/modules/blog/actions/create-post.json'
    const message = `${path}: steps: An action needs a "repository" step (create, update or delete), or a last "return" step that always runs ("if": true), to do its work`
    expect(problems(edit(path, { steps: [{ kind: 'return', if: { $input: 'id' }, value: null }] }))).toEqual([message])
    expect(problems(edit(path, { steps: [{ kind: 'return', if: false, value: null }] }))).toEqual([message, `${path}: steps.0: A "return" with "if": false never runs: remove the step`])
  })

  it('refuses a return that always runs before another step: the steps after it would never run', () => {
    const path = '.bildr/modules/blog/actions/create-post.json'
    const steps = JSON.parse(fixtureModelFiles()[path]!).steps
    expect(problems(edit(path, { steps: [{ kind: 'return', if: true, value: null }, ...steps] })))
      .toEqual([`${path}: steps.0: A "return" that always runs ("if": true) must be the last step: the steps after it would never run`])
  })

  it('keeps the repository step last: the use-case returns its result, so later steps would never run', () => {
    const path = '.bildr/modules/blog/actions/create-post.json'
    const steps = JSON.parse(fixtureModelFiles()[path]!).steps
    expect(problems(edit(path, { steps: [...steps, { kind: 'return', if: true, value: null }] })))
      .toEqual([`${path}: steps.2: A "repository" step must be the last step: the use-case returns its result`])
    // Two repository steps: the first one is not last, so only one can ever run.
    expect(problems(edit(path, { steps: [...steps, steps.at(-1)] })))
      .toEqual([`${path}: steps.2: A "repository" step must be the last step: the use-case returns its result`])
  })

  it('reserves createdAt and updatedAt on entities with timestamps, keeps them free without', () => {
    const path = '.bildr/modules/blog/entities/post.json'
    const post = JSON.parse(fixtureModelFiles()[path]!)
    expect(post.timestamps).toBe(true)
    const stamps = [{ id: 'fld_post_created', name: 'createdAt', type: 'datetime', required: true }, { id: 'fld_post_updated', name: 'updatedAt', type: 'datetime', required: true }]
    expect(problems(edit(path, { fields: [...post.fields, ...stamps] }))).toEqual([
      `${path}: fields.5.name: "createdAt" is reserved: timestamps adds it`,
      `${path}: fields.6.name: "updatedAt" is reserved: timestamps adds it`
    ])
    expect(problems(edit(path, { timestamps: false, fields: [...post.fields, ...stamps] }))).toEqual([])
  })

  it('keeps the id field to the idStrategy: reserved for "uuid", required for "external"', () => {
    const post = JSON.parse(fixtureModelFiles()['.bildr/modules/blog/entities/post.json']!)
    expect(problems(edit('.bildr/modules/blog/entities/post.json', { fields: [...post.fields, { id: 'fld_post_id', name: 'id', type: 'uuid', required: true }] })))
      .toEqual(['.bildr/modules/blog/entities/post.json: fields.5.name: "id" is reserved: the id comes from idStrategy "uuid"'])
    const quote = JSON.parse(fixtureModelFiles()['.bildr/modules/blog/entities/quote.json']!)
    expect(problems(edit('.bildr/modules/blog/entities/quote.json', { fields: quote.fields.filter((field: { name: string }) => field.name !== 'id') })))
      .toEqual(['.bildr/modules/blog/entities/quote.json: fields: idStrategy "external" needs an "id" field (the key its data source owns)'])
  })

  it('never stores secret values in data sources', () => {
    expect(problems(edit('.bildr/datasources/quotes.json', { 'defaults.apiKey': 'sk-live-123' })))
      .toEqual(['.bildr/datasources/quotes.json: defaults.apiKey: "apiKey" is a secret: set it with NUXT_DATASOURCES_QUOTES_API_KEY, never in the model'])
    expect(problems(edit('.bildr/datasources/quotes.json', { 'env.apiKey': 'sk-live-123' })))
      .toEqual([expect.stringMatching(/^\.bildr\/datasources\/quotes\.json: env\.apiKey: /)])
  })
})
