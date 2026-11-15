import { describe, expect, it } from 'vitest'
import type { Value } from '@bildr/codegen/model'
import { appendProblem, boundPaths, expressionText, insertAt, isExpression, isReadableBinding, isTextBinding, textProblem, textValue, valueText, withPath } from '../../src/shared/bindings.ts'

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

describe('textProblem', () => {
  // The model has no escape syntax: every `{...}` of a `$template` must be a path (load.ts), so a text that binds a name
  // and holds another brace group cannot be written as one.
  it('refuses a text that binds a name and holds a brace group that is no name in scope, naming the group', () => {
    expect(textProblem('{post.title} {braces}', scope)).toBe('"{braces}" is not a name this element can read, so it can\'t sit in a text that binds names.')
    expect(textProblem('By {post.author} {}', scope)).toContain('"{}"')
    expect(textProblem('{ post.title } and {site.name}', scope)).toContain('"{ post.title }"')
    expect(textProblem('{site.name} {missing.name}', scope)).toContain('"{missing.name}"')
    // The model reads a group from a `{` to the next `}`, so an open brace before a name makes one group.
    expect(textProblem('an open { brace and {site.name}', scope)).toContain('"{ brace and {site.name}"')
  })

  it('accepts a text that binds only names in scope, and plain text with braces (it stays a plain string)', () => {
    expect(textProblem('{post.title}', scope)).toBeUndefined()
    expect(textProblem('By {post.author} · {site.name}', scope)).toBeUndefined()
    expect(textProblem('Set {braces} here', scope)).toBeUndefined()
    expect(textProblem('{post.title}', [])).toBeUndefined()
    expect(textProblem('an open brace { and {site.name', scope)).toBeUndefined()
    expect(textProblem('', scope)).toBeUndefined()
  })
})

describe('isReadableBinding', () => {
  // A text field shows a { $bind } or { $template } as {name} text only when every name in it is one the node can read:
  // else it stays an expression the field does not edit (it would be rewritten as plain text).
  it('is true for a { $bind } or { $template } whose names are all in scope, and for a template with no name', () => {
    expect(isReadableBinding({ $bind: 'post.title' }, scope)).toBe(true)
    expect(isReadableBinding({ $template: 'By {post.author} · {site.name}' }, scope)).toBe(true)
    expect(isReadableBinding({ $template: 'Just text' }, scope)).toBe(true)
  })

  it('is false when a name is out of scope, a group is no path, or the value is another expression or no expression', () => {
    expect(isReadableBinding({ $bind: 'ghost.title' }, scope)).toBe(false)
    expect(isReadableBinding({ $bind: 'post.title' }, [])).toBe(false)
    expect(isReadableBinding({ $template: 'By {ghost.name}' }, scope)).toBe(false)
    expect(isReadableBinding({ $template: '{post.title} {a b}' }, scope)).toBe(false)
    expect(isReadableBinding({ $route: 'id' }, scope)).toBe(false)
    expect(isReadableBinding('post.title', scope)).toBe(false)
    expect(isReadableBinding(undefined, scope)).toBe(false)
  })
})

describe('expressionText', () => {
  it('shows a { $bind } as {name}, a { $template } as its text and another expression as the JSON it is', () => {
    expect(expressionText({ $bind: 'post.title' })).toBe('{post.title}')
    expect(expressionText({ $template: 'By {post.author}' })).toBe('By {post.author}')
    expect(expressionText({ $route: 'id' })).toBe('{"$route":"id"}')
  })
})

describe('appendProblem', () => {
  it('refuses adding a name to a text when the result would hold a brace group that is no name in scope (an invalid template)', () => {
    expect(appendProblem('Set {braces}', 'site.name', scope)).toContain('"{braces}"')
    // An open brace joins the name added after it into one group.
    expect(appendProblem('Set {braces', 'site.name', scope)).toContain('"{braces{site.name}"')
    expect(appendProblem('Posts', 'site.name', scope)).toBeUndefined()
    expect(appendProblem('By {post.author}', 'site.name', scope)).toBeUndefined()
    expect(appendProblem('', 'site.name', scope)).toBeUndefined()
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
