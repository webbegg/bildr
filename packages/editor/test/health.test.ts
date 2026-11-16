import { describe, expect, it } from 'vitest'
import HealthView from '../src/views/HealthView.vue'
import { healthReport } from './fixtures.ts'
import { byTestId, click, Failure, mockActions, mountWithApp, settle } from './helpers.ts'

const typesResult = { name: 'types', ok: true, startedAt: '2026-11-13T09:01:00.000Z', durationMs: 6300, summary: 'No type errors', findings: [] }

describe('Checks screen', () => {
  it('names the screen Checks when the report cannot be read', async () => {
    mockActions({
      health_get: () => {
        throw new Failure(500, 'internal', 'boom')
      }
    })
    await mountWithApp(HealthView, '/health')
    const text = document.body.textContent ?? ''
    expect(text).toContain('Could not read the Checks report')
    expect(text).not.toContain('Health')
  })

  it('shows the model status, the drift with its diff and each check with its findings', async () => {
    mockActions({ health_get: healthReport })
    await mountWithApp(HealthView, '/health')

    expect(byTestId('model-status')?.textContent).toContain('valid')
    const drift = byTestId('drift')
    expect(drift?.textContent).toContain('layers/blog/app/pages/index.vue')
    expect(drift?.textContent).toContain('detached')
    expect(drift?.querySelector('[data-line="add"]')?.textContent).toBe('+<h1>My posts</h1>')

    const lint = byTestId('check-lint')
    expect(lint?.textContent).toContain('1 boundary violation')
    expect(lint?.textContent).toContain('1.3 s')
    expect(lint?.querySelector('[data-testid="ok"]')?.textContent).toContain('failing')
    const boundary = lint?.querySelector('[data-boundary="true"]')
    expect(boundary?.textContent).toContain('Import of server code from the app')
    expect(boundary?.textContent).toContain('layers/blog/app/pages/index.vue:3')
    expect(lint?.querySelectorAll('[data-boundary="false"]')).toHaveLength(1)
    expect(byTestId('check-types')?.textContent).toContain('Not run yet')
  })

  it('runs one check, shows it as running, then renders its result', async () => {
    let finish: (value: unknown) => void = () => {}
    const actions = mockActions({
      health_get: healthReport,
      health_run: () => new Promise((resolve) => {
        finish = resolve
      })
    })
    await mountWithApp(HealthView, '/health')

    await click(byTestId('check-types')!.querySelector('[data-testid="run"]'))
    expect(actions.named('health_run')[0]?.input).toEqual({ checks: ['types'] })
    expect(byTestId('check-types')?.querySelector('[data-testid="run"]')?.hasAttribute('disabled')).toBe(true)

    finish({ results: [typesResult] })
    await settle()
    const types = byTestId('check-types')
    expect(types?.textContent).toContain('No type errors')
    expect(types?.querySelector('[data-testid="ok"]')?.textContent).toContain('passing')
    expect(types?.querySelector('[data-testid="run"]')?.hasAttribute('disabled')).toBe(false)
  })

  it('runs every check with Run all', async () => {
    const actions = mockActions({ health_get: healthReport, health_run: () => ({ results: [typesResult] }) })
    await mountWithApp(HealthView, '/health')

    await click(byTestId('run-all'))
    expect(actions.named('health_run')[0]?.input).toEqual({ checks: ['lint', 'types', 'tests', 'build'] })
  })
})
