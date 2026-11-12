import { describe, expect, it } from 'vitest'
import { createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'
import type { Project } from '#shared/document/schema'

const DESKTOP_HINT = '(use max-lg:, max-md: or max-sm:)'
const MOBILE_HINT = '(use sm:, md: or lg:)'

const issues = (project: unknown) => {
  const parsed = ProjectSchema.safeParse(project)
  return parsed.success ? [] : parsed.error.issues.map(i => i.message)
}

function withStyle(base: Project['breakpointBase'], style: Record<string, string>): Project {
  const project = createProject('Demo', base)
  project.pages[0]!.root.children.push({ id: 'n-text', type: 'Text', props: {}, style, children: [] })
  return project
}

describe('ProjectSchema.breakpointBase (S37)', () => {
  it('reads a project saved without one as mobile-first', () => {
    const { breakpointBase, ...legacy } = createProject('Old', 'mobile')
    expect(breakpointBase).toBe('mobile')
    expect(ProjectSchema.parse(legacy).breakpointBase).toBe('mobile')
  })

  it('creates desktop-first projects unless asked for mobile', () => {
    expect(createProject('New').breakpointBase).toBe('desktop')
    expect(createProject('Phone', 'mobile').breakpointBase).toBe('mobile')
    expect(issues({ ...createProject('X'), breakpointBase: 'tablet' })).not.toEqual([])
  })

  it('accepts each base\'s own prefixes on page nodes and refuses the other\'s, naming the allowed ones', () => {
    expect(issues(withStyle('desktop', { 'align': 'left', 'max-lg:align': 'center' }))).toEqual([])
    expect(issues(withStyle('mobile', { 'align': 'left', 'md:align': 'center' }))).toEqual([])
    expect(issues(withStyle('desktop', { 'md:align': 'center' }))).toEqual([`Breakpoint "md" in style token "md:align" is for mobile-first projects; this project is desktop-first ${DESKTOP_HINT}`])
    expect(issues(withStyle('mobile', { 'max-lg:align': 'center' }))).toEqual([`Breakpoint "max-lg" in style token "max-lg:align" is for desktop-first projects; this project is mobile-first ${MOBILE_HINT}`])
    // A legacy project (no field) is mobile-first.
    const { breakpointBase: _, ...legacy } = withStyle('desktop', { 'max-lg:align': 'center' })
    expect(issues(legacy)).toHaveLength(1)
  })

  it('checks component and layout trees, variant overrides and removed keys against the base', () => {
    const project = createProject('Demo')
    project.components.push({
      id: 'c1',
      name: 'Card',
      root: { id: 'r', type: 'Container', props: {}, style: { 'md:p': '4' }, children: [] },
      properties: [{ id: 'pad', name: 'Pad', kind: 'text', bindings: [{ nodeId: 'r', prop: 'sm:p', target: 'style' }] }],
      variants: [{ id: 'v1', name: 'Big', overrides: { r: { style: { 'lg:p': '8' }, unset: ['md:gap'] } } }]
    })
    project.layouts.push({
      id: 'l1',
      name: 'Shell',
      root: { id: 'lr', type: 'Page', props: {}, style: { 'sm:gap': '4' }, children: [{ id: 'slot', type: 'Container', props: {}, style: {}, children: [] }] },
      slots: [{ id: 'children', name: 'Content', nodeId: 'slot' }],
      variables: []
    })
    const messages = issues(project)
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('"md:p" is for mobile-first projects'),
      expect.stringContaining('"lg:p" is for mobile-first projects'),
      expect.stringContaining('"md:gap" is for mobile-first projects'),
      expect.stringContaining('"sm:p"'),
      expect.stringContaining('"sm:gap" is for mobile-first projects')
    ]))
    expect(messages.filter(m => m.includes('mobile-first projects')).every(m => m.endsWith(DESKTOP_HINT))).toBe(true)
  })
})
