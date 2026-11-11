import { describe, expect, it } from 'vitest'
import { createNode, createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'
import type { DocNode } from '#shared/document/schema'
import { isLockedAt } from '#shared/document/tree'

const n = (id: string, type: string, children: DocNode[] = [], extra: Partial<DocNode> = {}): DocNode =>
  ({ id, type, props: {}, style: {}, children, ...extra })

describe('node name and locked (S4a)', () => {
  it('keeps an optional layer name and locked flag through the schema', () => {
    const project = createProject('P')
    const text = { ...createNode('Text'), name: 'Hero title', locked: true }
    project.pages[0]!.root.children.push(text)
    const parsed = ProjectSchema.parse(project)
    expect(parsed.pages[0]!.root.children[0]).toMatchObject({ name: 'Hero title', locked: true })
  })

  it('leaves nodes without them unchanged', () => {
    const project = createProject('P')
    project.pages[0]!.root.children.push(createNode('Text'))
    const parsed = ProjectSchema.parse(structuredClone(project))
    expect(parsed.pages[0]!.root.children[0]).toEqual(project.pages[0]!.root.children[0])
    expect('name' in parsed.pages[0]!.root.children[0]!).toBe(false)
  })

  it('refuses an empty or overlong name and a non-boolean locked', () => {
    for (const extra of [{ name: '' }, { name: 'x'.repeat(101) }, { locked: 'yes' }]) {
      const project = createProject('P')
      project.pages[0]!.root.children.push({ ...createNode('Text'), ...extra } as DocNode)
      expect(ProjectSchema.safeParse(project).success, JSON.stringify(extra)).toBe(false)
    }
  })
})

describe('isLockedAt', () => {
  const root = n('root', 'Page', [
    n('card', 'Card', [n('title', 'Heading'), n('inner', 'Container', [n('deep', 'Text')], { locked: false })], { locked: true }),
    n('free', 'Text'),
    n('self', 'Text', [], { locked: true })
  ])

  it('is true for a locked node and everything inside it', () => {
    expect(isLockedAt(root, 'card')).toBe(true)
    expect(isLockedAt(root, 'title')).toBe(true)
    expect(isLockedAt(root, 'deep')).toBe(true)
    expect(isLockedAt(root, 'self')).toBe(true)
  })

  it('is false for unlocked nodes, the root and missing ids', () => {
    expect(isLockedAt(root, 'free')).toBe(false)
    expect(isLockedAt(root, 'root')).toBe(false)
    expect(isLockedAt(root, 'ghost')).toBe(false)
  })
})
