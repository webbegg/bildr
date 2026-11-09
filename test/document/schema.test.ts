import { describe, expect, it } from 'vitest'
import { ProjectSchema, propValueProblem } from '#shared/document/schema'
import { COMPONENTS, getComponent } from '#shared/document/components'
import { cloneWithNewIds, createNode, createProject, slugify } from '#shared/document/factory'
import { findParent, walk } from '#shared/document/tree'
import { styleTokenProblem } from '#shared/design/tokens'
import { DEFAULT_THEME } from '#shared/design/theme'

describe('document schema', () => {
  it('accepts a freshly created project', () => {
    expect(ProjectSchema.safeParse(createProject('My App')).success).toBe(true)
  })

  it('gives new projects the default theme', () => {
    expect(createProject('My App').theme).toEqual(DEFAULT_THEME)
  })

  it('fills the default theme for a project saved before themes existed', () => {
    const { theme: _theme, ...legacy } = createProject('Old')
    expect(ProjectSchema.parse(legacy).theme).toEqual(DEFAULT_THEME)
  })

  it('rejects an invalid theme', () => {
    const project = createProject('My App')
    project.theme.colors.primary = 'grass'
    expect(ProjectSchema.safeParse(project).success).toBe(false)
  })

  it('rejects a node with an unknown component type', () => {
    const project = createProject('My App')
    project.pages[0]!.root.children.push({ id: 'x', type: 'Marquee', props: {}, style: {}, children: [] })
    const result = ProjectSchema.safeParse(project)
    expect(result.success).toBe(false)
  })

  it('rejects style values that are not design tokens', () => {
    const project = createProject('My App')
    const text = createNode('Text')
    text.style = { padding: '16px' }
    project.pages[0]!.root.children.push(text)
    expect(ProjectSchema.safeParse(project).success).toBe(false)

    text.style = { mt: '13' }
    expect(ProjectSchema.safeParse(project).success).toBe(false)

    text.style = { mt: '10', color: 'error' }
    expect(ProjectSchema.safeParse(project).success).toBe(true)

    text.style = { 'mt': '2', 'md:mt': '10' }
    expect(ProjectSchema.safeParse(project).success).toBe(true)

    text.style = { 'xl:mt': '10' }
    expect(ProjectSchema.safeParse(project).success).toBe(false)
  })

  it('rejects children under a non-container component', () => {
    const project = createProject('My App')
    const text = createNode('Text')
    text.children.push(createNode('Text'))
    project.pages[0]!.root.children.push(text)
    expect(ProjectSchema.safeParse(project).success).toBe(false)
  })
})

describe('component registry', () => {
  it('ships the MVP palette', () => {
    expect(COMPONENTS.map(c => c.type)).toEqual(
      ['Container', 'Row', 'Column', 'Grid', 'Heading', 'Text', 'Image', 'Button', 'Link', 'Input', 'List', 'Form', 'Card']
    )
  })

  it('ships a Grid container with three columns by default', () => {
    expect(getComponent('Grid')).toMatchObject({ container: true, icon: 'i-lucide-layout-grid' })
    expect(createNode('Grid').style).toEqual({ cols: '3', gap: '6' })
  })

  it('aligns the children of stacked containers to the start by default', () => {
    expect(createNode('Container').style).toEqual({ p: '4', gap: '3', items: 'start' })
    expect(createNode('Column').style).toEqual({ gap: '3', items: 'start' })
    expect(createNode('Card').style).toEqual({ gap: '3', items: 'start' })
    expect(createProject('My App').pages[0]!.root.style).toEqual({ gap: '4', items: 'start', color: 'default' })
  })

  it('lets Text inherit its colour', () => {
    expect(createNode('Text').style).toEqual({})
  })

  it('gives Button a leading and trailing icon and Link a leading icon, empty by default', () => {
    expect(createNode('Button').props).toMatchObject({ icon: '', trailingIcon: '' })
    expect(createNode('Link').props).toMatchObject({ icon: '' })
    expect(getComponent('Button')!.props.find(p => p.name === 'icon')!.kind).toBe('icon')
  })

  it('accepts an empty or i-lucide-* icon and rejects anything else', () => {
    const icon = getComponent('Button')!.props.find(p => p.name === 'icon')!
    expect(propValueProblem(icon, '')).toBeUndefined()
    expect(propValueProblem(icon, 'i-lucide-coffee')).toBeUndefined()
    expect(propValueProblem(icon, 'i-lucide-arrow-right-2')).toBeUndefined()
    for (const bad of ['coffee', 'i-lucide-', 'i-heroicons-star', 'i-lucide-Coffee', 'i-lucide-a--b', 42]) {
      expect(propValueProblem(icon, bad)).toBe('"icon" must be an i-lucide-* icon name, e.g. i-lucide-coffee')
    }
  })

  it('declares default styles as design tokens', () => {
    for (const def of COMPONENTS) {
      for (const [key, value] of Object.entries(def.defaultStyle)) expect(styleTokenProblem(key, value)).toBeUndefined()
    }
    expect(createNode('Row').style).toEqual({ gap: '3', items: 'center' })
    expect(createNode('Image').style).toEqual({ w: 'full' })
  })

  it('creates nodes with the default props of their component', () => {
    const node = createNode('Heading')
    const def = getComponent('Heading')!
    for (const prop of def.props) expect(node.props[prop.name]).toEqual(prop.default)
  })
})

describe('factory helpers', () => {
  it('slugifies names', () => {
    expect(slugify('  Hello, Wörld! ')).toBe('hello-world')
    expect(slugify('!!!')).toBe('page')
  })

  it('clones a subtree with fresh ids', () => {
    const row = createNode('Row')
    row.children.push(createNode('Text'))
    const copy = cloneWithNewIds(row)
    const ids = new Set<string>()
    walk(row, n => ids.add(n.id))
    walk(copy, n => expect(ids.has(n.id)).toBe(false))
    expect(copy.children[0]!.type).toBe('Text')
  })

  it('finds the parent and index of a node', () => {
    const row = createNode('Row')
    const a = createNode('Text')
    const b = createNode('Text')
    row.children.push(a, b)
    expect(findParent(row, b.id)).toEqual({ parent: row, index: 1 })
    expect(findParent(row, row.id)).toBeUndefined()
  })
})
