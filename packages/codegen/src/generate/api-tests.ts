import type { ApiSource } from '../edit/api.ts'
import { inputFields, operationsOf, remoteKey, sampleAnswer, sampleInput, sampleModel } from './api-model.ts'
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

const repositoryTestLines = (source: ApiSource, names: SourceNames, operations: Operation[]): string[] => {
  const tests = operations.flatMap((operation): string[][] => {
    const input = sampleInput(source, operation)
    const fields = inputFields(operation)
    const argument = fields.length ? literal(input, '    ') : ''
    const answer = sampleAnswer(source, operation)
    const at = operation.result?.itemsPath ? ` under ${operation.result.itemsPath}` : ''
    const label = `${operation.name}: ${operation.method} ${operation.path}${operation.result ? `, reads the ${operation.result.many ? 'list' : 'model'}${at} and maps it` : ''}`
    const sent = literal([{ path: samplePath(operation, input), request: expectedRequest(source, operation, input) }], '    ')
    return [
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
            `  it(${tsString(`${operation.name}: an answer that is not ${operation.result.many ? 'a list of ' : ''}${operation.result.model} is an invalid_answer`)}, async () => {`,
            '    const { http } = recording(\'unexpected\')',
            `    await expect(${names.adapter}(http).${operation.name}(${argument})).rejects.toMatchObject({ error: { type: 'invalid_answer' } })`,
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
