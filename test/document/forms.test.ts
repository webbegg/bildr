import { describe, expect, it } from 'vitest'
import { getComponent } from '#shared/document/components'
import { createNode } from '#shared/document/factory'
import { propValueProblem } from '#shared/document/schema'

const prop = (type: string, name: string) => getComponent(type)!.props.find(p => p.name === name)!

describe('Form component', () => {
  it('is a container with a collection, a success message, a redirect and reset on success', () => {
    expect(getComponent('Form')).toMatchObject({ container: true, icon: 'i-lucide-send' })
    expect(createNode('Form').props).toEqual({ collection: '', successMessage: 'Thanks!', redirectTo: '', resetOnSuccess: true })
    expect(prop('Form', 'collection').kind).toBe('collection')
    expect(prop('Form', 'redirectTo').kind).toBe('link')
    expect(prop('Form', 'resetOnSuccess').kind).toBe('boolean')
  })

  it('stacks its fields like the other vertical containers', () => {
    expect(createNode('Form').style).toEqual({ gap: '3', items: 'start' })
  })
})

describe('Input field', () => {
  it('maps to a field key of the enclosing Form\'s collection, none by default', () => {
    expect(createNode('Input').props.field).toBe('')
    expect(prop('Input', 'field').kind).toBe('field')
  })

  it('accepts an empty value or a field key', () => {
    const field = prop('Input', 'field')
    expect(propValueProblem(field, '')).toBeUndefined()
    expect(propValueProblem(field, 'email')).toBeUndefined()
    expect(propValueProblem(field, 'servedFrom')).toBeUndefined()
    for (const bad of ['Email', 'e mail', '1st', 3]) expect(propValueProblem(field, bad)).toBe('"field" must be a field key, e.g. email')
  })
})

describe('Button action', () => {
  it('links by default and has a toast message', () => {
    expect(createNode('Button').props).toMatchObject({ action: 'link', message: '' })
  })

  it('accepts link, submit and toast only', () => {
    const action = prop('Button', 'action')
    for (const ok of ['link', 'submit', 'toast']) expect(propValueProblem(action, ok)).toBeUndefined()
    for (const bad of ['navigate', '', true]) expect(propValueProblem(action, bad)).toBe('"action" must be one of link, submit, toast')
  })
})
