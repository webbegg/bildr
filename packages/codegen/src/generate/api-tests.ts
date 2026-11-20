import type { ApiSource } from '../edit/api.ts'
import { inputFields, modelNames, nestedModels, operationsOf, remoteKey, sampleAnswer, sampleInput, sampleModel, sampleVariants } from './api-model.ts'
import type { Emitted, Operation, SourceNames } from './api-model.ts'
import { importLine } from './imports.ts'
import { file, header, kebab, tsLiteral, tsString } from './text.ts'

/**
 * The generated tests of an API source (`layers/apis/test/<source>/`): the HTTP repository against a fake
 * ApiClient (path, parameters, itemsPath, mapping, an invalid answer) and one test file per use-case, against
 * a fake repository. They run in the project's unit vitest project, with no Nuxt and no network.
 */
export const apiTestFiles = (source: ApiSource, names: SourceNames): Emitted[] => {
  const operations = operationsOf(source)
  const at = (path: string, lines: Array<string | false>): Emitted => ({
    path: `layers/apis/test/${names.dir}/${path}`,
    source: names.source,
    content: file([header(names.source), ...lines])
  })
  return [
    at('fake-repository.ts', fakeLines(names, operations)),
    at(`${names.portFile}.http.test.ts`, repositoryTestLines(source, names, operations)),
    // `.mapper.` has a dot: no operation's file (`<op>.test.ts`) can be named like it.
    ...(source.models.length ? [at('mappers.mapper.test.ts', mapperTestLines(source, names))] : []),
    ...operations.map(operation => at(`${kebab(operation.name)}.test.ts`, useCaseTestLines(source, names, operation)))
  ]
}

/** `literal` as code, at the indent of the line it starts on. */
const literal = (value: unknown, indent: string) => value === undefined ? 'undefined' : tsLiteral(value, indent)

const fakeLines = (names: SourceNames, operations: Operation[]): string[] => [
  importLine(`../../shared/domain/${names.dir}/repositories/${names.portFile}`, [{ name: names.port, type: true }]),
  '',
  '/** What a fake repository does with a method the test did not give it: fail, so a use-case can\'t call one by accident. */',
  'const unused = async (): Promise<never> => {',
  '  throw new Error(\'This method of the fake repository is not part of the test\')',
  '}',
  '',
  `/** A ${names.port} whose methods fail unless \`methods\` has them. */`,
  `export const ${names.fake} = (methods: Partial<${names.port}> = {}): ${names.port} => ({`,
  operations.map(operation => `  ${operation.name}: unused`).join(',\n') + ',',
  '  ...methods',
  '})'
]

/** The path of a call with the sample values in it (path parameters encoded, as the repository does). */
const samplePath = (operation: Operation, input: Record<string, unknown>) =>
  operation.path.replace(/:([a-z][A-Za-z0-9]*)/g, (_, name: string) => encodeURIComponent(String(input[name])))

/** The request the repository must send for the sample input, as the client receives it. */
const expectedRequest = (source: ApiSource, operation: Operation, input: Record<string, unknown>) => ({
  method: operation.method,
  ...(operation.params.some(param => param.in === 'query') ? { query: Object.fromEntries(operation.params.filter(param => param.in === 'query').map(param => [remoteKey(param), input[param.name]])) } : {}),
  ...(operation.body ? { body: sampleModel(source, operation.body, true) } : {})
})

/** The entity (or entities) the sample answer maps to. */
const expectedResult = (source: ApiSource, operation: Operation) => {
  if (!operation.result) return undefined
  const one = sampleModel(source, operation.result.model, false)
  return operation.result.many ? [one] : one
}

/** What a text path parameter can't be: empty, a dot segment, or more than one segment. */
const NOT_A_SEGMENT = ['', '.', '..', 'a/b', 'a\\b']

