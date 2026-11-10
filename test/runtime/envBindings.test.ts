import { describe, expect, it } from 'vitest'
import { bindValue } from '../../app/composables/useRuntime'

const env = { SHOP_NAME: 'Bean Bar' }

describe('bindValue', () => {
  it('resolves env refs in the canvas and keeps missing ones and item bindings as written outside a List', () => {
    const canvas = { editable: true, env, onMissingEnv: 'keep' as const }
    expect(bindValue('Welcome to {{ env.SHOP_NAME }}', canvas)).toBe('Welcome to Bean Bar')
    expect(bindValue('{{ env.MISSING }} {{ item.name }}', canvas)).toBe('{{ env.MISSING }} {{ item.name }}')
  })

  it('renders missing env refs and item bindings empty in published apps', () => {
    const published = { editable: false, env, onMissingEnv: 'empty' as const }
    expect(bindValue('{{ env.SHOP_NAME }}:{{ env.API_KEY }}:{{ item.name }}', published)).toBe('Bean Bar::')
  })

  it('resolves item and env bindings in one string inside a List', () => {
    const item = { name: 'Latte' }
    expect(bindValue('{{ item.name }} at {{ env.SHOP_NAME }}', { editable: true, env, onMissingEnv: 'keep' }, item)).toBe('Latte at Bean Bar')
    expect(bindValue('{{ item.name }} {{ env.X }}', { editable: false, env, onMissingEnv: 'empty' }, item)).toBe('Latte ')
  })

  it('never resolves a value twice', () => {
    expect(bindValue('{{ env.A }}', { editable: true, env: { A: '{{ env.B }}', B: 'b' } })).toBe('{{ env.B }}')
  })

  it('keeps env refs as written without variables', () => {
    expect(bindValue('{{ env.SHOP_NAME }}', { editable: false })).toBe('{{ env.SHOP_NAME }}')
  })
})
