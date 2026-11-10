import { takesFormRecords } from '../data/collections'
import { INSTANCE_TYPE } from '../document/components'
import type { ComponentDefinition, DocNode, Page } from '../document/schema'
import { resolveInstance } from './instances'
import { pageOutline } from './render'
import type { VisitorCollection, VisitorProject } from './visitor'

/**
 * WebMCP for published apps: the page registers tools on the browser's
 * `modelContext` so an in-browser agent can read and navigate the app.
 * Exploratory; the API is a draft, so everything here is defensive.
 */

export interface WebMcpResult {
  content: { type: 'text', text: string }[]
  isError?: boolean
}

export interface WebMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
  execute: (input: Record<string, unknown>) => WebMcpResult | Promise<WebMcpResult>
}

/** The subset of `document.modelContext` (or `navigator.modelContext` in older drafts) we use. */
export interface ModelContext {
  registerTool: (tool: WebMcpTool) => unknown
  unregisterTool?: (name: string) => unknown
}

export interface WebMcpHost {
  getProject: () => VisitorProject | undefined
  getCurrentPage: () => Page | undefined
  /** Navigates the app router to a path such as `/p/shop/pricing`. */
  navigate: (path: string) => unknown
  /** Reaches the public data endpoint; defaults to the global `fetch`. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
}

/** The WebMCP entry point if the browser has one: `document` first, then `navigator`. */
export function getModelContext(doc?: object, nav?: object): ModelContext | undefined {
  for (const owner of [doc, nav]) {
    const candidate = (owner as { modelContext?: Partial<ModelContext> } | undefined)?.modelContext
    if (typeof candidate?.registerTool === 'function') return candidate as ModelContext
  }
  return undefined
}

const text = (value: string, isError = false): WebMcpResult => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError } : {}) })

const pageUrl = (project: VisitorProject, page: Page) => `/p/${project.slug}/${page.slug}`

/** `node` as a visitor sees it: each Instance replaced by its resolved tree, unresolvable ones dropped. */
function asRendered(node: DocNode, components: ComponentDefinition[]): DocNode | null {
  const resolved = node.type === INSTANCE_TYPE ? resolveInstance(node, components) : node
  return resolved && { ...resolved, children: resolved.children.map(child => asRendered(child, components)).filter(child => child !== null) }
}

const describeCollections = (collections: VisitorCollection[]) =>
  collections.map(c => `${c.slug} (${c.fields.map(f => `${f.key}: ${f.type}`).join(', ')})`).join('; ')

/** The endpoint's answer as a tool result; its errors are generic, so they are passed on as they are. */
async function endpointResult(response: Response, fallback: string): Promise<WebMcpResult> {
  const body: unknown = await response.json().catch(() => undefined)
  if (response.ok) return text(JSON.stringify(body))
  const error = body as { message?: unknown, statusMessage?: unknown } | undefined
  const message = [error?.message, error?.statusMessage].find(m => typeof m === 'string' && m)
  return text(typeof message === 'string' ? message : fallback, true)
}

/**
 * Tools for the published app's public collections, registered only when at
 * least one collection qualifies. They go through the public data endpoint,
 * which applies the published flags and limits again server-side.
 */
