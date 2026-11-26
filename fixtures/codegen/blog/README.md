# Blog

A Nuxt 4 app built with bildr. It's a normal Nuxt project: it runs, builds and deploys without the bildr editor.

## Run it

```sh
pnpm install
pnpm dev            # http://localhost:3000 (migrations apply on start)
pnpm db:seed        # with `pnpm dev` running: load the model's sample posts
pnpm build && node .output/server/index.mjs
```

Copy `.env.example` to `.env` to change the database URL or the data source credentials.

## Layout

| Path | What it is | Who owns it |
|---|---|---|
| `.bildr/` | The model the editor saves: modules, entities, repositories, queries, actions, pages, components, layouts, theme. `manifest.json` lists the files bildr generated. | bildr editor |
| `layers/core/` | Shared kernel (`Result`, `Page`, ids), database client, migrations on boot, HTTP error mapping, query client, theme, app shell, layouts. | generated |
| `layers/<module>/` | One Nuxt layer per feature module, for example `layers/blog/`. | generated |
| `app/`, `server/` | Your code. Files here override the same path in any layer. | you |
| `server/database/migrations/` | Drizzle migrations. Written once, never regenerated. | you |
| `nuxt.config.ts`, `package.json` | Project config. Written once by the starter kit. | you |

## Inside a module layer

Dependencies point inward only. ESLint enforces it (`pnpm lint`).

```
shared/domain/            entities (zod schemas + types) and domain errors: no Vue, no Nitro
server/application/       use-cases and repository ports: plain functions, no framework
server/infrastructure/    adapters: Drizzle tables and repositories, REST repositories, seeds
server/api/               thin HTTP handlers: validate, call a use-case, map errors
server/utils/<module>.ts  composition root: wires use-cases to adapters
app/data/                 TanStack DB collections (client copies of entities, UI state)
app/composables/<module>/ queries (live queries) and actions (optimistic, server-confirmed)
app/components, app/pages the UI; components only use composables
test/                     use-case, adapter and API tests
```

## Inside the apis layer

An API data source gets `layers/apis/`, in the same rings. They all live under `shared/`, because a source can run on the server or in the page:

```
shared/domain/<source>/          entities (zod schemas + types) and the source's errors
shared/application/<source>/     the repository port (ports/), one use-case per query (queries/) and action (actions/)
shared/infrastructure/<source>/  what the API sends (models/, validations/), mappers, the HTTP repository
server/utils/<source>.ts         composition root of a source that runs on the server, with its routes in server/api/apis/
app/data/<source>.ts             composition of a source that runs in the page
app/composables/apis/            one composable per query and action
```

## Changing generated code

- **Prefer overriding.** Put a file at the same path under the root `app/` or `server/`. Nuxt uses yours, and bildr keeps updating its own copy.
- **Editing a generated file is allowed.** bildr notices the edit, marks the file *detached* in `.bildr/manifest.json`, and stops overwriting it. The editor shows it as drift. You can reattach it later, which replaces your edits with the generated version.
- **Custom logic** for an action goes in `server/application/custom/`. You own those files, and bildr only imports them.

## Scripts

`dev`, `build`, `preview`, `typecheck`, `lint`, `test` (unit and API tests), `db:generate` (new migration after entity changes), `db:seed`.
