import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import type { ApiSource } from '../../src/edit/api'
import { apiNameClaims, apiSourceIdentifiers } from '../../src/edit/generated-names'
import { API_DECLARED_NAMES, JS_RESERVED_WORDS, LINT_RESTRICTED_FOLDERS } from '../../src/edit/reserved-names'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { project } from './helpers'

/**
 * Simple data S7 / P2 (verify B1, B2, B4): a name the generated API code can't take is refused where it is given (the `api_*` edits)
 * and where a hand-written file carries it (the generator throws, so every edit refuses the model). Plus the drift guard: what the
 * generated API files declare or import is in the lists these refusals use.
 */

const SHOP = '.bildr/datasources/shop.json'
const ITEM = { name: 'Item', fields: [{ name: 'id', type: 'integer' }] }
const items = (name: string, model = 'Item') => ({ name, path: `/${name}`, params: [], result: { model, many: true } })

const shop = (input: Record<string, unknown> = {}) => {
  const p = project()
  p.edit('api_create', { name: 'shop', baseUrl: 'https://shop.example.com', ...input })
  p.edit('api_model_set', { datasource: 'ds_shop', model: ITEM })
  return p
}

describe('a query or an action named like a reserved word is refused', () => {
  it.each(['delete', 'class', 'new', 'constructor', 'function', 'default', 'yield', 'await', 'arguments', 'eval', 'undefined'])('query %s', (name) => {
    const message = shop().refuse('api_query_set', { datasource: 'ds_shop', query: items(name) }, 'invalid').message
    expect(message).toBe(`API "shop": "${name}" is a reserved word, so the query can't be a function of that name: pick another name`)
  })

  it('an action, and a rename to one', () => {
    const p = shop()
    expect(p.refuse('api_action_set', { datasource: 'ds_shop', action: { name: 'new', method: 'POST', path: '/new', params: [] } }, 'invalid').message).toContain('"new" is a reserved word, so the action')
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('list') })
    p.refuse('api_query_rename', { datasource: 'ds_shop', query: 'list', name: 'delete' }, 'invalid')
    p.edit('api_action_set', { datasource: 'ds_shop', action: { name: 'remove', method: 'DELETE', path: '/x', params: [] } })
    p.refuse('api_action_rename', { datasource: 'ds_shop', action: 'remove', name: 'class' }, 'invalid')
  })

  it('every word of the list is a name no query can take', () => {
    // One project for every word: a refused edit changes nothing (a new one each made the test slow enough to time out in CI).
    const p = shop()
    for (const name of JS_RESERVED_WORDS) {
      if (!/^[a-z][A-Za-z0-9]*$/.test(name)) continue
      p.refuse('api_query_set', { datasource: 'ds_shop', query: items(name) }, 'invalid')
    }
  })
})

