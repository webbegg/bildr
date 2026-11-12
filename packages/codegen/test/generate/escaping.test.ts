import { describe, expect, it } from 'vitest'
import { generateActions } from '../../src/generate/actions'
import { regexLiteral } from '../../src/generate/text'
import { generateUi } from '../../src/generate/ui'
import { loadModel } from '../../src/model/load'
import type { Model } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

// Review RISK-001/002: everything from the model reaches generated code escaped or refused, never as code.
const fixtureModel = (): Model => {
  const result = loadModel(fixtureModelFiles())
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result.model
}
const withText = (text: unknown) => {
  const model = fixtureModel()
  model.modules.blog!.pages.find(page => page.name === 'index')!.root.children!.push({ id: 'n_x', type: 'Text', props: { text: text as never } })
  return model
}

describe('regexLiteral', () => {
  it('keeps a pattern inside its literal: a / after an escaped backslash can\'t close it (RISK-002)', () => {
    const pattern = 'a\\\\/,globalThis.__bildrInjected=1,/b'
    const literal = regexLiteral(pattern)
    const regex = new Function(`return ${literal}`)() as RegExp
    expect(regex).toBeInstanceOf(RegExp)
    expect((globalThis as { __bildrInjected?: number }).__bildrInjected).toBeUndefined()
    expect(regex.test('a\\/,globalThis.__bildrInjected=1,/b')).toBe(true)
  })

  it('leaves already-escaped slashes and ordinary patterns as they are', () => {
    expect(regexLiteral('^[a-z0-9-]+$')).toBe('/^[a-z0-9-]+$/')
    expect(regexLiteral('a\\/b')).toBe('/a\\/b/')
    expect(regexLiteral('a/b')).toBe('/a\\/b/')
  })

  it('refuses line breaks, a trailing lone backslash and patterns that don\'t compile', () => {
    expect(() => regexLiteral('a\nb')).toThrow(/line break/)
    expect(() => regexLiteral('a\\')).toThrow(/backslash/)
    expect(() => regexLiteral('a(')).toThrow(/not a valid regular expression/)
  })
})

describe('expression paths become code only as property paths (RISK-001)', () => {
  it('refuses a $bind path that isn\'t one', () => {
    expect(() => generateUi(withText({ $bind: 'post.title;alert(1)' }))).toThrow(/"post\.title;alert\(1\)" is not a property path/)
  })

  it('refuses $route and $form values that aren\'t identifiers', () => {
    expect(() => generateUi(withText({ $route: 'id, fetch(1)' }))).toThrow(/is not a property path/)
    expect(() => generateUi(withText({ $form: 'slug) + alert(1' }))).toThrow(/is not a property path/)
  })

  it('refuses $input values in actions that aren\'t property paths', () => {
    const model = fixtureModel()
    // Every `{ $input: … }` in the fixture's actions becomes an injection attempt.
    const poison = (value: unknown): unknown => Array.isArray(value)
      ? value.map(poison)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === '$input' ? 'id; process.exit(1)' : poison(item)]))
        : value
    model.modules.blog!.actions = model.modules.blog!.actions.map(action => ({ ...action, steps: poison(action.steps) as typeof action.steps }))
    expect(() => generateActions(model)).toThrow(/"id; process\.exit\(1\)" is not a property path/)
  })

  it('reports bad expression values as model problems, so the editor API refuses the file', () => {
    const files = fixtureModelFiles()
    const path = '.bildr/modules/blog/pages/index.json'
    const page = JSON.parse(files[path]!)
    page.root.children.push({ id: 'n_x', type: 'Text', props: { text: { $bind: 'post.title;alert(1)' } } })
    files[path] = JSON.stringify(page)
    const result = loadModel(files)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems.map(problem => problem.message)).toContainEqual(expect.stringMatching(/is not a property path/))
  })
})
