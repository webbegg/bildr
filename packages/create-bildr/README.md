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
- `--bildr <spec>`: where `@bildr/nuxt` comes from, as a package.json spec: a version range, `file:<tarball>` or `link:<path>`. Default: `^<create-bildr's version>`.

Requires Node 22.18 or newer.
