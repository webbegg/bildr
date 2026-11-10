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

/** Secrets shorter than this are redacted only as whole tokens, so they do not mangle the words around them. */
const REDACT_IN_WORDS_MIN = 4
const WORD_CHAR = '[\\p{L}\\p{N}_]'
const WORD_START = new RegExp(`^${WORD_CHAR}`, 'u')
const WORD_END = new RegExp(`${WORD_CHAR}$`, 'u')

/**
 * The forms a URL parser turns `secret` into as a host (lowercased,
 * punycode), a path segment and a query, kept only when the parse covers
 * the whole secret (no `/`, `?`, `#` and the like cutting it short, no
 * whitespace the parser strips).
 */
function urlForms(secret: string): string[] {
  if (/[\t\n\r#]/.test(secret) || secret.charCodeAt(secret.length - 1) <= 32) return []
  const forms: string[] = []
  const add = (make: () => string) => {
    try {
      const form = make()
      if (form) forms.push(form)
    } catch {
      // Not valid in that part of a URL, so it never shows there in that form.
    }
  }
  if (!/[/?@:\\]/.test(secret)) add(() => new URL(`http://${secret}`).hostname)
  if (!/[/?\\]/.test(secret)) add(() => new URL(`http://x/${secret}`).pathname.slice(1))
  add(() => new URL(`http://x/?${secret}`).search.slice(1))
  return forms
}

/**
 * Replaces every secret value in `text` (as is, URL-encoded and in the
 * forms a URL normalises it to, ignoring case, since URL hosts are
 * lowercased) with •••; longest first, so overlaps are fully covered.
 * Secrets shorter than 4 characters are replaced only as whole tokens.
 */
export function redact(text: string, secrets: string[]): string {
  const forms = new Map<string, boolean>()
  for (const secret of secrets) {
    if (!secret) continue
    const short = secret.length < REDACT_IN_WORDS_MIN
    for (const form of [secret, encodeURIComponent(secret), encodeURI(secret), ...urlForms(secret)]) {
      forms.set(form, short && (forms.get(form) ?? true))
    }
  }
  if (!forms.size) return text
  const patterns = [...forms].sort(([a], [b]) => b.length - a.length).map(([form, short]) => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!short) return escaped
    // A token boundary, like \b but Unicode-aware, at the ends that are word characters.
    const before = WORD_START.test(form) ? `(?<!${WORD_CHAR})` : ''
    const after = WORD_END.test(form) ? `(?!${WORD_CHAR})` : ''
    return `${before}${escaped}${after}`
  })
  return text.replace(new RegExp(patterns.join('|'), 'giu'), REDACTED)
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