const repositoryTestLines = (source: ApiSource, names: SourceNames, operations: Operation[]): string[] => {
  const tests = operations.flatMap((operation): string[][] => {
    const input = sampleInput(source, operation)
    const fields = inputFields(operation)
    const argument = fields.length ? literal(input, '    ') : ''
    const answer = sampleAnswer(source, operation)
    const at = operation.result?.itemsPath ? ` under ${operation.result.itemsPath}` : ''
    const label = `${operation.name}: ${operation.method} ${operation.path}${operation.result ? `, reads the ${operation.result.many ? 'list' : 'model'}${at} and maps it` : ''}`
    const sent = literal([{ path: samplePath(operation, input), request: expectedRequest(source, operation, input) }], '    ')
    // A text path parameter is one segment: "..", "." or "" would make the URL call another path of the API (with its secret), and a "/" or a "\\" is two segments.
    const texts = operation.params.filter(param => param.in === 'path' && param.type === 'text')
    return [
      ...(texts.length
        ? [[
            `  it(${tsString(`${operation.name}: refuses a path parameter that is not one segment ("", ".", "..", with a "/" or a "\\"), without calling the API`)}, async () => {`,
            ...texts.flatMap(param => [
              `    for (const value of [${NOT_A_SEGMENT.map(tsString).join(', ')}]) {`,
              '      const { http, calls } = recording(undefined)',
              `      await expect(${names.adapter}(http).${operation.name}({ ...${literal(input, '      ')}, ${param.name}: value })).rejects.toMatchObject({ error: { type: 'invalid_input' } })`,
              '      expect(calls).toEqual([])',
              '    }'
            ]),
            '  })'
          ]]
        : []),
      [
        `  it(${tsString(label)}, async () => {`,
        `    const { http, calls } = recording(${literal(answer, '    ')})`,
        `    ${operation.result ? 'const result = ' : ''}await ${names.adapter}(http).${operation.name}(${argument})`,
        `    expect(calls).toEqual(${sent})`,
        ...(operation.result ? [`    expect(result).toEqual(${literal(expectedResult(source, operation), '    ')})`] : []),
        '  })'
      ],
      ...(operation.result
        ? [[
            `  it(${tsString(`${operation.name}: an answer that is not ${operation.result.many ? 'a list of ' : ''}${operation.result.model} is an invalid_answer without detail (the detail goes to onInvalidAnswer)`)}, async () => {`,
            '    expect.assertions(2)',
            '    const { http } = recording(\'unexpected\')',
            `    await expect(${names.adapter}(http, detail => expect(detail.length).toBeGreaterThan(0)).${operation.name}(${argument})).rejects.toMatchObject({ error: { type: 'invalid_answer', message: ${tsString(`The "${source.name}" API answered something unexpected`)} } })`,
            '  })'
          ]]
        : [])
    ]
  })
  return [
    'import { describe, expect, it } from \'vitest\'',
    importLine(`../../shared/data/${names.dir}/client`, [{ name: 'ApiClient', type: true }, { name: 'ApiRequest', type: true }]),
    importLine(`../../shared/data/${names.dir}/repositories/${names.adapterFile}`, [names.adapter]),
    '',
    '/** An ApiClient that records its calls and answers `answer`. */',
    'const recording = (answer: unknown) => {',
    '  const calls: Array<{ path: string, request: ApiRequest }> = []',
    '  const http: ApiClient = async (path, request) => {',
    '    calls.push({ path, request })',
    '    return answer',
    '  }',
    '  return { http, calls }',
    '}',
    '',
    `describe('${names.adapter}', () => {`,
    tests.map(test => test.join('\n')).join('\n\n'),
    '})'
  ]
}

/** A value of the input's first field that its check refuses. */
const wrongInput = (operation: Operation): string => {
  const field = inputFields(operation)[0]!
  const wrong = field.model || field.ts === 'number' || field.ts === 'boolean' ? '\'wrong\'' : '42'
  return `{ ${field.name}: ${wrong} }`
}

