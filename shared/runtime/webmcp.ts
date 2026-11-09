import type { Page, Project } from '../document/schema'
import { pageOutline } from './render'

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
  getProject: () => Project | undefined
  getCurrentPage: () => Page | undefined
  /** Navigates the app router to a path such as `/p/shop/pricing`. */
  navigate: (path: string) => unknown
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

const pageUrl = (project: Project, page: Page) => `/p/${project.slug}/${page.slug}`

function tools(host: WebMcpHost): WebMcpTool[] {
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
        return page ? text(pageOutline(page)) : text('No page is shown', true)
      }
    }
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
