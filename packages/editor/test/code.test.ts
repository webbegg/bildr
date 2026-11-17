import { describe, expect, it } from 'vitest'
import CodeView from '../src/views/CodeView.vue'
import { POST_PATH, modelResult } from './fixtures.ts'
import { allByTestId, byTestId, mockActions, mountWithApp } from './helpers.ts'

const files = [
  { path: 'layers/blog/domain/post.ts', state: 'managed', content: 'export interface Post {\n  title: string\n}\n' },
  {
    path: 'layers/blog/app/pages/index.vue',
    state: 'detached',
    content: '<h1>My posts</h1>\n',
    diff: '--- generated\n+++ disk\n@@ -1 +1 @@\n-<h1>Posts</h1>\n+<h1>My posts</h1>\n'
  }
]

describe('Code screen', () => {
  it('shows each generated file of the selected artifact with its state, and the diff of a detached one', async () => {
    const actions = mockActions({ model_get: modelResult, code_view: () => ({ files }) })
    await mountWithApp(CodeView, `/code?path=${encodeURIComponent(POST_PATH)}`)

    expect(actions.named('code_view')[0]?.input).toEqual({ path: POST_PATH })
    const panels = allByTestId('code-file')
    expect(panels.map(panel => panel.dataset.file)).toEqual(files.map(file => file.path))
    expect(panels[0]?.querySelector('pre')?.textContent).toBe(files[0]!.content)
    expect(panels[0]?.querySelector('[data-testid="state"]')?.textContent).toContain('managed')
    expect(panels[1]?.querySelector('[data-testid="state"]')?.textContent).toContain('detached')

    const diff = panels[1]?.querySelector('[data-testid="diff"]')
    expect(diff?.querySelector('[data-line="add"]')?.textContent).toBe('+<h1>My posts</h1>')
    expect(diff?.querySelector('[data-line="del"]')?.textContent).toBe('-<h1>Posts</h1>')
    expect(diff?.querySelector('[data-line="hunk"]')?.textContent).toBe('@@ -1 +1 @@')
    expect(panels[0]?.querySelector('[data-testid="diff"]')).toBeNull()
    expect(byTestId('code-tabs')?.textContent).toContain('index.vue')
  })

  const shown = () => byTestId('code-tabs')?.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()

  it('shows the tab of the generated file a link names (&file=, S8)', async () => {
    mockActions({ model_get: modelResult, code_view: () => ({ files }) })
    await mountWithApp(CodeView, `/code?path=${encodeURIComponent(POST_PATH)}&file=${encodeURIComponent('layers/blog/app/pages/index.vue')}`)
    expect(shown()).toContain('index.vue')
  })

  it('shows the first file when the link names none, or one this model file does not generate', async () => {
    mockActions({ model_get: modelResult, code_view: () => ({ files }) })
    await mountWithApp(CodeView, `/code?path=${encodeURIComponent(POST_PATH)}&file=${encodeURIComponent('layers/blog/app/pages/other.vue')}`)
    expect(shown()).toContain('post.ts')
  })

  it('asks for an artifact when none is selected', async () => {
    const actions = mockActions({ model_get: modelResult, code_view: () => ({ files }) })
    await mountWithApp(CodeView, '/code')

    expect(actions.named('code_view')).toHaveLength(0)
    expect(byTestId('code-empty')).not.toBeNull()
  })
})
