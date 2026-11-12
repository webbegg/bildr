import { MANIFEST_FILE, PROJECT_FILE, THEME_FILE } from './load.ts'
import type { Model, ModuleModel } from './load.ts'

/** The canonical text of a model file: two-space JSON plus a trailing newline. Key order is the schema order `loadModel` produced. */
export const stringifyModelFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()

const MODULE_PARTS = ['entities', 'repositories', 'queries', 'actions', 'state', 'components', 'pages', 'fixtures'] as const satisfies ReadonlyArray<keyof ModuleModel>

/**
 * Writes a model back to its `.bildr/` files (path → text). Artifacts keep the
 * path they were loaded from; new ones get `<folder>/<kebab name>.json`.
 * Deterministic: the same model always gives the same bytes.
 */
export const serializeModel = (model: Model): Record<string, string> => {
  const files: Record<string, string> = {}
  const write = (path: string, value: unknown) => {
    files[path] = stringifyModelFile(value)
  }

  write(PROJECT_FILE, model.project)
  if (model.theme) write(THEME_FILE, model.theme)
  if (model.manifest) {
    const sorted = Object.fromEntries(Object.keys(model.manifest.files).sort().map(path => [path, model.manifest!.files[path]]))
    write(MANIFEST_FILE, { ...model.manifest, files: sorted })
  }
  for (const source of model.datasources) write(model.paths[source.id] ?? `.bildr/datasources/${source.name}.json`, source)
  for (const layout of model.layouts) write(model.paths[layout.id] ?? `.bildr/layouts/${layout.name}.json`, layout)

  for (const [folder, mod] of Object.entries(model.modules)) {
    const base = `.bildr/modules/${folder}`
    write(`${base}/module.json`, mod.module)
    for (const part of MODULE_PARTS) {
      for (const item of mod[part] as Array<{ id?: string, name?: string, entity?: string }>) {
        const key = part === 'fixtures' ? `fixtures:${item.entity}` : item.id!
        const fallback = part === 'fixtures'
          ? kebab(mod.entities.find(entity => entity.id === item.entity)?.name ?? item.entity!)
          : kebab(item.name ?? item.id!)
        write(model.paths[key] ?? `${base}/${part}/${fallback}.json`, item)
      }
    }
  }
  return Object.fromEntries(Object.keys(files).sort().map(path => [path, files[path]!]))
}
