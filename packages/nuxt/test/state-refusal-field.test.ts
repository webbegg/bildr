// B2 review: a refusal about one field of a state carries `field: { id?, name }` next to its message, additively (a refusal about
// something else has none), so the editor shows it next to that field without reading the message.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const blog = fileURLToPath(new URL('../../../fixtures/codegen/blog/.bildr', import.meta.url))
let root: string
let handle: ReturnType<typeof createBildrHandler>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bildr-state-field-'))
  cpSync(blog, join(root, '.bildr'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"name":"blog","private":true}')
  handle = createBildrHandler({ root, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const act = (name: string, body: unknown) => handle(new Request(`http://localhost:3000/__bildr/api/actions/${name}`, {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000', 'x-bildr-token': TOKEN, 'content-type': 'application/json' }
}), { remoteAddress: '127.0.0.1' })

describe('a state_update refusal about one field', () => {
  it('says which field, by id and name, in the error body', async () => {
    const response = await act('state_update', { state: 'st_preferences', fields: [{ id: 'fld_show_drafts', name: 'drafts', type: 'boolean', default: false }] })
    const body = await response.json() as { ok: boolean, code: string, message: string, field?: unknown }
    expect(response.status).toBe(422)
    expect(body).toMatchObject({ ok: false, code: 'invalid', field: { id: 'fld_show_drafts', name: 'showDrafts' } })
    expect(body.message).toContain('is still used')
  })

  it('names an entry that has no id by the name it was given', async () => {
    const response = await act('state_update', { state: 'st_preferences', fields: [{ id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false }, { name: 'id', type: 'text' }] })
    const body = await response.json() as { field?: unknown }
    expect(response.status).toBe(422)
    expect(body.field).toEqual({ name: 'id' })
  })

  it('has no field for a refusal about the state', async () => {
    const response = await act('state_update', { state: 'st_nope', label: 'x' })
    expect(response.status).toBe(404)
    expect(await response.json()).not.toHaveProperty('field')
  })
})