describe('a name the generated files import or declare is refused', () => {
  it.each(['remoteFailed', 'invalidAnswer', 'invalidInput', 'useRuntimeConfig', 'createHttpClient', 'resultClient', 'failure', 'httpShopRepository', 'fakeShopRepository', 'z', 'ok', 'err', 'describe', 'segment', 'shop', 'useShopApi', 'shopClient', 'shopErrorStatus'])('query %s', (name) => {
    const message = shop().refuse('api_query_set', { datasource: 'ds_shop', query: items(name) }, 'invalid').message
    expect(message).toContain(`API "shop": the query "${name}" would be named ${name}`)
    expect(message).toContain('pick another name')
  })

  it('says what already has the name', () => {
    expect(shop().refuse('api_query_set', { datasource: 'ds_shop', query: items('remoteFailed') }, 'invalid').message)
      .toBe('API "shop": the query "remoteFailed" would be named remoteFailed, which is already declared or imported by the generated files (the error helpers of the domain): pick another name')
    expect(shop().refuse('api_query_set', { datasource: 'ds_shop', query: items('fakeShopRepository') }, 'invalid').message).toContain('already the name of the fake repository of the API "shop"')
  })

  it('a query and an action of one name, two operations of one file, a query like a model mapper', () => {
    const p = shop()
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('getUrl') })
    expect(p.refuse('api_query_set', { datasource: 'ds_shop', query: items('getURL') }, 'invalid').message).toContain('would both generate the file get-url.ts')
    expect(p.refuse('api_query_set', { datasource: 'ds_shop', query: items('toItem') }, 'invalid').message).toContain('already the name of the mapper to the domain of the model Item')
  })

  it('a model named like something a file declares', () => {
    for (const name of ['ShopRepository', 'ShopError', 'Promise', 'Error', 'Record', 'ApiClient', 'ZodType', 'ItemDto', 'ItemSchema']) {
      const message = shop().refuse('api_model_set', { datasource: 'ds_shop', model: { name, fields: [{ name: 'id', type: 'integer' }] } }, 'invalid').message
      expect(message, name).toContain('pick another name')
    }
  })

  // T3b (R3 RELIABILITY-001): the HTTP repository checks a path parameter into `<param>Segment` and a text header one into `<param>Header`.
  it('a name like the checked value of a path or text header parameter, but not the same parameter used twice', () => {
    const p = shop()
    p.edit('api_query_set', { datasource: 'ds_shop', query: { name: 'item', path: '/items/:id', params: [{ name: 'id', in: 'path', type: 'integer' }, { name: 'locale', in: 'header', type: 'text' }], result: { model: 'Item', many: false } } })
    // A second operation with the same `id`: one local per method, claimed once.
    p.edit('api_action_set', { datasource: 'ds_shop', action: { name: 'removeItem', method: 'DELETE', path: '/items/:id', params: [{ name: 'id', in: 'path', type: 'integer' }] } })
    expect(p.refuse('api_query_set', { datasource: 'ds_shop', query: items('idSegment') }, 'invalid').message).toContain('the checked value of the path parameter "id" in the HTTP repository would be named idSegment, which is already the name of the query "idSegment"')
    expect(p.refuse('api_query_set', { datasource: 'ds_shop', query: items('localeHeader') }, 'invalid').message).toContain('the checked value of the header parameter "locale" in the HTTP repository would be named localeHeader')
    // A model whose mapper would be the local: `toSegment` next to a path parameter `to`.
    p.edit('api_query_set', { datasource: 'ds_shop', query: { name: 'route', path: '/routes/:to', params: [{ name: 'to', in: 'path', type: 'text' }], result: { model: 'Item', many: false } } })
    expect(p.refuse('api_model_set', { datasource: 'ds_shop', model: { name: 'Segment', fields: [{ name: 'id', type: 'integer' }] } }, 'invalid').message).toContain('toSegment')
  })

  it('a model that uses a use-case\'s own type', () => {
    const p = shop()
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('products') })
    expect(p.refuse('api_model_set', { datasource: 'ds_shop', model: { name: 'ProductsInput', fields: [{ name: 'id', type: 'integer' }] } }, 'invalid').message).toContain('ProductsInputSchema, which is already the name of the zod schema of the model ProductsInput')
  })

  it('a composable a package already provides, as for a query of a module', () => {
    const p = project()
    p.edit('api_create', { name: 'script', baseUrl: 'https://script.example.com' })
    p.edit('api_model_set', { datasource: 'ds_script', model: ITEM })
    expect(p.refuse('api_query_set', { datasource: 'ds_script', query: items('googleAnalytics') }, 'invalid').message).toContain('useScriptGoogleAnalytics, which Nuxt Scripts already provides')
  })

  it('a model named Result is fine: the kernel one is imported under an alias', () => {
    const p = shop()
    p.edit('api_model_set', { datasource: 'ds_shop', model: { name: 'Result', fields: [{ name: 'id', type: 'integer' }] } })
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('results', 'Result') })
    const use = generate(p.model()).find(file => file.path === 'layers/apis/shared/application/shop/queries/results.ts')!.content
    expect(use).toContain('import type { Result as KernelResult } from \'#core/kernel/result\'')
    expect(use).toContain('import type { Result } from \'../../../domain/shop/entities/result\'')
  })
})

