import { itemsAt, mapItems } from '#shared/data/apiSource'
import { PAGING_MAX_RECORDS, sourcePaging } from '#shared/data/paging'
import type { PagedRecords, Paging } from '#shared/data/paging'
import { remoteId } from '#shared/data/remote'
import type { DataRecord } from '#shared/data/records'
import { defaultTheme } from '#shared/design/theme'
import { applyOperations } from '#shared/document/operations'
import type { Operation } from '#shared/document/operations'
import { headerValueProblem } from '#shared/document/schema'
import type { ApiHeader, Collection, Connection, Project, PublishedSnapshot } from '#shared/document/schema'
import { allEnv, publicEnv, redact, resolveEnv, secretValues } from '#shared/env/variables'
import { createApiFetcher } from '../utils/apiFetch'
import type { ApiFetcher, ApiResponse } from '../utils/apiFetch'
import { createEnvStore } from '../utils/envStore'
import { createProjectStore } from '../utils/projectStore'
import { createRecordStore } from '../utils/recordStore'
import { createRemote } from '../utils/remote'
import type { KeyValueStorage } from '../utils/projectStore'
import { ActionError } from './define'
import type { ActionContext } from './define'

export interface HistoryEntry {
  label: string
  ops: Operation[]
  inverse: Operation[]
}

interface History {
  undo: HistoryEntry[]
  redo: HistoryEntry[]
}

const UNDO_LIMIT = 100

/** Projects saved before themes, collections, API sources or connections existed read with the defaults. */
function withDefaults(project: Project): Project {
  project.theme ??= defaultTheme()
  project.collections ??= []
  project.connections ??= []
  for (const collection of project.collections) collection.source ??= { type: 'internal' }
  return project
}

interface ApiSourceInput {
  url: string
  headers?: ApiHeader[]
}

export interface ServicesOptions {
  /** Fetches API sources; tests inject one with a fake transport. */
  api?: ApiFetcher
}

/** The items array at `itemsPath` of a fetched API response. */
export function apiItems(json: unknown, itemsPath: string): unknown[] {
  const items = itemsAt(json, itemsPath)
  if (!items) throw new ActionError('invalid', `The API response has no list of items at "${itemsPath}"`)
  return items
}

/** The rows of a fetched API response, mapped with `fields` and stamped with the fetch time. */
export function apiRecords(json: unknown, fetchedAt: string, collection: Pick<Collection, 'fields'>, itemsPath: string): DataRecord[] {
  return mapItems(apiItems(json, itemsPath), collection.fields).map(row => ({ id: row.id, createdAt: fetchedAt, updatedAt: fetchedAt, values: row.values }))
}

/**
 * Server-side state the actions share. Undo lives here, not in the editor,
 * so an agent can undo too and every tab sees the same history.
 */
