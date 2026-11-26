import type { ApiSource } from '../edit/api.ts'
import type { Model } from '../model/load.ts'
import { namesOf, operationsOf } from './api-model.ts'
import type { Emitted, SourceNames } from './api-model.ts'
import { composableFile } from './api-server.ts'
import { importLine } from './imports.ts'
import { apiPaths, importPath } from './paths.ts'
import { file, header, kebab, tsString } from './text.ts'

/**
 * The browser runtime of the `api` data sources (SD-5, P3): the same domain, data and tests as a server source, but no
 * composition root and no Nitro route. In `layers/apis/app/`: per source its composition (the HTTP repository over the core
 * HTTP client, `#core/http/client`, wired to the use-cases) and the composables, which call the use-case in the
 * page. A browser source has no auth at all: P1's model refuses a secret for it, so the page never holds one and sends no credentials.
 */
export const generateBrowserRuntime = (model: Model, sources: ApiSource[]): Emitted[] => sources.flatMap((source) => {
  const names = namesOf(model, source)
  return [
    compositionFile(source, names),
    ...operationsOf(source).map(operation => composableFile(source, names, operation, 'browser'))
  ]
})

/**
 * `app/data/<s>.ts`: the composition of one browser source, the only place where its use-cases meet the HTTP repository. It reads
 * only `useRuntimeConfig().public.apis.<s>.baseUrl`: the page can't hold a secret, so there is no auth here.
 */
const compositionFile = (source: ApiSource, names: SourceNames): Emitted => {
  const operations = operationsOf(source)
  const answers = operations.some(operation => operation.result)
  const paths = apiPaths(names.dir)
  const path = paths.browserRoot
  return {
    path,
    source: names.source,
    content: file([
      header(names.source),
      `// Composition of the "${source.name}" API in the browser: the only place where its use-cases meet the HTTP repository.`,
      '// It runs in the page, so it has no auth at all (a key could not stay hidden here: an API that needs one runs on the server) and sends no credentials.',
      'import { useRuntimeConfig } from \'#app\'',
      importLine('#core/http/api-client', [{ name: 'ApiClient', type: true }, 'resultClient']),
      importLine('#core/http/client', ['createHttpClient']),
      importLine(importPath(path, paths.adapter(names.adapterFile)), [names.adapter]),
      importLine(importPath(path, paths.errors), [{ name: names.error, type: true }, 'remoteFailed']),
      ...operations
        .map(operation => ({ path: importPath(path, paths.useCase(operation.kind, kebab(operation.name))), name: operation.name }))
        .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
        .map(entry => importLine(entry.path, [entry.name])),
      '',
      `/** The HTTP client of the "${source.name}" API: it calls the base URL it is given (the one of runtimeConfig.public.apis.${names.camel}), and nothing else. \`signal\` cancels its calls. */`,
      `const ${names.client} = (baseUrl: string, signal?: AbortSignal): ApiClient<${names.error}> =>`,
      '  resultClient(createHttpClient({ baseUrl, headers: { accept: \'application/json\' }, signal }), failure => remoteFailed(failure.type, failure.status, failure.message))',
      '',
      `/**`,
      ` * The use-cases of the "${source.name}" API, wired to its HTTP repository. Call it in a composable's setup (it reads the runtime config): it answers`,
      ' * the function that gives the use-cases, for the `signal` of the call (a query that is cancelled aborts it).',
      ' */',
      `export const ${names.root} = () => {`,
      `  const baseUrl = useRuntimeConfig().public.apis.${names.camel}.baseUrl`,
      '  return (signal?: AbortSignal) => {',
      ...(answers
        ? [
            '    // The detail of an answer that is not what the model says (field paths, expected types) goes to the console: the error the UI sees has none.',
            `    const repository = ${names.adapter}(${names.client}(baseUrl, signal), detail => console.warn(${tsString(`The "${source.name}" API answered something unexpected: `)} + detail))`
          ]
        : [`    const repository = ${names.adapter}(${names.client}(baseUrl, signal))`]),
      '    return {',
      operations.map(operation => `      ${operation.name}: ${operation.name}({ ${names.camel}: repository })`).join(',\n'),
      '    }',
      '  }',
      '}'
    ])
  }
}
