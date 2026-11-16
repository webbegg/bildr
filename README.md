# bildr

A visual app builder where everything you can do in the editor, an agent can do too. A bildr project is a normal Nuxt 4 app plus a `.bildr/` folder: JSON files that describe its data sources, entities, queries, actions, pages, components, layouts and theme. The editor and agents edit those files through one set of actions, and bildr regenerates the app's clean-architecture code from them. The editor runs inside the app's own `nuxt dev`. A built app never includes bildr.

> [!WARNING]
> The editor API (`/__bildr`) writes your project's files. It only answers loopback clients that hold the session token from the dev server log, but it is meant for local development only: do not expose `nuxt dev` on a network. In dev mode, error responses also include stack traces.

## Run it

```bash
pnpm create bildr my-app
cd my-app
pnpm install
pnpm dev          # nuxt dev
```

`nuxt dev` prints the editor link, `/__bildr?token=…`. Open it: the token becomes an HttpOnly cookie for that session, and a new `nuxt dev` mints a new token. The app itself runs at <http://localhost:3000/>, next to the editor.

`create-bildr` takes `--name`, `--module`, `--database sqlite|none` and `--bildr <spec>` (see `packages/create-bildr`). Requires Node 22.18 or newer.

## The editor (`/__bildr`)

The editor is a Vue and Nuxt UI single-page app (`@bildr/editor`) that `@bildr/nuxt` serves while `nuxt dev` runs. Its screens:

- **Design**: pages, layers, components and layouts on a canvas with device frames, an inspector for props and styles, the theme and the design library, and the variant board. Edits are live in the running app.
- **Data**: data sources, entities and their fields, repositories and their endpoints, and the rows the app reads. Records are read-only here.
- **Model**: the `.bildr/` files as they are, with their validation problems.
- **View code**: the generated files and which ones you changed.
- **Health**: the project's checks (typecheck, lint, tests, build) and their results.
- **Migrations**: the pending database migration, when the project has a database.

Undo and redo (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z) work on every edit. ⌘K opens the quick actions.

## What a project holds

```text
.bildr/
  bildr.json, theme.json, manifest.json
  datasources/        # sqlite, rest or memory sources
  layouts/
  modules/<module>/   # module.json, entities/, repositories/, queries/, actions/,
                      # state/, components/, pages/, fixtures/
layers/<module>/      # generated Nuxt layer: pages, components, server code
layers/core/          # generated shared kernel, theme and app shell
```

`.bildr/` is the source of truth. Files under `layers/` that bildr generated carry a header and are rewritten on every change; edit one and it detaches from the editor, which reports it as drift. The root `app/` folder and `nuxt.config.ts` are yours.

## Edit through HTTP or MCP

The editor's operations are plain actions. Each one is a typed function with a schema, and the UI, HTTP and MCP all call the same ones, so an agent can do anything the editor can.