function dataTools(project: VisitorProject, host: WebMcpHost): WebMcpTool[] {
  const request = (url: string, init?: RequestInit) => (host.fetch ?? globalThis.fetch)(url, init)
  const endpoint = (slug: string) => `/api/public/${project.slug}/${slug}`
  const readable = project.collections.filter(c => c.publicRead)
  const tools: WebMcpTool[] = []
  if (readable.length) {
    tools.push({
      name: 'list_records',
      description: `List records of a public collection of this app. Collections (field: type): ${describeCollections(readable)}.`,
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: readable.map(c => c.slug), description: 'The collection slug' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'At most this many records (default 100)' },
          filter: { type: 'object', description: 'Field key → value; records must equal every value, e.g. { "vegan": true }' },
          sort: { type: 'string', description: 'Field key to sort by; prefix with "-" for descending, e.g. "-price"' }
        },
        required: ['collection']
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const collection = readable.find(c => c.slug === input.collection)
        if (!collection) return text(`Unknown collection "${String(input.collection)}". Readable collections: ${readable.map(c => c.slug).join(', ')}`, true)
        const params = new URLSearchParams()
        if (typeof input.limit === 'number') params.set('limit', String(input.limit))
        if (typeof input.sort === 'string' && input.sort) {
          const descending = input.sort.startsWith('-')
          params.set('sort', descending ? input.sort.slice(1) : input.sort)
          if (descending) params.set('dir', 'desc')
        }
        const filter = typeof input.filter === 'object' && input.filter !== null ? input.filter as Record<string, unknown> : {}
        for (const [key, value] of Object.entries(filter)) {
          if (['string', 'number', 'boolean'].includes(typeof value)) params.set(`filter[${key}]`, String(value))
        }
        const search = params.toString()
        try {
          return await endpointResult(await request(search ? `${endpoint(collection.slug)}?${search}` : endpoint(collection.slug)), 'Could not load the records')
        } catch {
          return text('Could not load the records', true)
        }
      }
    })
  }
  const writable = project.collections.filter(c => c.publicCreate && takesFormRecords(c))
  if (writable.length) {
    tools.push({
      name: 'submit_form',
      description: `Add a record to a collection of this app, like submitting its form. Fields are optional; unknown ones are dropped. Collections (field: type): ${describeCollections(writable)}.`,
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: writable.map(c => c.slug), description: 'The collection slug' },
          values: { type: 'object', description: 'Field key → value, e.g. { "email": "ana@example.com" }' }
        },
        required: ['collection', 'values']
      },
      execute: async (input) => {
        const collection = writable.find(c => c.slug === input.collection)
        if (!collection) return text(`Unknown collection "${String(input.collection)}". Collections that take new records: ${writable.map(c => c.slug).join(', ')}`, true)
        const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: input.values }) }
        try {
          return await endpointResult(await request(endpoint(collection.slug), init), 'Could not send the form, try again later')
        } catch {
          return text('Could not send the form, try again later', true)
        }
      }
    })
  }
  return tools
}

function tools(host: WebMcpHost): WebMcpTool[] {
  const project = host.getProject()
  return [
    {
      name: 'list_pages',
      description: 'List the pages of this app with their name, slug and URL.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => {
        const project = host.getProject()
        const pages = project?.pages.map(p => ({ name: p.name, slug: p.slug, url: pageUrl(project, p) })) ?? []
        return text(JSON.stringify(pages))
      }
    },
    {
      name: 'navigate_to_page',
      description: 'Show another page of this app. Use a slug from list_pages.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'The page slug, e.g. "pricing"' } },
        required: ['slug']
      },
      execute: async (input) => {
        const project = host.getProject()
        const pages = project?.pages ?? []
        const page = pages.find(p => p.slug === input.slug)
        if (!project || !page) {
          return text(`Unknown page "${String(input.slug)}". Valid slugs: ${pages.map(p => p.slug).join(', ')}`, true)
        }
        await host.navigate(pageUrl(project, page))
        return text(`Navigated to ${pageUrl(project, page)}`)
      }
    },
    {
      name: 'get_page_content',
      description: 'Read the current page as a text outline: one line per element, links shown as "→ target".',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => {
        const page = host.getCurrentPage()
        if (!page) return text('No page is shown', true)
        const components = host.getProject()?.components ?? []
        return text(pageOutline({ ...page, root: asRendered(page.root, components)! }))
      }
    },
    ...(project ? dataTools(project, host) : [])
  ]
}

/** Registers the published-app tools; returns a cleanup that unregisters them. */
export function registerWebMcpTools(modelContext: ModelContext, host: WebMcpHost): () => void {
  const register = (tool: WebMcpTool) => {
    // registerTool may return a Promise in some drafts; a rejection only means the tool is missing.
    const result = modelContext.registerTool(tool)
    if (result instanceof Promise) result.catch(() => {})
  }
  const registered: string[] = []
  for (const tool of tools(host)) {
    try {
      register(tool)
      registered.push(tool.name)
    } catch {
      // Most likely a duplicate name left over from an earlier registration: replace it once.
      try {
        modelContext.unregisterTool?.(tool.name)
        register(tool)
        registered.push(tool.name)
      } catch {
        // WebMCP refused the tool; the app works without it
      }
    }
  }
  return () => {
    for (const name of registered) {
      try {
        modelContext.unregisterTool?.(name)
      } catch {
        // already gone
      }
    }
  }
}
