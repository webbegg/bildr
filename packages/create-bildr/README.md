# create-bildr

Creates a new [bildr](https://github.com/webbegg/bildr) project: a Nuxt 4 app from the bildr starter kit, with `@bildr/nuxt` (the visual editor, dev only) in its devDependencies.

Install the command as a single executable, then create a project. On Windows (PowerShell), install with `powershell -c "irm https://github.com/webbegg/bildr/releases/latest/download/install.ps1 | iex"` instead of the curl line:

```bash
curl -fsSL https://github.com/webbegg/bildr/releases/latest/download/install.sh | sh
create-bildr my-app
cd my-app
pnpm install
pnpm dev
```

Or through npm, with nothing to install first:

```bash
pnpm create bildr my-app
```

The binaries (built with Bun from this package) and the install scripts are attached to each [GitHub Release](https://github.com/webbegg/bildr/releases); the binary creates projects that depend on `@bildr/nuxt` of its own version.

`nuxt dev` prints the editor link (`/__bildr?token=…`). The app is a normal Nuxt project: it builds and runs without bildr.

Options:

- `--name "My App"`: the project name (default: from the directory name).
- `--module main`: the first feature module (a Nuxt layer under `layers/`).
- `--database sqlite|none`: the app database. `sqlite` (default) gives a `main` sqlite data source with Drizzle, libSQL and migrations. `none` gives an API-only project: data comes from REST data sources, with no database code or dependencies and no migrations. To add a database later, add a sqlite data source in the editor, plus `@libsql/client`, `drizzle-orm` and `drizzle-kit` in `package.json`.
- `--bildr <spec>`: where `@bildr/nuxt` comes from, as a package.json spec: a version range, `file:<tarball>` or `link:<path>`. Default: `^<create-bildr's version>`.

The installed binary needs no Node, but running the created project (`pnpm install`, `pnpm dev`) needs Node 22.18 or newer and pnpm; `pnpm create bildr` needs them too.
