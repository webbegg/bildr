import { describe, expect, it } from 'vitest'
import { ENV_MAX_VARS, envList, envRefs, publicEnv, redact, resolveEnv, secretValues, setEnvVar } from '#shared/env/variables'
import type { EnvVar } from '#shared/env/variables'

const VARS: EnvVar[] = [
  { name: 'API_PATH', value: 'character', secret: false },
  { name: 'API_KEY', value: 'sk_test_SECRET123', secret: true }
]

describe('envRefs', () => {
  it('lists each referenced name once, in order', () => {
    expect(envRefs('https://x.dev/{{ env.API_PATH }}?k={{env.API_KEY}}&p={{ env.API_PATH }}')).toEqual(['API_PATH', 'API_KEY'])
    expect(envRefs('{{ item.name }} plain')).toEqual([])
  })
})

describe('resolveEnv', () => {
  const vars = { API_PATH: 'character' }

  it('replaces env refs with their values, keeping other text and item bindings', () => {
    expect(resolveEnv('/api/{{ env.API_PATH }}/{{ item.id }}', vars)).toBe('/api/character/{{ item.id }}')
  })

  it('keeps unknown refs as written by default, or renders them empty', () => {
    expect(resolveEnv('[{{ env.NOPE }}]', vars)).toBe('[{{ env.NOPE }}]')
    expect(resolveEnv('[{{ env.NOPE }}]', vars, { onMissing: 'empty' })).toBe('[]')
  })

  it('calls onMissing with the name when given a function', () => {
    const onMissing = (name: string): never => {
      throw new Error(`missing ${name}`)
    }
    expect(() => resolveEnv('{{ env.NOPE }}', vars, { onMissing })).toThrow('missing NOPE')
  })

  it('does not treat inherited object keys as variables', () => {
    expect(resolveEnv('{{ env.constructor }}', vars, { onMissing: 'empty' })).toBe('')
  })
})

describe('redact', () => {
  it('replaces each secret value, also URL-encoded, with •••', () => {
    expect(redact('Could not resolve sk_test_SECRET123.example.com', ['sk_test_SECRET123'])).toBe('Could not resolve •••.example.com')
    expect(redact('GET /a?k=a%20b%2Fc', ['a b/c'])).toBe('GET /a?k=•••')
    expect(redact('nothing here', ['', 'x y'])).toBe('nothing here')
  })

  it('ignores case, since URL hosts are lowercased', () => {
    expect(redact('Could not resolve sk_test_secret123.example.com', ['sk_test_SECRET123'])).toBe('Could not resolve •••.example.com')
    expect(redact('a.b+c', ['.B+'])).toBe('a•••c')
  })

  it('also replaces the punycode host form and the forms a URL normalises to', () => {
    expect(redact('Could not resolve xn--bcher-kva.example.com', ['Bücher'])).toBe('Could not resolve •••.example.com')
    expect(redact('GET /a?k=a%27b%20c', ['a\'b c'])).toBe('GET /a?k=•••')
    expect(redact('GET /a|b%20c', ['a|b c'])).toBe('GET /•••')
  })

  it('only uses URL forms that cover the whole secret', () => {
    expect(redact('abcdef is fine', ['abcd/e'])).toBe('abcdef is fine')
    expect(redact('GET /b', ['a/../b'])).toBe('GET /b')
  })

  it('replaces secrets shorter than 4 characters only as whole tokens', () => {
    expect(redact('Could not resolve res.example.com', ['res'])).toBe('Could not resolve •••.example.com')
    expect(redact('k=ab&ab2=x', ['ab'])).toBe('k=•••&ab2=x')
    expect(redact('k=abcd', ['abcd'])).toBe('k=•••')
  })
})

describe('publicEnv, secretValues and envList', () => {
  it('splits public values from secret ones', () => {
    expect(publicEnv(VARS)).toEqual({ API_PATH: 'character' })
    expect(secretValues(VARS)).toEqual(['sk_test_SECRET123'])
  })

  it('lists secrets without their value', () => {
    expect(envList(VARS)).toEqual([
      { name: 'API_PATH', secret: false, value: 'character' },
      { name: 'API_KEY', secret: true, set: true }
    ])
  })
})

describe('setEnvVar', () => {
  it('adds a variable and updates one in place', () => {
    const added = setEnvVar([], { name: 'A', value: '1' })
    expect(added).toEqual({ vars: [{ name: 'A', value: '1', secret: false }] })
    expect(setEnvVar(VARS, { name: 'API_PATH', value: 'episode' })).toEqual({ vars: [{ ...VARS[0], value: 'episode' }, VARS[1]] })
  })

  it('keeps the value when only the secret flag changes to secret', () => {
    expect(setEnvVar(VARS, { name: 'API_PATH', secret: true })).toEqual({ vars: [{ ...VARS[0], secret: true }, VARS[1]] })
  })

  it('needs a new value to turn a secret public', () => {
    expect(setEnvVar(VARS, { name: 'API_KEY', secret: false })).toEqual({ problem: 'Turning the secret "API_KEY" public needs a new value' })
    expect(setEnvVar(VARS, { name: 'API_KEY', secret: false, value: 'open' })).toEqual({ vars: [VARS[0], { name: 'API_KEY', value: 'open', secret: false }] })
  })

  it('refuses bad names, missing or oversized values and too many variables', () => {
    expect(setEnvVar([], { name: 'api_key', value: '1' })).toEqual({ problem: 'Variable names use capital letters, digits and _, starting with a letter (e.g. API_KEY)' })
    expect(setEnvVar([], { name: 'A' })).toEqual({ problem: 'The new variable "A" needs a value' })
    expect(setEnvVar([], { name: 'A', value: 'é'.repeat(2049) })).toEqual({ problem: 'A variable value can be at most 4 KB' })
    const full = Array.from({ length: ENV_MAX_VARS }, (_, i) => ({ name: `V${i}`, value: '', secret: false }))
    expect(setEnvVar(full, { name: 'MORE', value: '1' })).toEqual({ problem: `A project can have at most ${ENV_MAX_VARS} variables` })
    expect(setEnvVar(full, { name: 'V1', value: '2' })).toHaveProperty('vars')
  })
})
