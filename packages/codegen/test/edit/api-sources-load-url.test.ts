// Simple data P1 verify: a hand-written api file keeps the edit rules (blocker 1 and its warnings).
import { describe, expect, it } from 'vitest'
import { datasourceEnvVars } from '../../src/edit/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'

const FILE = '.bildr/datasources/shop-api.json'
const file = (patch: Record<string, unknown>) => ({ id: 'ds_shop_api', name: 'shop-api', kind: 'api', env: { baseUrl: 'NUXT_DATASOURCES_SHOP_API_BASE_URL' }, baseUrl: 'https://x.example.com/v1', runtime: 'server', models: [], queries: [], actions: [], ...patch })
const load = (patch: Record<string, unknown>) => loadModel({ ...fixtureModelFiles(), [FILE]: JSON.stringify(file(patch)) })
const load_ = (baseUrl: string) => load({ baseUrl })

describe('a hand-written api file keeps the urlProblem rules', () => {
  it('loads a valid base URL', () => expect(load_('https://x.example.com/v1').ok).toBe(true))
  it('load refuses credentials in baseUrl', () => expect(load_('https://user:s3cret@x.example.com').ok).toBe(false))
  it('load refuses a query string in baseUrl', () => expect(load_('https://x.example.com/?token=abc').ok).toBe(false))
  it('load refuses a non-URL baseUrl', () => expect(load_('not a url').ok).toBe(false))
  it('load refuses a non-http baseUrl', () => expect(load_('javascript:alert(1)').ok).toBe(false))
})

describe('env names', () => {
  it('an api file needs the env var of its base URL', () => expect(load({ env: {} }).ok).toBe(false))

  it('the secret is not the base URL setting', () => {
    expect(project().refuse('api_create', { name: 'x', baseUrl: 'https://x.example.com', auth: { type: 'bearer', secret: 'baseUrl' } }, 'invalid').message)
      .toBe('"baseUrl" is the base URL setting: name the secret another way, like "apiKey"')
  })

  it('a rename re-derives the env names bildr gave; a user-named one stays', () => {
    const p = project()
    p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1', auth: { type: 'bearer' } })
    p.edit('api_update', { datasource: 'ds_shop_api', name: 'Store' })
    expect(p.json('.bildr/datasources/shop-api.json').env).toEqual({ baseUrl: 'NUXT_DATASOURCES_STORE_BASE_URL', apiKey: 'NUXT_DATASOURCES_STORE_API_KEY' })
    const own = project({ ...p.files, [FILE]: JSON.stringify({ ...p.json(FILE), env: { baseUrl: 'NUXT_MY_URL', apiKey: 'NUXT_DATASOURCES_STORE_API_KEY' } }) })
    own.edit('api_update', { datasource: 'ds_shop_api', name: 'Shop' })
    expect(own.json(FILE).env).toEqual({ baseUrl: 'NUXT_MY_URL', apiKey: 'NUXT_DATASOURCES_SHOP_API_KEY' })
  })

  it('env_status knows the model holds the base URL default', () => {
    const p = project()
    p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1' })
    expect(datasourceEnvVars(p.model()).find(entry => entry.datasource === 'ds_shop_api')).toMatchObject({ setting: 'baseUrl', hasDefault: true, secret: false })
  })
})

describe('the cycle check', () => {
  it('stays fast on a deep chain of shared models', () => {
    const models = Array.from({ length: 40 }, (_, index) => ({
      name: `M${index}`,
      fields: index === 39 ? [{ name: 'x', type: 'text' }] : [{ name: 'a', type: 'model', model: `M${index + 1}` }, { name: 'b', type: 'model', model: `M${index + 1}` }]
    }))
    const started = Date.now()
    expect(load({ models }).ok).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