- HTTP: `POST /__bildr/api/actions/<name>` with a JSON body. Send the session token in the `x-bildr-token` header (or use the editor's cookie).
- MCP: `/__bildr/mcp`, with the same header. For example, `claude mcp add --transport http bildr http://localhost:3000/__bildr/mcp --header "x-bildr-token: <token>"`.
- Events: `/__bildr/api/events` streams changes, so an open editor shows an agent's edit within a moment.

`model_get` returns the loaded model and its problems, `model_file_put` writes a model file, and the node, page, component, layout, theme, entity and data-source actions edit it in a validated way. Every edit is one undo step.

## Working on bildr itself

This repository is a pnpm workspace; the root is not an app.

| Package | What it is |
| --- | --- |
| `packages/codegen` | The `.bildr/` model, the editing operations, the generator and the starter kit. Pure TypeScript. |
| `packages/editor-core` | The editor's format-independent logic: geometry, handles, style fields, colour. Workspace only. |
| `packages/editor` | The editor SPA and its canvas. Built to `packages/editor/dist`. |
| `packages/nuxt` | `@bildr/nuxt`: the dev-only Nuxt module that serves the editor and the actions. |
| `packages/create-bildr` | The `pnpm create bildr` scaffolder. |
| `fixtures/codegen/` | The golden generated apps (`blog`, `api-only`). Standalone projects, not in the workspace. |

```bash
pnpm install
pnpm build:editor      # packages/editor/dist, which @bildr/nuxt serves
pnpm build:packages    # tsc to dist/ for the published packages
```

`pnpm palettes` regenerates the Tailwind palette table in `packages/codegen/src/design/palettes.ts` after a Tailwind update.

## Browser tests

`e2e/` holds the browser suites. They add no dependency: they load a `playwright-core` and a Chromium that are already on your machine.

| Variable | Default |
| --- | --- |
| `PLAYWRIGHT_CORE` | `~/.t3/runtime/versions/0.1.6/node_modules/playwright-core/index.mjs` |
| `CHROMIUM` | `~/.cache/ms-playwright/chromium-1194/chrome-linux/chrome` |
| `E2E_TMP` | the OS temp dir (where the suites create their projects) |

If either binary is missing, the suite stops and names the variable to set.

- `pnpm e2e:module` drives the editor at `/__bildr`. It boots one project (create-bildr, the golden blog model, `nuxt dev` on a free port), runs each script in `e2e/module/` against it and prints PASS and FAIL counts per script. Name scripts to run some of them: `pnpm e2e:module shell visual-editor`. `node e2e/module/serve.mjs` keeps that project running, and prints the `E2E_MODULE_URL` and `E2E_MODULE_DIR` lines a single script takes (`node e2e/module/shell.mjs`).
- `pnpm e2e:generated` creates a project, models it through the editor's actions, builds and boots the generated app, and smoke-tests list, detail and create in a browser. It also takes `--install` (a real install), `--packed` (the packed npm tarballs) and `--database none`.

`e2e/module/parity-index.md` is a historical note: the differences accepted when the module editor was compared with the hosted editor it replaced.

## Checks

```bash
pnpm test         # vitest: packages/*/test (the editor package runs in happy-dom)
pnpm lint
pnpm typecheck    # every package
pnpm e2e:module
pnpm e2e:generated            # create, model, build, boot and smoke a generated app
pnpm e2e:generated --packed   # the same from the packed npm tarballs (real install)
pnpm e2e:generated --database none   # the same for an API-only project, against a stub REST source
```

The golden fixture is a standalone pnpm project. Install it once (`pnpm --dir fixtures/codegen/blog install`): the migration tests use its drizzle-kit.

## Generated apps with or without a database

`pnpm create bildr <dir> --database sqlite|none` picks the app database of a new generated project (see `packages/create-bildr`).

- `sqlite` (default): a `main` sqlite data source, Drizzle and libSQL, migrations under `server/database/migrations`, applied when the server starts.
- `none`: an API-only project. Data comes from REST or memory data sources. There is no database code, dependency, drizzle config, migrate plugin or migrations folder, and the editor hides its Migrations screen. `model_get` and `migration_pending_get` return `database: false`.

Entities, repositories, queries, actions and pages are the same model either way. Only the repository adapter differs: Drizzle for a sqlite data source, `fetch` for a REST one, and the in-memory adapter for a `memory` one.

A `memory` data source (`{ "kind": "memory", "env": {} }`, no settings) keeps its rows in the server process: one store per entity, seeded at boot from `.bildr/modules/<module>/fixtures/<entity>.json` and lost when the server stops. It needs no database and no API, so it suits prototypes and data the app owns but needn't keep. Its repositories have every operation and finders.

The editor's data actions (`datasource_*`, `entity_*`, `entity_field_*`) write these files. `entity_create` writes an entity with its repository, the queries `q_<plural>` and `q_<entity>_by_id`, the action `act_create_<entity>` and, for a memory source, its fixtures. `datasource_preview` and `repository_endpoint_test` GET a REST source's endpoints (under its base URL only, 10 s and 1 MB at most) and propose fields. `env_status` says which env vars the data sources need and whether each is set, never their values. Secrets are env vars only: you set them in `.env`.

A REST repository can list, get, create, update and delete. Each operation beyond `list` names its endpoint in `rest`, for example `"get": { "path": "/tasks/:id" }` or `"create": { "path": "/tasks" }`. The default methods are GET, POST, PUT and DELETE, and `method` overrides them. `fieldMap` maps fields both ways.

Adding a sqlite data source later turns the database on: the next sync generates the database layer. Removing the last one removes the generated database files, except those you edited (they become orphaned). `package.json` belongs to you, so bildr never changes it after creation. When you add a database, also add `@libsql/client`, `drizzle-orm` and `drizzle-kit` (and the `db:generate` script). The generated project README lists them.

## Releasing

`@bildr/codegen`, `@bildr/editor`, `@bildr/nuxt` and `create-bildr` are released together by `.github/workflows/release.yml` when a `v*` tag is pushed. Nothing is published before that.

Once:

1. Create the `bildr` organization on npmjs.com (the `@bildr` scope).
2. Add an npm automation token as the repository secret `NPM_TOKEN`.

Each release:

1. Set the same `version` in the four `packages/*/package.json`, and commit.
2. `git tag v<version> && git push origin v<version>`.

The workflow refuses a tag that differs from the package versions, runs lint, typecheck and tests, and publishes with provenance. To look at a package before releasing it: `pnpm --filter <package> pack`, then list the tarball.
