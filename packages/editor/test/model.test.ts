import { describe, expect, it } from 'vitest'
import { artifactLabel, entityFiles, groupFiles, kindOfPath } from '../src/model.ts'
import { MAIN_PATH, POST_PATH, mainFile, moduleFile, postFile } from './fixtures.ts'

/**
 * The `.bildr/` model files the Data screen's "All model files" lists (S3): which kind a path is, the files
 * grouped by kind, and the files a collection is linked to. They are read from the files `model_get` returns,
 * so they hold while the model has problems.
 */

const REPOSITORY_PATH = '.bildr/modules/blog/repositories/post.json'
const FIXTURES_PATH = '.bildr/modules/blog/fixtures/post.json'
const QUERY_PATH = '.bildr/modules/blog/queries/featured-posts.json'
const OTHER_QUERY_PATH = '.bildr/modules/blog/queries/latest-quotes.json'
const PAGE_PATH = '.bildr/modules/blog/pages/index.json'

const files = () => ({
  '.bildr/bildr.json': { schemaVersion: 1 },
  '.bildr/theme.json': { colors: {} },
  [MAIN_PATH]: mainFile(),
  [POST_PATH]: postFile(),
  '.bildr/modules/blog/module.json': moduleFile(),
  [REPOSITORY_PATH]: { id: 'repo_post', entity: 'ent_post', datasource: 'ds_main' },
  [FIXTURES_PATH]: { entity: 'ent_post', rows: [] },
  [QUERY_PATH]: { id: 'q_featured_posts', name: 'featuredPosts', label: 'Featured posts', from: 'ent_post' },
  [OTHER_QUERY_PATH]: { id: 'q_latest_quotes', name: 'latestQuotes', from: 'ent_quote' },
  [PAGE_PATH]: { id: 'pg_index', name: 'index' },
  '.bildr/layouts/main.json': { id: 'lay_main', name: 'main' }
})

describe('the kind of a model file', () => {
  it.each([
    ['.bildr/bildr.json', 'project'],
    ['.bildr/theme.json', 'theme'],
    [MAIN_PATH, 'datasource'],
    ['.bildr/layouts/main.json', 'layout'],
    ['.bildr/modules/blog/module.json', 'module'],
    [POST_PATH, 'entity'],
    [REPOSITORY_PATH, 'repository'],
    [QUERY_PATH, 'query'],
    ['.bildr/modules/blog/actions/create-post.json', 'action'],
    ['.bildr/modules/blog/state/preferences.json', 'state'],
    ['.bildr/modules/blog/components/tip.json', 'component'],
    [PAGE_PATH, 'page'],
    [FIXTURES_PATH, 'fixtures']
  ])('is read from the path %s: %s', (path, kind) => {
    expect(kindOfPath(path)).toBe(kind)
  })

  it('is none for what is not a model file, or is not a normalized path', () => {
    for (const path of ['.bildr/manifest.json', '.bildr/.cache/x.json', '.bildr/modules/blog/notes/x.json', '.bildr/modules/../x/entities/a.json', 'package.json']) expect(kindOfPath(path)).toBeUndefined()
  })
})

describe('the files grouped by kind', () => {
  it('lists every model file under its kind, named for the item, in the order a person looks for them', () => {
    const groups = groupFiles(files())
    expect(groups.map(group => group.label)).toEqual(['Project', 'Theme', 'Connections', 'Layouts', 'Modules', 'Collections', 'Repositories', 'Queries', 'Pages', 'Sample data'])
    expect(groups.find(group => group.kind === 'entity')?.files).toEqual([{ path: POST_PATH, label: 'Post' }])
    expect(groups.find(group => group.kind === 'query')?.files.map(file => file.label)).toEqual(['featuredPosts', 'latestQuotes'])
    expect(groups.find(group => group.kind === 'fixtures')?.files).toEqual([{ path: FIXTURES_PATH, label: 'post' }])
  })

  it('leaves out the manifest and anything that is not a model file, and has no group for a kind with no file', () => {
    const groups = groupFiles({ ...files(), '.bildr/manifest.json': {}, '.bildr/.cache/x.json': {} })
    expect(groups.flatMap(group => group.files.map(file => file.path))).not.toContain('.bildr/manifest.json')
    expect(groups.flatMap(group => group.files.map(file => file.path))).not.toContain('.bildr/.cache/x.json')
    expect(groups.some(group => group.kind === 'action')).toBe(false)
  })

  it('still lists a file whose JSON is not the shape of its kind (a broken model)', () => {
    const groups = groupFiles({ [POST_PATH]: 'oops' as never })
    expect(groups).toEqual([{ kind: 'entity', label: 'Collections', files: [{ path: POST_PATH, label: 'post' }] }])
    expect(artifactLabel(undefined, POST_PATH)).toBe('post')
  })
})

describe('the files a collection is linked to', () => {
  it('starts with its own file, then its repository, its sample data and the queries that read it', () => {
    expect(entityFiles(files(), POST_PATH)).toEqual([
      { path: POST_PATH, label: 'Collection' },
      { path: REPOSITORY_PATH, label: 'Repository' },
      { path: FIXTURES_PATH, label: 'Sample data' },
      { path: QUERY_PATH, label: 'Query featuredPosts' }
    ])
  })

  it('is just its own file when nothing else names it', () => {
    expect(entityFiles({ [POST_PATH]: postFile() }, POST_PATH)).toEqual([{ path: POST_PATH, label: 'Collection' }])
  })

  it('is just the file when it does not say which collection it is', () => {
    expect(entityFiles({ [POST_PATH]: { name: 'Post' }, [REPOSITORY_PATH]: { entity: 'ent_post' } }, POST_PATH)).toEqual([{ path: POST_PATH, label: 'Collection' }])
  })
})
