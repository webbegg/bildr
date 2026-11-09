import { describe, expect, it } from 'vitest'
import { requestGuardProblem } from '../../server/utils/requestGuard'

const json = 'application/json'

describe('requestGuardProblem', () => {
  it('allows same-origin and origin-less JSON requests (editor, curl, agents)', () => {
    expect(requestGuardProblem({ method: 'POST', contentType: json, origin: 'http://localhost:3000', host: 'localhost:3000' })).toBeNull()
    expect(requestGuardProblem({ method: 'POST', contentType: 'application/json; charset=utf-8', host: 'localhost:3000' })).toBeNull()
  })

  it('rejects bodies a cross-site form can send without a preflight', () => {
    for (const contentType of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain', undefined]) {
      expect(requestGuardProblem({ method: 'POST', contentType, host: 'localhost:3000' })).toMatchObject({ statusCode: 415 })
    }
  })

  it('rejects requests from another origin', () => {
    expect(requestGuardProblem({ method: 'POST', contentType: json, origin: 'https://evil.example', host: 'localhost:3000' }))
      .toMatchObject({ statusCode: 403 })
    expect(requestGuardProblem({ method: 'GET', origin: 'null', host: 'localhost:3000' })).toMatchObject({ statusCode: 403 })
  })

  it('rejects cross-origin writes whatever the body type', () => {
    for (const contentType of [json, 'Application/JSON', 'application/json;x', 'text/plain;application/json', 'text/plain', undefined]) {
      for (const origin of ['https://evil.example', 'null', 'http://localhost:3001', 'http://127.0.0.1:3000']) {
        expect(requestGuardProblem({ method: 'POST', contentType, origin, host: 'localhost:3000' })).toMatchObject({ statusCode: 403 })
      }
    }
  })

  it('treats JSON media types case- and parameter-insensitively, and nothing else as JSON', () => {
    for (const contentType of ['Application/JSON', 'application/json;x', ' application/json ; charset=utf-8']) {
      expect(requestGuardProblem({ method: 'POST', contentType, host: 'localhost:3000' })).toBeNull()
    }
    for (const contentType of ['text/plain;application/json', 'application/json, text/plain', 'application/jsonx', '']) {
      expect(requestGuardProblem({ method: 'POST', contentType, host: 'localhost:3000' })).toMatchObject({ statusCode: 415 })
    }
  })

  it('keeps same-origin editors on IPv6 and 127.0.0.1 working, and needs a Host to compare', () => {
    expect(requestGuardProblem({ method: 'POST', contentType: json, origin: 'http://[::1]:3000', host: '[::1]:3000' })).toBeNull()
    expect(requestGuardProblem({ method: 'POST', contentType: json, origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' })).toBeNull()
    expect(requestGuardProblem({ method: 'POST', contentType: json, origin: 'http://localhost:3000' })).toMatchObject({ statusCode: 403 })
  })

  it('does not require a JSON body on reads', () => {
    expect(requestGuardProblem({ method: 'GET', host: 'localhost:3000' })).toBeNull()
    expect(requestGuardProblem({ method: 'DELETE', host: 'localhost:3000' })).toBeNull()
  })
})
