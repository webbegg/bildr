import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { drillTarget, navigateSelection, selectAllSiblings, siblingParent, toggleSelection, topLevelSelection } from '#shared/editor/selection'

/** Page > [hero: Card > [title: Heading, row: Row > [a: Button, b: Button]], footer: Text]. */
function fixture() {
  const page = createPage('Home')
  const hero = createNode('Card')
  const title = createNode('Heading')
  const row = createNode('Row')
  const [a, b] = [createNode('Button'), createNode('Button')]
  const footer = createNode('Text')
  row.children.push(a, b)
  hero.children.push(title, row)
  page.root.children.push(hero, footer)
  return { root: page.root, hero, title, row, a, b, footer }
}

describe('drillTarget', () => {
  it('selects the clicked element itself in deep mode', () => {
    const { root, a } = fixture()
    expect(drillTarget(root, [], a.id, { deep: true })).toBe(a.id)
  })

  it('selects the top-level child of the page root on a first click', () => {
    const { root, hero, a, footer } = fixture()
    expect(drillTarget(root, [], a.id, { deep: false })).toBe(hero.id)
    expect(drillTarget(root, [], footer.id, { deep: false })).toBe(footer.id)
    expect(drillTarget(root, [], root.id, { deep: false })).toBe(root.id)
  })

  it('selects the direct child toward the clicked element when an ancestor is selected (double-click drills)', () => {
    const { root, hero, row, a } = fixture()
    expect(drillTarget(root, [hero.id], a.id, { deep: false })).toBe(row.id)
    expect(drillTarget(root, [row.id], a.id, { deep: false })).toBe(a.id)
    expect(drillTarget(root, [a.id], a.id, { deep: false })).toBe(a.id)
  })

  it('keeps the drill level: a click inside a sibling of the selection selects at that depth', () => {
    const { root, title, row, a } = fixture()
    expect(drillTarget(root, [title.id], a.id, { deep: false })).toBe(row.id)
    expect(drillTarget(root, [a.id], row.id, { deep: false })).toBe(row.id)
  })

  it('returns null for an unknown node', () => {
    expect(drillTarget(fixture().root, [], 'missing', { deep: false })).toBeNull()
  })
})

describe('toggleSelection', () => {
  it('adds a node at the end (the new primary) or removes it', () => {
    expect(toggleSelection(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(toggleSelection([], 'a')).toEqual(['a'])
  })
})

describe('selectAllSiblings', () => {
  it('selects every child of the primary selection parent', () => {
    const { root, row, a, b } = fixture()
    expect(selectAllSiblings(root, [a.id])).toEqual([a.id, b.id])
    expect(selectAllSiblings(root, [row.id, b.id])).toEqual([a.id, b.id])
  })

  it('selects the page root children with nothing or the root selected', () => {
    const { root, hero, footer } = fixture()
    expect(selectAllSiblings(root, [])).toEqual([hero.id, footer.id])
    expect(selectAllSiblings(root, [root.id])).toEqual([hero.id, footer.id])
  })
})

describe('navigateSelection', () => {
  it('goes to the first child and to the parent', () => {
    const { root, hero, title, row } = fixture()
    expect(navigateSelection(root, hero.id, 'child')).toBe(title.id)
    expect(navigateSelection(root, title.id, 'child')).toBeNull()
    expect(navigateSelection(root, row.id, 'parent')).toBe(hero.id)
    expect(navigateSelection(root, root.id, 'parent')).toBeNull()
  })

  it('steps through siblings, wrapping around', () => {
    const { root, title, row, hero, footer } = fixture()
    expect(navigateSelection(root, title.id, 'next')).toBe(row.id)
    expect(navigateSelection(root, row.id, 'next')).toBe(title.id)
    expect(navigateSelection(root, hero.id, 'prev')).toBe(footer.id)
    expect(navigateSelection(root, root.id, 'next')).toBeNull()
  })
})

describe('topLevelSelection', () => {
  it('drops the root, unknown ids, duplicates and nodes inside another selected node', () => {
    const { root, hero, a, footer } = fixture()
    expect(topLevelSelection(root, [a.id, hero.id, root.id, 'missing', footer.id, footer.id])).toEqual([hero.id, footer.id])
  })
})

describe('siblingParent', () => {
  it('is the shared parent of sibling nodes, else undefined', () => {
    const { root, row, a, b, title } = fixture()
    expect(siblingParent(root, [a.id, b.id])?.id).toBe(row.id)
    expect(siblingParent(root, [a.id, title.id])).toBeUndefined()
    expect(siblingParent(root, [root.id])).toBeUndefined()
    expect(siblingParent(root, [])).toBeUndefined()
  })
})