describe('a source name and a secret name the generated code can\'t take', () => {
  it.each(LINT_RESTRICTED_FOLDERS)('a source named %s (its folders would trip the lint of the app)', (name) => {
    const message = project().refuse('api_create', { name, baseUrl: 'https://x.example.com' }, 'invalid').message
    expect(message).toBe(`API "${name}": "${name}" is a folder name the generated app's lint rules refuse in an import path (app, server, infrastructure): pick another name`)
  })

  it('a rename to one', () => {
    const p = shop()
    p.refuse('api_update', { datasource: 'ds_shop', name: 'app' }, 'invalid')
    expect(p.json(SHOP).name).toBe('shop')
  })

  it('a source named constructor, and a secret named constructor', () => {
    expect(project().refuse('api_create', { name: 'constructor', baseUrl: 'https://x.example.com' }, 'invalid').message).toContain('settings key `constructor`')
    expect(project().refuse('api_create', { name: 'x', baseUrl: 'https://x.example.com', auth: { type: 'bearer', secret: 'constructor' } }, 'invalid').message).toContain('"constructor" can\'t be the name of a secret')
  })

  it.each(['class', 'headers', 'call', 'baseUrl2', 'secret', 'config'])('a secret named %s is generated: it is read as a property of the config', (secret) => {
    const p = shop({ auth: { type: 'bearer', secret } })
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('list') })
    const root = generate(p.model()).find(file => file.path === 'layers/apis/server/utils/shop.ts')!.content
    expect(root).toContain('const config = useRuntimeConfig().apis.shop')
    expect(root).toContain(`if (config.${secret}) headers.authorization = \`Bearer \${config.${secret}}\``)
    expect(root).not.toMatch(/const \{/)
  })

  it.each(['api-query'])('a browser source named %s would be the file of the helpers every browser source shares: refused with a name message, at create, at rename and at a switch to the browser', (name) => {
    const taken = `API "${name}": "${name}" is the name of a file every browser API source shares (layers/apis/app/data/${name}.ts, where its own composition would go): pick another name`
    expect(project().refuse('api_create', { name, baseUrl: 'https://x.example.com', runtime: 'browser' }, 'invalid').message).toBe(taken)
    const p = shop({ runtime: 'browser' })
    expect(p.refuse('api_update', { datasource: 'ds_shop', name }, 'invalid').message).toBe(taken)
    expect(p.json(SHOP).name).toBe('shop')
    // On the server it has no composition in app/data: it is fine, until it is switched to the browser.
    const server = project()
    server.edit('api_create', { name, baseUrl: 'https://x.example.com' })
    expect(server.refuse('api_update', { datasource: `ds_${name.replace('-', '_')}`, runtime: 'browser' }, 'invalid').message).toBe(taken)
  })

  it('names that only differ in case or dashes are not refused as "app"', () => {
    project().edit('api_create', { name: 'application', baseUrl: 'https://x.example.com' })
    project().edit('api_create', { name: 'my-app', baseUrl: 'https://x.example.com' })
  })
})

describe('the runtimeConfig and env names of an API source', () => {
  it('are under apis (the REST ones stay under datasources)', () => {
    const p = shop({ auth: { type: 'bearer', secret: 'token' } })
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('list') })
    expect(p.json(SHOP).env).toEqual({ baseUrl: 'NUXT_APIS_SHOP_BASE_URL', token: 'NUXT_APIS_SHOP_TOKEN' })
    const config = generate(p.model()).find(file => file.path === 'layers/core/nuxt.config.ts')!.content
    expect(config).toContain('apis: {\n      catalog: { baseUrl: \'https://catalog.example.com/v1\', apiKey: \'\' },\n      shop: { baseUrl: \'https://shop.example.com\', token: \'\' }\n    }')
    expect(config).toContain('datasources: {\n      quotes:')
  })

  it('a browser source reads NUXT_PUBLIC_APIS_*; a rename follows, and a name from before (NUXT_DATASOURCES_*) is replaced', () => {
    const p = shop({ runtime: 'browser' })
    expect(p.json(SHOP).env).toEqual({ baseUrl: 'NUXT_PUBLIC_APIS_SHOP_BASE_URL' })
    p.edit('api_update', { datasource: 'ds_shop', name: 'store' })
    expect(p.json(SHOP).env).toEqual({ baseUrl: 'NUXT_PUBLIC_APIS_STORE_BASE_URL' })
    const old = project({ ...p.files, [SHOP]: JSON.stringify({ ...p.json(SHOP), env: { baseUrl: 'NUXT_PUBLIC_DATASOURCES_STORE_BASE_URL' } }) })
    old.edit('api_update', { datasource: 'ds_shop', runtime: 'server' })
    expect(old.json(SHOP).env).toEqual({ baseUrl: 'NUXT_APIS_STORE_BASE_URL' })
  })
})