export function createServices(storage: KeyValueStorage, options: ServicesOptions = {}) {
  const projects = createProjectStore(storage)
  const records = createRecordStore(storage)
  const env = createEnvStore(storage)
  const api = options.api ?? createApiFetcher()
  const remote = createRemote(api, env)

  async function loadProject(projectId: string): Promise<Project> {
    const project = await projects.get(projectId)
    if (!project) throw new ActionError('not_found', `Project "${projectId}" not found`)
    return withDefaults(project)
  }

  /** The last published copy of the project, if any. */
  async function publishedSnapshot(projectId: string): Promise<PublishedSnapshot | undefined> {
    const snapshot = await storage.getItem<PublishedSnapshot>(`published:${projectId}`)
    if (snapshot) withDefaults(snapshot.project)
    return snapshot ?? undefined
  }

  async function loadHistory(projectId: string): Promise<History> {
    return await storage.getItem<History>(`history:${projectId}`) ?? { undo: [], redo: [] }
  }

  /**
   * Fetches an API source with its `{{ env.NAME }}` refs resolved from the
   * project's current variables (public and secret). The resolved URL gets
   * the full checks in the fetcher; every failure message is redacted, so it
   * never carries a secret value.
   */
  async function fetchApi(projectId: string, source: ApiSourceInput): Promise<ApiResponse> {
    return withApiSource(projectId, source, ({ url, headers }) => api.fetchJson(url, { headers }))
  }

  /** Runs `task` with the source's URL and headers resolved, its failure messages redacted. */
  async function withApiSource<T>(projectId: string, source: ApiSourceInput, task: (resolved: { url: string, headers: Record<string, string> }) => Promise<T>): Promise<T> {
    const vars = await env.list(projectId)
    const values = allEnv(vars)
    const onMissing = (name: string): never => {
      throw new ActionError('invalid', `The API source uses the variable "${name}", which is not set`)
    }
    const url = resolveEnv(source.url, values, { onMissing })
    const headers: Record<string, string> = {}
    for (const header of source.headers ?? []) {
      const value = resolveEnv(header.value, values, { onMissing })
      const problem = headerValueProblem(value)
      if (problem) throw new ActionError('invalid', `The header "${header.name}" has an invalid value: ${problem}`)
      headers[header.name.toLowerCase()] = value
    }
    try {
      return await task({ url, headers })
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), secretValues(vars))
      throw new ActionError(error instanceof ActionError ? error.code : 'invalid', message)
    }
  }

  /** The origin of an API source's resolved URL, which its next-page URLs must keep. */
  const originOf = (url: string): string => {
    try {
      return new URL(url).origin
    } catch {
      throw new ActionError('invalid', 'Invalid URL')
    }
  }

  async function collectionPage(projectId: string, collection: Collection, connections: Connection[] | undefined, { offset, limit }: { offset: number, limit: number }): Promise<PagedRecords> {
    const { source } = collection
    if (source.type === 'connection' && source.endpoints.list?.paging) {
      return remote.page(projectId, connections ?? (await loadProject(projectId)).connections, collection, { offset, limit })
    }
    if (source.type === 'api' && source.paging) {
      const paging = source.paging
      const { items, total, hasMore, fetchedAt } = await withApiSource(projectId, source, ({ url, headers }) =>
        api.fetchPages(url, { headers, paging, itemsPath: source.itemsPath, origin: originOf(url), offset, limit }))
      const rows = mapItems(items, collection.fields)
      const records = rows.map((row, i) => ({ id: remoteId(items[i]) ?? String(offset + i), createdAt: fetchedAt, updatedAt: fetchedAt, values: row.values }))
      return { records, total, hasMore }
    }
    const all = await collectionRecords(projectId, collection, connections)
    return { records: all.slice(offset, offset + limit), total: all.length, hasMore: false }
  }

  /**
   * A collection's records: stored ones, or for an API or connection
   * collection the fetched items mapped with its fields (for a paged one,
   * the pages up to the caps). A connection collection reads through
   * `connections` (the published ones for public reads), the draft's when
   * left out.
   */
  async function collectionRecords(projectId: string, collection: Collection, connections?: Connection[]): Promise<DataRecord[]> {
    if (collection.source.type === 'internal') return records.list(projectId, collection.id)
    if (collection.source.type === 'connection') return remote.list(projectId, connections ?? (await loadProject(projectId)).connections, collection)
    if (collection.source.paging) return (await collectionPage(projectId, collection, connections, { offset: 0, limit: PAGING_MAX_RECORDS })).records
    const { json, fetchedAt } = await fetchApi(projectId, collection.source)
    return apiRecords(json, fetchedAt, collection, collection.source.itemsPath)
  }

  async function commit(ctx: ActionContext, project: Project, ops: Operation[]): Promise<{ project: Project, inverse: Operation[] }> {
    const inverse = applyOperations(project, ops)
    project.version += 1
    project.updatedAt = new Date().toISOString()
    await projects.save(project)
    ctx.notify(project.id, project.version)
    return { project, inverse }
  }

  return {
    projects,
    records,
    env,
    api,
    remote,
    storage,
    loadProject,
    fetchApi,
    collectionRecords,

    /**
     * Records `offset` to `offset + limit - 1` with the total and whether more
     * follow: a paged API or connection collection reads only the pages it
     * needs (within the paging caps); any other is read whole and sliced.
     */
    collectionPage,

    /** Whether a collection's list is paged (see `shared/data/paging`). */
    isPaged: (collection: Collection): boolean => sourcePaging(collection.source) !== undefined,

    /** Page two of an API source preview whose first page was `first`; null when there is none. Failures are redacted. */
    async previewPageTwo(projectId: string, source: ApiSourceInput, paging: Paging, first: ApiResponse): Promise<ApiResponse | null> {
      return withApiSource(projectId, source, async ({ url, headers }) => {
        const next = api.pageTwoUrl(url, paging, first, originOf(url))
        return next === null ? null : api.fetchJson(next, { headers })
      })
    },

    /** Applies `ops` atomically, saves, and records one undo step named `label`. */
    async mutate(ctx: ActionContext, projectId: string, label: string, ops: Operation[]): Promise<Project> {
      const { project, inverse } = await commit(ctx, await loadProject(projectId), ops)
      const history = await loadHistory(projectId)
      history.undo = [...history.undo, { label, ops, inverse }].slice(-UNDO_LIMIT)
      history.redo = []
      await storage.setItem(`history:${projectId}`, history)
      return project
    },

    async undo(ctx: ActionContext, projectId: string): Promise<{ project: Project, label: string }> {
      const history = await loadHistory(projectId)
      const entry = history.undo.pop()
      if (!entry) throw new ActionError('invalid', 'Nothing to undo')
      const { project } = await commit(ctx, await loadProject(projectId), entry.inverse)
      history.redo.push(entry)
      await storage.setItem(`history:${projectId}`, history)
      return { project, label: entry.label }
    },

    async redo(ctx: ActionContext, projectId: string): Promise<{ project: Project, label: string }> {
      const history = await loadHistory(projectId)
      const entry = history.redo.pop()
      if (!entry) throw new ActionError('invalid', 'Nothing to redo')
      const { project } = await commit(ctx, await loadProject(projectId), entry.ops)
      history.undo.push(entry)
      await storage.setItem(`history:${projectId}`, history)
      return { project, label: entry.label }
    },

    /**
     * Renames the project, keeping its slug (and so its published URLs). Project
     * metadata is not part of the node undo history, so this records no step.
     */
    async rename(ctx: ActionContext, projectId: string, name: string): Promise<Project> {
      const project = await loadProject(projectId)
      project.name = name
      return (await commit(ctx, project, [])).project
    },

    /** Copies the current draft and its PUBLIC variables to the published slot, served at `/p/:slug`. */
    async publish(projectId: string): Promise<PublishedSnapshot> {
      const project = await loadProject(projectId)
      const snapshot = { project, publishedAt: new Date().toISOString(), env: publicEnv(await env.list(projectId)) }
      await storage.setItem(`published:${projectId}`, snapshot)
      return snapshot
    },

    async getPublished(slug: string): Promise<PublishedSnapshot | undefined> {
      const project = await projects.getBySlug(slug)
      return project ? publishedSnapshot(project.id) : undefined
    },

    publishedSnapshot,

    /**
     * Deletes the project and everything stored for it. The published snapshot
     * goes first, so a crash part-way never serves an app whose data is gone,
     * and the document last, so a retry still finds the project and finishes.
     */
    async deleteProject(ctx: ActionContext, projectId: string, confirm: string): Promise<Project> {
      const project = await loadProject(projectId)
      if (confirm !== project.slug) throw new ActionError('invalid', 'Type the project slug to confirm')
      await storage.removeItem(`published:${projectId}`)
      await records.removeAll(projectId)
      await env.remove(projectId)
      await storage.removeItem(`history:${projectId}`)
      await storage.removeItem(`editor-context:${projectId}`)
      await projects.remove(projectId)
      ctx.notify(projectId, project.version + 1)
      return project
    },

    async historyState(projectId: string): Promise<{ undo: string | null, redo: string | null }> {
      const history = await loadHistory(projectId)
      return { undo: history.undo.at(-1)?.label ?? null, redo: history.redo.at(-1)?.label ?? null }
    }
  }
}

export type Services = ReturnType<typeof createServices>
