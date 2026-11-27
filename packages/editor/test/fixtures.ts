/** A small `.bildr/` model as `model_get` returns it: one module `blog` with an entity, plus one top-level data source. */

export const POST_PATH = '.bildr/modules/blog/entities/post.json'
export const MAIN_PATH = '.bildr/datasources/main.json'

export const postFile = () => ({
  $schema: 'https://bildr.dev/schema/entity.v1.json',
  id: 'ent_post',
  name: 'Post',
  plural: 'posts',
  idStrategy: 'uuid',
  timestamps: true,
  fields: [
    { id: 'fld_title', name: 'title', type: 'text', required: true, min: 1, max: 120 }
  ],
  relations: [],
  client: { sync: 'eager', limit: 500 }
})

export const mainFile = () => ({
  $schema: 'https://bildr.dev/schema/datasource.v1.json',
  id: 'ds_main',
  name: 'main',
  kind: 'sqlite',
  env: { url: 'NUXT_DB_URL' },
  defaults: { url: 'file:.data/app.db' }
})

export const moduleFile = () => ({
  $schema: 'https://bildr.dev/schema/module.v1.json',
  id: 'mod_blog',
  name: 'blog',
  label: 'Blog',
  dependsOn: []
})

export const modelResult = () => ({
  ok: true,
  model: {
    project: { schemaVersion: 1, generatorVersion: '0.2.0', starterKit: 'default', name: 'Demo', defaultModule: 'blog', modules: ['blog'] },
    datasources: [mainFile()],
    layouts: [],
    modules: {
      blog: {
        module: moduleFile(),
        entities: [postFile()],
        repositories: [],
        queries: [],
        actions: [],
        state: [],
        components: [],
        pages: [],
        fixtures: []
      }
    },
    paths: { ent_post: POST_PATH, ds_main: MAIN_PATH, mod_blog: '.bildr/modules/blog/module.json' }
  },
  files: {
    '.bildr/bildr.json': { schemaVersion: 1 },
    [MAIN_PATH]: mainFile(),
    '.bildr/modules/blog/module.json': moduleFile(),
    [POST_PATH]: postFile()
  }
})

export const healthReport = () => ({
  updatedAt: '2026-11-13T09:00:00.000Z',
  model: { ok: true },
  drift: {
    missingManifest: false,
    files: [
      { path: 'layers/blog/app/pages/index.vue', state: 'detached', diff: '--- generated\n+++ disk\n@@ -1 +1 @@\n-<h1>Posts</h1>\n+<h1>My posts</h1>\n' }
    ]
  },
  migration: null,
  checks: {
    lint: {
      name: 'lint',
      ok: false,
      startedAt: '2026-11-13T09:00:00.000Z',
      durationMs: 1300,
      summary: '1 boundary violation',
      findings: [
        { file: 'layers/blog/app/pages/index.vue', line: 3, message: 'Import of server code from the app', rule: 'no-restricted-imports', boundary: true },
        { file: 'layers/blog/app/components/x.vue', line: 9, message: 'Unused variable', rule: 'no-unused-vars' }
      ]
    }
  }
})

export const pendingPlan = () => ({
  hash: 'abc123',
  destructive: ['DROP TABLE `blog_notes`;'],
  losing: ['Table "blog_notes" and all its rows'],
  statements: ['DROP TABLE `blog_notes`;']
})
