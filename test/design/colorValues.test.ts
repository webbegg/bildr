import { describe, expect, it } from 'vitest'
import { customColorVar, orderedStyleTokens, styleClasses, styleInline, styleTokenProblem } from '#shared/design/tokens'
import { createNode, createProject } from '#shared/document/factory'
import { ProjectSchema } from '#shared/document/schema'

describe('hex colours on colour style keys (S4b)', () => {
  it('accepts #rgb, #rrggbb and #rrggbbaa on every colour key', () => {
    for (const key of ['bg', 'color', 'borderColor']) {
      for (const value of ['#f00', '#FF0000', '#ff000080']) expect(styleTokenProblem(key, value), `${key}: ${value}`).toBeUndefined()
    }
  })

  it('refuses other hex lengths and hex on non-colour keys', () => {
    expect(styleTokenProblem('bg', '#ff')).toBe('"#ff" is not a value of style token "bg" (use a colour token, a #rgb, #rrggbb or #rrggbbaa hex, or a theme colour)')
    expect(styleTokenProblem('bg', '#ff00')).toBeDefined()
    expect(styleTokenProblem('bg', '#gg0000')).toBeDefined()
    expect(styleTokenProblem('mt', '#fff')).toBe('"#fff" is not a value of style token "mt"')
  })

  it('validates hex colours in documents', () => {
    const project = createProject('P')
    project.pages[0]!.root.children.push({ ...createNode('Text'), style: { color: '#123abc', bg: '#fff8' } })
    expect(ProjectSchema.safeParse(project).success).toBe(false)
    project.pages[0]!.root.children[0]!.style = { color: '#123abc', bg: '#ffffff80' }
    expect(ProjectSchema.safeParse(project).success).toBe(true)
  })

  it('renders hex colours as inline styles, not classes', () => {
    const style = { bg: '#ff0000', color: 'primary', borderColor: '#0f08', p: '4' }
    expect(styleClasses({ ...style, borderColor: '#00ff0088' })).toBe('p-4 text-primary')
    expect(styleInline({ ...style, borderColor: '#00ff0088' })).toEqual({ 'background-color': '#ff0000', 'border-color': '#00ff0088' })
    expect(styleInline({ bg: 'primary', p: '4' })).toEqual({})
  })

  it('lists inline colours in orderedStyleTokens with no class', () => {
    const entries = orderedStyleTokens({ bg: '#ff0000', color: 'error' })
    expect(entries.map(e => [e.key, e.value, e.className, e.inline])).toEqual([
      ['bg', '#ff0000', '', { property: 'background-color', value: '#ff0000' }],
      ['color', 'error', 'text-error', undefined]
    ])
  })

  it('renders a theme colour name through its CSS variable', () => {
    expect(customColorVar('brand')).toBe('--bildr-color-brand')
    expect(styleInline({ bg: 'brand', color: 'ink-2' })).toEqual({ 'background-color': 'var(--bildr-color-brand)', 'color': 'var(--bildr-color-ink-2)' })
    expect(styleClasses({ bg: 'brand' })).toBe('')
  })

  it('keeps existing token styles rendering unchanged', () => {
    expect(styleClasses({ rounded: 'lg', bg: 'primary', mt: '10' })).toBe('mt-10 bg-primary rounded-lg')
    expect(styleClasses({ 'bg': 'primary', 'md:bg': '#fff' })).toBe('bg-primary')
    expect(styleInline({ 'md:bg': '#fff' })).toEqual({})
  })
})
