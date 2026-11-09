import { describe, expect, it } from 'vitest'
import { getComponent, isContainerType } from '#shared/document/components'
import { createNode, createProject } from '#shared/document/factory'
import { ProjectSchema, propValueProblem } from '#shared/document/schema'

describe('List component', () => {
  it('is a palette container bound to a collection', () => {
    const list = getComponent('List')!
    expect(list.icon).toBe('i-lucide-list')
    expect(isContainerType('List')).toBe(true)
    expect(list.props.map(p => p.name)).toEqual(['collection', 'limit', 'sortField', 'sortDir', 'filterField', 'filterValue', 'layout'])
  })

  it('starts unbound, showing 10 records stacked in ascending order', () => {
    expect(createNode('List').props).toEqual({
      collection: '', limit: 10, sortField: '', sortDir: 'asc', filterField: '', filterValue: '', layout: 'stack'
    })
    expect(getComponent('List')!.props.find(p => p.name === 'sortDir')!.options).toEqual(['asc', 'desc'])
    expect(getComponent('List')!.props.find(p => p.name === 'layout')!.options).toEqual(['stack', 'grid', 'row'])
  })

  it('accepts a List with a template in a project', () => {
    const project = createProject('Café')
    const list = createNode('List', { collection: 'menu', sortField: 'price' })
    list.children.push(createNode('Text', { text: '{{ item.name }}' }))
    project.pages[0]!.root.children.push(list)
    expect(ProjectSchema.safeParse(project).success).toBe(true)
  })
})

describe('collection prop kind', () => {
  const def = getComponent('List')!.props.find(p => p.name === 'collection')!

  it('takes a collection slug, or empty for none', () => {
    expect(def.kind).toBe('collection')
    expect(propValueProblem(def, 'menu')).toBeUndefined()
    expect(propValueProblem(def, 'menu-items')).toBeUndefined()
    expect(propValueProblem(def, '')).toBeUndefined()
  })

  it('rejects values that are not slugs', () => {
    expect(propValueProblem(def, 'Menu Items')).toBe('"collection" must be a collection slug, e.g. menu')
    expect(propValueProblem(def, 3)).toBe('"collection" must be a collection slug, e.g. menu')
  })
})
