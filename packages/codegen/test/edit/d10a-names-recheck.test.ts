import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import type { EditName } from '../../src/edit/index'
import { project } from './helpers'

/** S10, "every new item is valid": names the generated app or Nuxt already declare are refused with no change; neighbours of them are not. */

const refused: Array<[EditName, unknown]> = [
  ['action_create', { entity: 'ent_post', template: 'blank', name: 'describe' }],
  ['action_create', { entity: 'ent_post', template: 'blank', name: 'expect' }],
  ['action_create', { entity: 'ent_post', template: 'blank', name: 'it' }],
  ['action_create', { entity: 'ent_post', template: 'create', name: 'input' }],
  ['action_create', { entity: 'ent_post', template: 'update', name: 'result' }],
  ['action_create', { entity: 'ent_post', template: 'blank', name: 'live query' }],
  ['action_create', { entity: 'ent_post', template: 'delete', name: 'Toast' }],
  ['query_create', { entity: 'ent_post', result: 'many', name: 'Live Query' }],
  ['query_create', { entity: 'ent_post', result: 'one', name: 'Route' }],
  ['query_create', { entity: 'ent_post', result: 'many', name: 'scriptStripe' }],
  ['query_rename', { query: 'q_all_posts', name: 'liveQuery' }],
  ['query_rename', { query: 'q_all_posts', name: 'route' }],
  ['action_rename', { action: 'act_create_post', name: 'input' }],
  ['action_rename', { action: 'act_publish_post', name: 'liveQuery' }],
  ['action_rename', { action: 'act_publish_post', name: 'toast' }]
]

const accepted: Array<[EditName, unknown]> = [
  ['query_create', { entity: 'ent_post', result: 'many', name: 'describe' }],
  ['query_create', { entity: 'ent_post', result: 'many', name: 'input' }],
  ['query_create', { entity: 'ent_post', result: 'many', name: 'routes' }],
  ['query_create', { entity: 'ent_post', result: 'many', name: 'scripted' }],
  ['query_create', { entity: 'ent_post', result: 'many', name: 'scriptures' }],
  ['action_create', { entity: 'ent_post', template: 'blank', name: 'inputs' }],
  ['action_create', { entity: 'ent_post', template: 'blank', name: 'describePost' }],
  ['query_rename', { query: 'q_all_posts', name: 'describe' }],
  ['entity_create', { name: 'route', source: 'ds_main', fields: [{ name: 'title', type: 'text', required: true }] }],
  ['entity_create', { name: 'toast', source: 'ds_main', fields: [{ name: 'title', type: 'text', required: true }] }]
]

describe('reserved query and action names (recheck)', () => {
  it.each(refused)('%s %j is refused and changes nothing', (edit, input) => {
    const files = project().files
    const before = JSON.stringify(files)
    const outcome = applyEdit(files, edit, input)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('invalid')
    expect(JSON.stringify(files)).toBe(before)
  })

  it.each(accepted)('%s %j is accepted', (edit, input) => {
    project().edit(edit, input)
  })
})
