import { describe, expect, it } from 'vitest'
import { ApiUrlSchema, CollectionSourceSchema } from '#shared/document/schema'

const api = (patch: object) => CollectionSourceSchema.safeParse({ type: 'api', url: 'https://api.example.com/x', itemsPath: '', ...patch })
const messages = (patch: object) => {
  const result = api(patch)
  return result.success ? [] : result.error.issues.map(i => i.message)
}

describe('api source URL with env refs', () => {
  it('accepts refs anywhere when stored and still checks what it can', () => {
    for (const url of ['https://rickandmortyapi.com/api/{{ env.API_PATH }}', '{{ env.BASE_URL }}/items', 'https://{{ env.HOST }}:{{ env.PORT }}/a', 'https://a.dev/?key={{ env.API_KEY }}']) {
      expect(ApiUrlSchema.safeParse(url).success, url).toBe(true)
    }
    expect(ApiUrlSchema.safeParse('ftp://a.dev/{{ env.X }}').success).toBe(false)
    expect(ApiUrlSchema.safeParse('http://a.dev:3000/{{ env.X }}').success).toBe(false)
    expect(ApiUrlSchema.safeParse('not a url').success).toBe(false)
  })

  it('refuses refs with names that cannot exist', () => {
    expect(ApiUrlSchema.safeParse('https://a.dev/{{ env.api_key }}').error?.issues[0]?.message).toBe('"api_key" is not a variable name: Variable names use capital letters, digits and _, starting with a letter (e.g. API_KEY)')
  })
})

describe('api source headers', () => {
  it('accepts up to 10 named headers, values may use env refs', () => {
    expect(api({ headers: [{ name: 'Authorization', value: 'Bearer {{ env.API_KEY }}' }, { name: 'X-Api-Version', value: '2' }] }).success).toBe(true)
    expect(api({}).success).toBe(true)
    expect(messages({ headers: Array.from({ length: 11 }, (_, i) => ({ name: `X-${i}`, value: '' })) })).toHaveLength(1)
  })

  it('refuses invalid, duplicate and connection-level header names, and line breaks in values', () => {
    expect(messages({ headers: [{ name: 'Bad Name', value: '1' }] })).toEqual(['Header names use letters, digits and - (e.g. Authorization)'])
    expect(messages({ headers: [{ name: 'x-key', value: '1' }, { name: 'X-Key', value: '2' }] })).toEqual(['The header "X-Key" is set twice'])
    expect(messages({ headers: [{ name: 'Host', value: 'a' }] })).toEqual(['The header "Host" cannot be set'])
    expect(messages({ headers: [{ name: 'X-A', value: 'a\r\nX-B: b' }] })).toEqual(['Header values cannot contain line breaks'])
  })
})
