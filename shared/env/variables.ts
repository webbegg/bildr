import { z } from 'zod'

/**
 * Project environment variables, stored outside the document (`env:<id>`),
 * so they are never in `project_get`, the undo history or change events.
 * Public ones resolve anywhere as `{{ env.NAME }}` and ship with the
 * published snapshot; secret ones resolve on the server only (API sources)
 * and are write-only: no action returns their value.
 */

export const ENV_NAME = /^[A-Z][A-Z0-9_]*$/
export const ENV_NAME_HINT = 'Variable names use capital letters, digits and _, starting with a letter (e.g. API_KEY)'
export const ENV_NAME_MAX = 64
export const ENV_VALUE_MAX_BYTES = 4096
export const ENV_MAX_VARS = 100
export const REDACTED = '•••'

export const EnvNameSchema = z.string().max(ENV_NAME_MAX).regex(ENV_NAME, ENV_NAME_HINT)
export const EnvValueSchema = z.string().refine(value => byteLength(value) <= ENV_VALUE_MAX_BYTES, 'A variable value can be at most 4 KB')

export const EnvVarSchema = z.object({ name: EnvNameSchema, value: EnvValueSchema, secret: z.boolean() })
export const EnvVarsSchema = z.array(EnvVarSchema).max(ENV_MAX_VARS).superRefine((vars, ctx) => {
  const names = new Set<string>()
  vars.forEach((v, i) => {
    if (names.has(v.name)) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: `The variable "${v.name}" already exists` })
    names.add(v.name)
  })
})

export type EnvVar = z.infer<typeof EnvVarSchema>
/** Name → value, as resolution reads them. */
export type EnvValues = Record<string, string>

/** What `env_list` shows: secrets say they are set, never their value. */
export type EnvListEntry = { name: string, secret: false, value: string } | { name: string, secret: true, set: true }

/** `{{ env.NAME }}`; any identifier is captured, so a misspelt name can be reported. */
export const ENV_REF = /\{\{\s*env\.([A-Za-z_]\w*)\s*\}\}/g

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function hasEnvRefs(text: string): boolean {
  return new RegExp(ENV_REF.source).test(text)
}

/** The names `text` references, each once, in order. */
export function envRefs(text: string): string[] {
  return [...new Set([...text.matchAll(ENV_REF)].map(m => m[1]!))]
}

export interface ResolveEnvOptions {
  /** A name missing from `vars`: kept as written (default), rendered empty, or replaced by what the function returns (it may throw). */
  onMissing?: 'keep' | 'empty' | ((name: string) => string)
}

export function resolveEnv(text: string, vars: EnvValues, { onMissing = 'keep' }: ResolveEnvOptions = {}): string {
  if (!text.includes('{{')) return text
  return text.replace(ENV_REF, (ref, name: string) => {
    if (Object.hasOwn(vars, name)) return vars[name]!
    if (onMissing === 'keep') return ref
    return onMissing === 'empty' ? '' : onMissing(name)
  })
}

/**
 * Replaces every secret value in `text` (as is and URL-encoded, ignoring
 * case, since URL hosts are lowercased) with •••; longest first, so
 * overlaps are fully covered.
 */
export function redact(text: string, secrets: string[]): string {
  const forms = new Set<string>()
  for (const secret of secrets) {
    if (!secret) continue
    forms.add(secret)
    forms.add(encodeURIComponent(secret))
    forms.add(encodeURI(secret))
  }
  if (!forms.size) return text
  const escaped = [...forms].sort((a, b) => b.length - a.length).map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return text.replace(new RegExp(escaped.join('|'), 'gi'), REDACTED)
}

export function publicEnv(vars: EnvVar[]): EnvValues {
  return Object.fromEntries(vars.filter(v => !v.secret).map(v => [v.name, v.value]))
}

export function allEnv(vars: EnvVar[]): EnvValues {
  return Object.fromEntries(vars.map(v => [v.name, v.value]))
}

export function secretValues(vars: EnvVar[]): string[] {
  return vars.filter(v => v.secret).map(v => v.value)
}

export function envListEntry(v: EnvVar): EnvListEntry {
  return v.secret ? { name: v.name, secret: true, set: true } : { name: v.name, secret: false, value: v.value }
}

export function envList(vars: EnvVar[]): EnvListEntry[] {
  return vars.map(envListEntry)
}

export interface EnvSetInput {
  name: string
  value?: string
  secret?: boolean
}

/**
 * Creates or updates a variable. Left out, `value` and `secret` keep their
 * current values (a new variable needs a value and is public by default);
 * turning a secret public needs a new value, so it is never revealed.
 */
export function setEnvVar(vars: EnvVar[], { name, value, secret }: EnvSetInput): { vars: EnvVar[] } | { problem: string } {
  if (!EnvNameSchema.safeParse(name).success) return { problem: ENV_NAME_HINT }
  if (value !== undefined && byteLength(value) > ENV_VALUE_MAX_BYTES) return { problem: 'A variable value can be at most 4 KB' }
  const index = vars.findIndex(v => v.name === name)
  const current = vars[index]
  if (!current) {
    if (value === undefined) return { problem: `The new variable "${name}" needs a value` }
    if (vars.length >= ENV_MAX_VARS) return { problem: `A project can have at most ${ENV_MAX_VARS} variables` }
    return { vars: [...vars, { name, value, secret: secret ?? false }] }
  }
  if (current.secret && secret === false && value === undefined) return { problem: `Turning the secret "${name}" public needs a new value` }
  const next = [...vars]
  next[index] = { name, value: value ?? current.value, secret: secret ?? current.secret }
  return { vars: next }
}