const useCaseTestLines = (source: ApiSource, names: SourceNames, operation: Operation): string[] => {
  const fields = inputFields(operation)
  const input = fields.length ? literal(sampleInput(source, operation), '    ') : ''
  const value = literal(expectedResult(source, operation), '    ')
  // An object literal after `=>` would be a block: it goes in parentheses.
  const returned = value.startsWith('{') ? `(${value})` : value
  const use = (repository: string, argument: string) => `await ${operation.name}({ ${names.camel}: ${repository} })(${argument})`
  return [
    'import { describe, expect, it } from \'vitest\'',
    importLine(`../../shared/domain/${names.dir}/errors`, [names.failure, 'remoteFailed']),
    importLine(`../../shared/domain/${names.dir}/use-cases/${kebab(operation.name)}`, [operation.name]),
    importLine(`./fake-repository`, [names.fake]),
    '',
    `describe('${operation.name}', () => {`,
    '  it(\'returns what the API answers\', async () => {',
    `    const repository = ${names.fake}({ ${operation.name}: async () => ${operation.result ? returned : 'undefined'} })`,
    `    const result = ${use('repository', input)}`,
    `    expect(result).toEqual({ ok: true, value: ${operation.result ? value : 'undefined'} })`,
    '  })',
    '',
    '  it(\'returns a failure of the API as a remote_failed error\', async () => {',
    `    const repository = ${names.fake}({`,
    `      ${operation.name}: async () => {`,
    `        throw new ${names.failure}(remoteFailed(503, 'answered 503'))`,
    '      }',
    '    })',
    `    const result = ${use('repository', input)}`,
    '    expect(result).toEqual({ ok: false, error: expect.objectContaining({ type: \'remote_failed\', status: 503 }) })',
    '  })',
    ...(fields.length
      ? [
          '',
          '  it(\'refuses an input that is not valid, without calling the API\', async () => {',
          `    const repository = ${names.fake}()`,
          `    const result = ${use('repository', `${wrongInput(operation)} as never`)}`,
          '    expect(result).toEqual({ ok: false, error: expect.objectContaining({ type: \'invalid_input\' }) })',
          '  })'
        ]
      : []),
    '})'
  ]
}

/** The models a body brings: the body model and every model it nests, which `from<Model>` converts back. */
const sentModels = (source: ApiSource, operations: Operation[]): Set<string> => {
  const sent = new Set<string>()
  const add = (name: string) => {
    if (sent.has(name)) return
    sent.add(name)
    for (const nested of nestedModels(source.models.find(model => model.name === name)!)) add(nested)
  }
  for (const operation of operations) if (operation.body) add(operation.body)
  return sent
}

/**
 * `mappers.mapper.test.ts`: every model's mapper, on its own. The repository tests only read the sample answer with every field
 * set; here each model with an optional, nullable or list field is also mapped with those keys absent, null and empty, and each
 * model that is sent as a body goes round (`from<Model>(to<Model>(dto))` is the dto).
 */
const mapperTestLines = (source: ApiSource, names: SourceNames): string[] => {
  const sent = sentModels(source, operationsOf(source))
  const tests = source.models.flatMap((model) => {
    const mapper = modelNames(model.name)
    return sampleVariants(source, model.name).flatMap(({ variant, label }): string[][] => {
      const dto = literal(sampleModel(source, model.name, true, variant), '    ')
      return [
        [
          `  it(${tsString(`${model.name}: maps to the domain (${label})`)}, () => {`,
          `    expect(${mapper.to}(${dto})).toEqual(${literal(sampleModel(source, model.name, false, variant), '    ')})`,
          '  })'
        ],
        ...(sent.has(model.name)
          ? [[
              `  it(${tsString(`${model.name}: goes back to what the API sent (${label})`)}, () => {`,
              `    expect(${mapper.from}(${mapper.to}(${dto}))).toEqual(${dto})`,
              '  })'
            ]]
          : [])
      ]
    })
  })
  return [
    'import { describe, expect, it } from \'vitest\'',
    ...[...source.models].sort((a, b) => modelNames(a.name).file < modelNames(b.name).file ? -1 : 1)
      .map(model => importLine(`../../shared/data/${names.dir}/mappers/${modelNames(model.name).file}.mapper`, [modelNames(model.name).to, ...(sent.has(model.name) ? [modelNames(model.name).from] : [])])),
    '',
    `describe('the mappers of the "${source.name}" API', () => {`,
    tests.map(test => test.join('\n')).join('\n\n'),
    '})'
  ]
}
