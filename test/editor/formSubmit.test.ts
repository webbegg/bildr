import { describe, expect, it } from 'vitest'
import { formSubmitRequest } from '#shared/editor/formSubmit'

describe('formSubmitRequest', () => {
  const values = { email: 'ana@example.com' }

  it('creates the record with record_create in the draft preview, which has no public endpoint', () => {
    expect(formSubmitRequest({ kind: 'draft', projectId: 'p1' }, 'messages', values)).toEqual({
      via: 'action',
      name: 'record_create',
      input: { projectId: 'p1', collection: 'messages', values }
    })
  })

  it('posts to the public data endpoint in a published app', () => {
    expect(formSubmitRequest({ kind: 'published', projectSlug: 'cafe' }, 'messages', values)).toEqual({
      via: 'http',
      url: '/api/public/cafe/messages',
      body: { values }
    })
  })
})
