import { describe, expect, it } from 'vitest'
import { applyOperation, applyOperations, OperationError } from '#shared/document/operations'
import { createNode, createPage, createProject } from '#shared/document/factory'
import { findNode } from '#shared/document/tree'
import { ProjectSchema } from '#shared/document/schema'
import type { Project } from '#shared/document/schema'

function setup(): { project: Project, pageId: string, rootId: string } {
  const project = createProject('Demo')
  const page = project.pages[0]!
  return { project, pageId: page.id, rootId: page.root.id }
}

describe('applyOperation', () => {
  it('inserts a node and returns a remove inverse', () => {
    const { project, pageId, rootId } = setup()
    const heading = createNode('Heading')
    const inverse = applyOperation(project, { op: 'insert', pageId, parentId: rootId, index: 0, node: heading })

    expect(project.pages[0]!.root.children[0]!.id).toBe(heading.id)
    expect(inverse).toEqual({ op: 'remove', pageId, nodeId: heading.id })
  })

  it('rejects inserting into a non-container node', () => {
    const { project, pageId, rootId } = setup()
    const text = createNode('Text')
    applyOperation(project, { op: 'insert', pageId, parentId: rootId, index: 0, node: text })

    expect(() => applyOperation(project, { op: 'insert', pageId, parentId: text.id, index: 0, node: createNode('Text') }))
      .toThrow(OperationError)
  })

  it('removes a node and its inverse restores it at the same place', () => {
    const { project, pageId, rootId } = setup()
    const a = createNode('Text')
    const b = createNode('Button')
    applyOperations(project, [
      { op: 'insert', pageId, parentId: rootId, index: 0, node: a },
      { op: 'insert', pageId, parentId: rootId, index: 1, node: b }
    ])

    const inverse = applyOperation(project, { op: 'remove', pageId, nodeId: a.id })
    expect(project.pages[0]!.root.children.map(n => n.id)).toEqual([b.id])

    applyOperation(project, inverse)
    expect(project.pages[0]!.root.children.map(n => n.id)).toEqual([a.id, b.id])
  })

  it('refuses to remove the page root', () => {
    const { project, pageId, rootId } = setup()
    expect(() => applyOperation(project, { op: 'remove', pageId, nodeId: rootId })).toThrow(OperationError)
  })

  it('moves a node and its inverse moves it back', () => {
    const { project, pageId, rootId } = setup()
    const row = createNode('Row')
    const text = createNode('Text')
    applyOperations(project, [
      { op: 'insert', pageId, parentId: rootId, index: 0, node: row },
      { op: 'insert', pageId, parentId: rootId, index: 1, node: text }
    ])

    const inverse = applyOperation(project, { op: 'move', pageId, nodeId: text.id, parentId: row.id, index: 0 })
    expect(findNode(project.pages[0]!.root, row.id)!.children[0]!.id).toBe(text.id)

    applyOperation(project, inverse)
    expect(project.pages[0]!.root.children.map(n => n.id)).toEqual([row.id, text.id])
  })

  it('moving down within the same parent lands at the requested index', () => {
    const { project, pageId, rootId } = setup()
    const [a, b, c] = [createNode('Text'), createNode('Text'), createNode('Text')]
    applyOperations(project, [a, b, c].map((node, index) => ({ op: 'insert' as const, pageId, parentId: rootId, index, node })))

    applyOperation(project, { op: 'move', pageId, nodeId: a.id, parentId: rootId, index: 2 })
    expect(project.pages[0]!.root.children.map(n => n.id)).toEqual([b.id, c.id, a.id])
  })

  it('refuses to move a node into its own descendant', () => {
    const { project, pageId, rootId } = setup()
    const outer = createNode('Column')
    const inner = createNode('Row')
    applyOperations(project, [
      { op: 'insert', pageId, parentId: rootId, index: 0, node: outer },
      { op: 'insert', pageId, parentId: outer.id, index: 0, node: inner }
    ])

    expect(() => applyOperation(project, { op: 'move', pageId, nodeId: outer.id, parentId: inner.id, index: 0 }))
      .toThrow(OperationError)
  })

  it('sets props, deleting keys set to null, with an exact inverse', () => {
    const { project, pageId, rootId } = setup()
    const button = createNode('Button')
    applyOperation(project, { op: 'insert', pageId, parentId: rootId, index: 0, node: button })
    const before = structuredClone(findNode(project.pages[0]!.root, button.id)!.props)

    const inverse = applyOperation(project, { op: 'setProps', pageId, nodeId: button.id, props: { label: 'Go', to: null } })
    const node = findNode(project.pages[0]!.root, button.id)!
    expect(node.props.label).toBe('Go')
    expect('to' in node.props).toBe(false)

    applyOperation(project, inverse)
    expect(findNode(project.pages[0]!.root, button.id)!.props).toEqual(before)
  })

  it('rejects style keys outside the allowed list', () => {
    const { project, pageId, rootId } = setup()
    expect(() => applyOperation(project, { op: 'setStyle', pageId, nodeId: rootId, style: { position: 'fixed' } }))
      .toThrow(OperationError)
  })

  it('adds, updates and removes pages with inverses', () => {
    const { project } = setup()
    const about = createPage('About')
    const removeInverse = applyOperation(project, { op: 'addPage', index: 1, page: about })
    expect(project.pages.map(p => p.slug)).toEqual(['home', 'about'])

    const renameInverse = applyOperation(project, { op: 'updatePage', pageId: about.id, name: 'Team', slug: 'team' })
    expect(project.pages[1]!.slug).toBe('team')
    applyOperation(project, renameInverse)
    expect(project.pages[1]!.slug).toBe('about')

    applyOperation(project, removeInverse)
    expect(project.pages.map(p => p.slug)).toEqual(['home'])
  })

  it('rejects a duplicate page slug and removing the last page', () => {
    const { project, pageId } = setup()
    expect(() => applyOperation(project, { op: 'addPage', index: 1, page: createPage('Home') })).toThrow(OperationError)
    expect(() => applyOperation(project, { op: 'removePage', pageId })).toThrow(OperationError)
  })

  it('applyOperations is atomic: a failing op leaves the project untouched', () => {
    const { project, pageId, rootId } = setup()
    const before = structuredClone(project)
    expect(() => applyOperations(project, [
      { op: 'insert', pageId, parentId: rootId, index: 0, node: createNode('Text') },
      { op: 'remove', pageId, nodeId: 'missing' }
    ])).toThrow(OperationError)
    expect(project).toEqual(before)
  })

  it('keeps the project valid against the schema', () => {
    const { project, pageId, rootId } = setup()
    applyOperation(project, { op: 'insert', pageId, parentId: rootId, index: 0, node: createNode('Card') })
    expect(ProjectSchema.safeParse(project).success).toBe(true)
  })
})
