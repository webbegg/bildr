/**
 * Whether a directory holds a bildr starter-kit project (decision D9). The
 * module and the CLI only work on these; anything else gets the reasons and a
 * pointer to `pnpm create bildr`. Pure: the caller reads the files.
 */

/** Every starter-kit project has these. The database ones (drizzle-orm, @libsql/client) only come with a sqlite data source (V7). */
export const STARTER_KIT_DEPENDENCIES = ['nuxt', 'zod', '@tanstack/vue-db', '@tanstack/query-db-collection', '@bildr/nuxt'] as const

export const STARTER_KIT_HINT = 'bildr only runs on projects created from its starter kit. Create one with: pnpm create bildr <name>'

export type StarterKitCheck = { ok: true } | { ok: false, reasons: string[], hint: string }

/** `read` returns a project file's text, or undefined when it doesn't exist. */
export const detectStarterKit = (read: (path: string) => string | undefined): StarterKitCheck => {
  const reasons: string[] = []

  const project = read('.bildr/bildr.json')
  if (project === undefined) reasons.push('No .bildr/bildr.json: this is not a bildr project')
  else {
    let parsed: unknown
    try {
      parsed = JSON.parse(project)
    } catch {
      reasons.push('.bildr/bildr.json is not valid JSON')
    }
    if (parsed !== undefined) {
      const { starterKit, schemaVersion } = (parsed ?? {}) as { starterKit?: unknown, schemaVersion?: unknown }
      if (typeof starterKit !== 'string' || typeof schemaVersion !== 'number') reasons.push('.bildr/bildr.json was not created by the bildr starter kit')
    }
  }

  if (read('layers/core/nuxt.config.ts') === undefined) reasons.push('No layers/core: the starter kit\'s core layer is missing')

  const pkg = read('package.json')
  let deps: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(pkg ?? '{}') as { dependencies?: Record<string, unknown>, devDependencies?: Record<string, unknown> }
    deps = { ...parsed.dependencies, ...parsed.devDependencies }
  } catch {
    reasons.push('package.json is not valid JSON')
  }
  const missing = STARTER_KIT_DEPENDENCIES.filter(name => !(name in deps))
  if (missing.length) reasons.push(`Missing dependencies: ${missing.join(', ')}`)

  return reasons.length ? { ok: false, reasons, hint: STARTER_KIT_HINT } : { ok: true }
}