describe('a hand-written file with such a name', () => {
  const handWritten = (patch: (file: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = shop()
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('list') })
    const file = p.json(SHOP)
    patch(file)
    return project({ ...p.files, [SHOP]: JSON.stringify(file) })
  }

  it.each([
    ['a reserved word', (file: Record<string, any>) => file.queries.push(items('delete')), 'is a reserved word'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a name the files declare', (file: Record<string, any>) => file.queries.push(items('invalidInput')), 'already declared or imported'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['a source named app', (file: Record<string, any>) => { file.name = 'app' }, 'lint rules refuse'] // eslint-disable-line @typescript-eslint/no-explicit-any
  ])('%s: the generator throws, naming the file, and an edit of that source refuses it', (_, patch, text) => {
    const p = handWritten(patch)
    const message = (() => {
      try {
        generate(p.model())
        return ''
      } catch (error) {
        return (error as Error).message
      }
    })()
    expect(message).toMatch(new RegExp(`^\\.bildr/datasources/shop\\.json: .*${text}`))
    const outcome = applyEdit(p.files, 'api_update', { datasource: 'ds_shop', baseUrl: 'https://shop.example.com/v2' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).toContain(text)
  })

  it('two sources whose composables would have one name: the generator throws, and the edit that makes it is refused', () => {
    const p = project()
    p.edit('api_create', { name: 'a-b', baseUrl: 'https://ab.example.com' })
    p.edit('api_model_set', { datasource: 'ds_a_b', model: ITEM })
    p.edit('api_query_set', { datasource: 'ds_a_b', query: items('c') })
    p.edit('api_create', { name: 'a', baseUrl: 'https://a.example.com' })
    p.edit('api_model_set', { datasource: 'ds_a', model: ITEM })
    // `a` + `bC` is useABC too, as `a-b` + `c` is: each source is fine alone.
    const message = p.refuse('api_query_set', { datasource: 'ds_a', query: items('bC') }, 'invalid').message
    expect(message).toContain('would both generate the composable useABC')
    p.edit('api_query_set', { datasource: 'ds_a', query: items('b') })
    const files = { ...p.files }
    const file = JSON.parse(files['.bildr/datasources/a.json']!)
    file.queries[0].name = 'bC'
    files['.bildr/datasources/a.json'] = JSON.stringify(file)
    const loaded = loadModel(files)
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    expect(() => generate(loaded.model)).toThrow(/^\.bildr\/datasources\/a\.json: .*would both generate the composable useABC/)
  })
})

describe('what the generator declares is in the reserved lists (drift guard)', () => {
  const wide = () => {
    const p = project()
    p.edit('api_create', { name: 'wide', baseUrl: 'https://wide.example.com/v1', auth: { type: 'header', secret: 'apiKey', header: 'X-Api-Key' } })
    p.edit('api_model_set', { datasource: 'ds_wide', model: { name: 'Tag', fields: [{ name: 'label', type: 'text' }] } })
    p.edit('api_model_set', { datasource: 'ds_wide', model: { name: 'Thing', fields: [{ name: 'id', type: 'uuid' }, { name: 'name', type: 'text', key: 'full-name' }, { name: 'when', type: 'datetime', optional: true }, { name: 'tags', type: 'model', model: 'Tag', list: true, nullable: true }] } })
    p.edit('api_query_set', { datasource: 'ds_wide', query: { name: 'things', path: '/things', params: [{ name: 'q', in: 'query', type: 'text' }, { name: 'page', in: 'query', type: 'integer', required: true }], result: { model: 'Thing', many: true, itemsPath: 'hydra:member' } } })
    p.edit('api_query_set', { datasource: 'ds_wide', query: { name: 'thing', path: '/things/:id/parts/:part', params: [{ name: 'id', in: 'path', type: 'text' }, { name: 'part', in: 'path', type: 'integer' }], result: { model: 'Thing', many: false } } })
    p.edit('api_action_set', { datasource: 'ds_wide', action: { name: 'saveThing', method: 'PUT', path: '/things/:id', params: [{ name: 'id', in: 'path', type: 'text' }], body: { model: 'Thing' }, result: { model: 'Thing', many: false } } })
    p.edit('api_action_set', { datasource: 'ds_wide', action: { name: 'ping', method: 'POST', path: '/ping', params: [] } })
    // A source that runs in the browser (P3): its composition and composables declare names of their own.
    p.edit('api_create', { name: 'far', baseUrl: 'https://far.example.com/v1', runtime: 'browser' })
    p.edit('api_model_set', { datasource: 'ds_far', model: { name: 'Tag', fields: [{ name: 'label', type: 'text' }] } })
    p.edit('api_model_set', { datasource: 'ds_far', model: { name: 'Thing', fields: [{ name: 'id', type: 'text' }, { name: 'when', type: 'datetime', optional: true }, { name: 'tags', type: 'model', model: 'Tag', list: true, nullable: true }] } })
    p.edit('api_query_set', { datasource: 'ds_far', query: { name: 'things', path: '/things', params: [{ name: 'q', in: 'query', type: 'text' }], result: { model: 'Thing', many: true } } })
    p.edit('api_query_set', { datasource: 'ds_far', query: { name: 'thing', path: '/things/:id', params: [{ name: 'id', in: 'path', type: 'text' }], result: { model: 'Thing', many: false } } })
    p.edit('api_action_set', { datasource: 'ds_far', action: { name: 'saveThing', method: 'PUT', path: '/things/:id', params: [{ name: 'id', in: 'path', type: 'text' }], body: { model: 'Thing' }, result: { model: 'Thing', many: false } } })
    p.edit('api_action_set', { datasource: 'ds_far', action: { name: 'ping', method: 'POST', path: '/ping', params: [] } })
    return p.model()
  }

  /** Names a generated file declares or imports (top level, or a `const`/`let` anywhere), and the capitalised words it uses. */
  const namesIn = (content: string) => {
    const declared = new Set<string>()
    for (const match of content.matchAll(/^import (?:type )?\{([^}]+)\}/gm)) {
      for (const entry of match[1]!.split(',')) declared.add(entry.trim().replace(/^type /, '').split(' as ').pop()!.trim())
    }
    for (const match of content.matchAll(/^import (?:type )?(\w+) from/gm)) declared.add(match[1]!)
    for (const match of content.matchAll(/^(?:export )?(?:declare )?(?:const|let|function|class|interface|type|enum) (\w+)/gm)) declared.add(match[1]!)
    for (const match of content.matchAll(/\b(?:const|let) (\w+)\b/g)) declared.add(match[1]!)
    // What an import brings is in `declared` by its local name (`Result as KernelResult`: the alias).
    const code = content
      .replace(/^import .*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, '\'\'')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    const used = new Set(code.match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? [])
    return { declared, used }
  }

  /** The globals (by name, as a bare identifier: not a property, not an object key) a generated file calls or reads. */
  const globalsIn = (content: string) => {
    const code = content
      .replace(/^import .*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, '\'\'')
      // What a template holds between `${` and `}` is code; the rest is text.
      .replace(/`(?:[^`\\]|\\.)*`/g, text => [...text.matchAll(/\$\{([^}]*)\}/g)].map(match => match[1]).join(' '))
    const globals = new Set(Object.getOwnPropertyNames(globalThis))
    const found = new Set<string>()
    for (const match of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b(?!\s*:(?!:))/g)) if (globals.has(match[1]!)) found.add(match[1]!)
    return found
  }

  it('a query, an action or a model named like a global a generated file uses is refused (an operation `console` would hide the console its composition calls)', () => {
    for (const name of ['console', 'encodeURIComponent']) {
      const message = shop().refuse('api_query_set', { datasource: 'ds_shop', query: items(name) }, 'invalid').message
      expect(message).toBe(`API "shop": the query "${name}" would be named ${name}, which is already declared or imported by the generated files (a global the generated files use): pick another name`)
      expect(shop({ runtime: 'browser' }).refuse('api_action_set', { datasource: 'ds_shop', action: { name, method: 'POST', path: '/x', params: [] } }, 'invalid').message).toContain('(a global the generated files use)')
    }
    const p = shop()
    p.edit('api_query_set', { datasource: 'ds_shop', query: items('list') })
    p.refuse('api_query_rename', { datasource: 'ds_shop', query: 'list', name: 'console' }, 'invalid')
  })

  it('every global a generated API file uses next to a name of the model is in the reserved lists (drift guard)', () => {
    const model = wide()
    const files = generate(model).filter(file => file.path.startsWith('layers/apis/'))
    // `undefined` and the other words of the language are refused as the name of an operation on their own (JS_RESERVED_WORDS).
    const known = new Set<string>([...Object.values(API_DECLARED_NAMES).flat(), ...JS_RESERVED_WORDS])
    // The shared files import nothing the model names, so a global they use can't be hidden by an operation or a model: they are not held to this.
    const shared = new Set(['layers/apis/app/data/api-query.ts', 'layers/apis/nuxt.config.ts'])
    const missing: string[] = []
    for (const file of files.filter(entry => !shared.has(entry.path))) {
      for (const name of globalsIn(file.content)) if (!known.has(name)) missing.push(`${file.path}: ${name}`)
    }
    expect(missing).toEqual([])
    // The one that clashed: the composition calls console.warn / console.error next to the use-cases it imports under their own names.
    expect(files.some(file => globalsIn(file.content).has('console'))).toBe(true)
  })

  it.each([['fromRoute', 'the helpers of the server runtime'], ['createHttpClient', 'the core HTTP client (both runtimes)']])('a query named %s (the compositions and composables import it) is refused', (name, where) => {
    const message = shop({ runtime: 'browser' }).refuse('api_query_set', { datasource: 'ds_shop', query: items(name) }, 'invalid').message
    expect(message).toContain(`the query "${name}" would be named ${name}, which is already declared or imported by the generated files (${where})`)
  })

  it('a model named HttpFailure (the compositions import it) is refused', () => {
    const message = shop({ runtime: 'browser' }).refuse('api_model_set', { datasource: 'ds_shop', model: { name: 'HttpFailure', fields: [{ name: 'id', type: 'integer' }] } }, 'invalid').message
    expect(message).toContain('the type of the model HttpFailure would be named HttpFailure, which is already declared or imported by the generated files (the core HTTP client (both runtimes))')
  })

  it('every name an API file declares or imports, and every type it uses, is derived from the model or in the fixed lists', () => {
    // The golden blog's catalog API plus a source that uses every kind of operation, parameter and field.
    const model = wide()
    const files = generate(model).filter(file => file.path.startsWith('layers/apis/'))
    expect(files.length).toBeGreaterThan(40)
    const known = new Set<string>(Object.values(API_DECLARED_NAMES).flat())
    for (const source of model.datasources) {
      if (source.kind !== 'api') continue
      for (const claim of apiNameClaims(source as ApiSource)) known.add(claim.name)
      for (const name of Object.values(apiSourceIdentifiers(source.name))) known.add(name)
    }
    const shared = new Set(['layers/apis/app/data/api-query.ts', 'layers/apis/nuxt.config.ts'])
    expect(files.map(file => file.path)).toEqual(expect.arrayContaining(['layers/apis/app/data/far.ts', 'layers/apis/app/composables/apis/useFarThings.ts']))
    const missing: string[] = []
    for (const file of files.filter(entry => !shared.has(entry.path))) {
      const { declared, used } = namesIn(file.content)
      for (const name of new Set([...declared, ...used])) if (!known.has(name)) missing.push(`${file.path}: ${name}`)
    }
    expect(missing).toEqual([])
  })
})
