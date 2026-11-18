// A state field named after an Object.prototype member breaks the generated setter's type (TS2345 on Partial<Omit<…>>).
import { describe, it } from 'vitest'
import { project } from './helpers'

describe('state field names the generated setter can type', () => {
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    it(`refuses a field named ${name} on create`, () => {
      const p = project()
      p.refuse('state_create', { name: 'odd', fields: [{ name, type: 'text', default: 'a' }, { name: 'flag', type: 'boolean', default: false }] }, 'invalid')
    })
  }

  it('refuses adding a field named constructor on update', () => {
    const p = project()
    p.refuse('state_update', { state: 'st_preferences', fields: [{ name: 'showDrafts', type: 'boolean', default: false }, { name: 'constructor', type: 'text', default: 'a' }] }, 'invalid')
  })
})
