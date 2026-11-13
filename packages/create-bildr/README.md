# create-bildr

Creates a new [bildr](https://github.com/webbegg/bildr) project: a Nuxt 4 app from the bildr starter kit, with `@bildr/nuxt` (the visual editor, dev only) in its devDependencies.

```bash
pnpm create bildr my-app
cd my-app
pnpm install
pnpm dev
```

`nuxt dev` prints the editor link (`/__bildr?token=…`). The app is a normal Nuxt project: it builds and runs without bildr.

Options:

- `--name "My App"`: the project name (default: from the directory name).
- `--module main`: the first feature module (a Nuxt layer under `layers/`).
- `--database sqlite|none`: the app database. `sqlite` (default) gives a `main` sqlite data source with Drizzle, libSQL and migrations. `none` gives an API-only project: data comes from REST data sources, with no database code or dependencies and no migrations. To add a database later, add a sqlite data source in the editor, plus `@libsql/client`, `drizzle-orm` and `drizzle-kit` in `package.json`.
- `--bildr <spec>`: where `@bildr/nuxt` comes from, as a package.json spec: a version range, `file:<tarball>` or `link:<path>`. Default: `^<create-bildr's version>`.

Requires Node 22.18 or newer.
