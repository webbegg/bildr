import { describe, expect, it } from 'vitest'
import { applyOperation, applyOperations } from '#shared/document/operations'
import { createCollection, createProject } from '#shared/document/factory'
import { CollectionSourceSchema, ProjectSchema } from '#shared/document/schema'
import type { CollectionSource, Connection, Project } from '#shared/document/schema'

const CONNECTION: Connection = {
  id: 'con_1',
  name: 'Blog API',
  baseUrl: 'https://api.example.com/v1',
  headers: [{ name: 'X-Key', value: '{{ env.KEY }}' }]
}

const SOURCE: CollectionSource = {
  type: 'connection',
  connectionId: 'con_1',
  endpoints: {
    list: { method: 'GET', path: '/posts', itemsPath: 'data' },
    get: { method: 'GET', path: '/posts/{id}' },
    update: { method: 'PATCH', path: '/posts/{id}', itemPath: 'data' }
  }
}

function withConnection(): Project {
  const project = createProject('Remote')
  applyOperation(project, { op: 'addConnection', index: 0, connection: CONNECTION })
  return project
}

describe('connection schema', () => {
  it('backfills connections on projects saved before they existed', () => {
    const { connections: _connections, ...old } = createProject('Old')
    expect(ProjectSchema.parse(old).connections).toEqual([])
    expect(createProject('New').connections).toEqual([])
  })

  it('accepts a connection source with optional endpoints', () => {
    expect(CollectionSourceSchema.parse(SOURCE)).toEqual(SOURCE)
    expect(CollectionSourceSchema.parse({ type: 'connection', connectionId: 'con_1', idPath: 'uuid', endpoints: {} })).toMatchObject({ idPath: 'uuid' })
  })

  it('refuses unknown methods and paths that are not relative', () => {
    const endpoint = (list: object) => CollectionSourceSchema.safeParse({ ...SOURCE, endpoints: { list } }).success
    expect(endpoint({ method: 'TRACE', path: '/posts' })).toBe(false)
    expect(endpoint({ method: 'get', path: '/posts' })).toBe(false)
    for (const path of ['//evil.com/x', 'https://evil.com', '/../x', '/a\\b']) expect(endpoint({ method: 'GET', path }), path).toBe(false)
    expect(endpoint({ method: 'GET', path: '/{{ env.VERSION }}/posts?key={{ env.KEY }}' })).toBe(true)
  })

  it('refuses List and Get endpoints that do not use GET; the others take any method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const op of ['list', 'get']) {
        const parsed = CollectionSourceSchema.safeParse({ ...SOURCE, endpoints: { [op]: { method, path: '/posts' } } })
        expect(parsed.error?.issues[0]?.message, `${op} ${method}`).toBe('List and Get endpoints use GET')
      }
      for (const op of ['create', 'update', 'delete']) {
        expect(CollectionSourceSchema.safeParse({ ...SOURCE, endpoints: { [op]: { method, path: '/posts' } } }).success, `${op} ${method}`).toBe(true)
      }
    }
  })

  it('reads List and Get endpoints stored with another method as GET', () => {
    const project = withConnection()
    const legacy = { ...SOURCE, endpoints: { list: { method: 'POST', path: '/posts', itemsPath: 'data' }, get: { method: 'PUT', path: '/posts/{id}' }, update: SOURCE.endpoints.update } }
    project.collections.push({ ...createCollection('Posts', 'posts', [], SOURCE), source: legacy as CollectionSource })
    expect(ProjectSchema.parse(project).collections[0]!.source).toEqual(SOURCE)
  })

  it('refuses a collection whose connection does not exist', () => {
    const project = createProject('Broken')
    project.collections.push(createCollection('Posts', 'posts', [], SOURCE))
    expect(ProjectSchema.safeParse(project).error?.issues[0]?.message).toBe('Collection "Posts" uses the missing connection "con_1"')
  })

  it('refuses a connection base URL that is not absolute http(s)', () => {
    const project = createProject('Bad')
    expect(() => applyOperation(project, { op: 'addConnection', index: 0, connection: { ...CONNECTION, baseUrl: '/v1' } })).toThrow('Invalid connection')
    expect(() => applyOperation(project, { op: 'addConnection', index: 0, connection: { ...CONNECTION, baseUrl: 'ftp://x.com' } })).toThrow('Only http and https')
  })
})

describe('connection operations', () => {
  it('adds a connection with a remove inverse', () => {
    const project = createProject('Remote')
    const inverse = applyOperation(project, { op: 'addConnection', index: 0, connection: CONNECTION })
    expect(project.connections).toEqual([CONNECTION])
    expect(inverse).toEqual({ op: 'removeConnection', connectionId: 'con_1' })
    applyOperation(project, inverse)
    expect(project.connections).toEqual([])
  })

  it('updates name, base URL and headers and restores them on undo', () => {
    const project = withConnection()
    const inverse = applyOperation(project, { op: 'updateConnection', connectionId: 'con_1', name: 'Blog', baseUrl: 'https://{{ env.HOST }}/v2', headers: [] })
    expect(project.connections[0]).toEqual({ ...CONNECTION, name: 'Blog', baseUrl: 'https://{{ env.HOST }}/v2', headers: [] })
    applyOperation(project, inverse)
    expect(project.connections[0]).toEqual(CONNECTION)
    expect(() => applyOperation(project, { op: 'updateConnection', connectionId: 'nope', name: 'x' })).toThrow('Connection "nope" not found')
  })

  it('needs the connection for a connection collection', () => {
    const project = createProject('Remote')
    expect(() => applyOperation(project, { op: 'addCollection', index: 0, collection: createCollection('Posts', 'posts', [], SOURCE) })).toThrow('Connection "con_1" not found')
    const posts = createCollection('Posts', 'posts')
    applyOperation(project, { op: 'addCollection', index: 0, collection: posts })
    expect(() => applyOperation(project, { op: 'setSource', collectionId: posts.id, source: SOURCE, fields: [] })).toThrow('Connection "con_1" not found')
  })

  it('refuses removing a connection that collections use; removing both is one undoable batch', () => {
    const project = withConnection()
    const posts = createCollection('Posts', 'posts', [{ key: 'title', label: 'Title', type: 'text' }], SOURCE)
    applyOperation(project, { op: 'addCollection', index: 0, collection: posts })
    expect(() => applyOperation(project, { op: 'removeConnection', connectionId: 'con_1' })).toThrow('"Blog API" is used by Posts')
    const before = structuredClone(project)
    const inverse = applyOperations(project, [{ op: 'removeCollection', collectionId: posts.id }, { op: 'removeConnection', connectionId: 'con_1' }])
    expect(project.connections).toEqual([])
    expect(project.collections).toEqual([])
    applyOperations(project, inverse)
    expect(project).toEqual(before)
    expect(ProjectSchema.safeParse(project).success).toBe(true)
  })
})
