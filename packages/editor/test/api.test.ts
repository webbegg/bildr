import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionCallError, callAction } from '../src/api.ts'

const respond = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callAction', () => {
  it('posts the input as JSON to the action endpoint with the session cookie and returns the result', async () => {
    const fetchMock = respond(200, { ok: true, result: { sha256: 'f00' } })
    vi.stubGlobal('fetch', fetchMock)

    const result = await callAction('model_file_put', { path: '.bildr/x.json', content: '{}\n' })

    expect(result).toEqual({ sha256: 'f00' })
    expect(fetchMock).toHaveBeenCalledWith('/__bildr/api/actions/model_file_put', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '.bildr/x.json', content: '{}\n' })
    })
  })

  it('throws an ActionCallError with code, message and problems from an error body', async () => {
    const problems = [{ path: '.bildr/modules/blog/entities/post.json', message: 'Unknown entity "ent_x"' }]
    vi.stubGlobal('fetch', respond(422, { ok: false, code: 'invalid', message: 'The model is invalid', problems }))

    const error = await callAction('model_file_put', {}).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ActionCallError)
    expect(error).toMatchObject({ code: 'invalid', message: 'The model is invalid', problems })
  })

  it('maps each documented error code without problems', async () => {
    for (const [status, code] of [[400, 'invalid_input'], [403, 'forbidden'], [404, 'not_found'], [501, 'unavailable']] as const) {
      vi.stubGlobal('fetch', respond(status, { ok: false, code, message: `failed ${code}` }))
      const error = await callAction('health_get', {}).catch((caught: unknown) => caught) as ActionCallError
      expect(error).toBeInstanceOf(ActionCallError)
      expect(error.code).toBe(code)
      expect(error.message).toBe(`failed ${code}`)
      expect(error.problems).toBeUndefined()
    }
  })

  it('reports a non-JSON response as bad_response with the HTTP status', async () => {
    vi.stubGlobal('fetch', respond(500, '<html>oops</html>'))
    await expect(callAction('health_get', {})).rejects.toMatchObject({ code: 'bad_response', message: expect.stringContaining('500') })
  })

  it('reports a failed request as network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    await expect(callAction('health_get', {})).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('Failed to fetch') })
  })
})
