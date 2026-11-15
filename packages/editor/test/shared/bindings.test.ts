import { describe, expect, it } from 'vitest'
import type { Value } from '@bildr/codegen/model'
import { boundPaths, insertAt, isExpression, isTextBinding, textValue, valueText, withPath } from '../../src/shared/bindings.ts'

/**
 * How a text field reads and writes a prop that can be bound: the model's `{ $bind }` and
 * `{ $template }` shapes, never a string with `{{ }}` (the hosted `{{ item.x }}` and `{{ prop.x }}`).
 */

const scope = ['post', 'site', 'layout']

describe('valueText', () => {
  it('shows plain text as it is, a number as text, a { $bind } as {name} and a { $template } as its text', () => {
    expect(valueText('Posts')).toBe('Posts')
    expect(valueText(3)).toBe('3')
    expect(valueText({ $bind: 'post.title' })).toBe('{post.title}')
    expect(valueText({ $template: 'By {post.author}' })).toBe('By {post.author}')
  })

  it('shows nothing for a value a text field cannot hold', () => {
    expect(valueText(undefined)).toBe('')
    expect(valueText(null)).toBe('')
    expect(valueText(true)).toBe('')
    expect(valueText({ page: 'pg_x' })).toBe('')
    expect(valueText(['a'])).toBe('')
  })
})

describe('textValue', () => {
  it('writes one name alone as { $bind }', () => {
    expect(textValue('{post.title}', scope)).toEqual({ $bind: 'post.title' })
    expect(textValue('{site}', scope)).toEqual({ $bind: 'site' })
  })

  it('writes names among text as one { $template } with the text as typed', () => {
    expect(textValue('By {post.author}', scope)).toEqual({ $template: 'By {post.author}' })
    expect(textValue('{post.title} · {site.name}', scope)).toEqual({ $template: '{post.title} · {site.name}' })
  })

  it('keeps a {word} that is no name in scope as plain text', () => {
    expect(textValue('{missing.name}', scope)).toBe('{missing.name}')
    expect(textValue('Set {braces} here', scope)).toBe('Set {braces} here')
    expect(textValue('{post.title}', [])).toBe('{post.title}')
  })

  it('writes an empty text as null, which removes the prop', () => {
    expect(textValue('', scope)).toBeNull()
  })

  it('gives back what valueText showed (a round trip)', () => {
    const values: Value[] = ['Posts', { $bind: 'post.title' }, { $template: 'By {post.author}' }]
    for (const value of values) {
      expect(textValue(valueText(value), scope)).toEqual(value)
    }
  })
})

describe('boundPaths and isTextBinding', () => {
  it('lists the paths of the tokens whose first name is in scope', () => {
    expect(boundPaths('{post.title} and {x.y} and {site.name}', scope)).toEqual(['post.title', 'site.name'])
    expect(boundPaths('none', scope)).toEqual([])
  })

  it('tells a binding from other values', () => {
    expect(isTextBinding({ $bind: 'a' })).toBe(true)
    expect(isTextBinding({ $template: 'a {b}' })).toBe(true)
    expect(isTextBinding({ page: 'pg' })).toBe(false)
    expect(isTextBinding('a')).toBe(false)
    expect(isExpression([])).toBe(false)
    expect(isExpression(null)).toBe(false)
  })
})

describe('insertAt and withPath', () => {
  it('types over the selection, in either order, clamped to the text, with the caret after it', () => {
    expect(insertAt('Hello world', 6, 11, '{site.name}')).toEqual({ text: 'Hello {site.name}', caret: 17 })
    expect(insertAt('Hello', 5, 0, 'X')).toEqual({ text: 'X', caret: 1 })
    expect(insertAt('Hi', 99, 99, '!')).toEqual({ text: 'Hi!', caret: 3 })
  })

  it('adds a token at the end of a text', () => {
    expect(withPath('Posts', 'site.name')).toBe('Posts{site.name}')
  })
})
