import { describe, expect, it } from 'vitest'
import App from '../src/App.vue'
import { healthReport, pendingPlan } from './fixtures.ts'
import { byTestId, click, mockActions, mountWithApp } from './helpers.ts'

describe('Pending migrations', () => {
  it('shows a banner on every screen while a destructive migration waits', async () => {
    mockActions({ health_get: healthReport, migration_pending_get: () => ({ pending: pendingPlan() }) })
    const { router } = await mountWithApp(App, '/health')

    expect(byTestId('migration-banner')?.textContent).toContain('1 loss')
    await router.push('/code')
    expect(byTestId('migration-banner')).not.toBeNull()
  })

  it('shows no banner when nothing is pending', async () => {
    mockActions({ health_get: healthReport, migration_pending_get: () => ({ pending: null }) })
    await mountWithApp(App, '/health')

    expect(byTestId('migration-banner')).toBeNull()
  })

  it('hides the Migrations screen when the project has no database (V7)', async () => {
    mockActions({ health_get: healthReport, migration_pending_get: () => ({ pending: null, database: false }) })
    await mountWithApp(App, '/health')
    const nav = document.body.querySelector('nav')!.textContent
    expect(nav).toContain('Health')
    expect(nav).not.toContain('Migrations')
  })

  it('says there is no database instead of migrations, when opened directly without one', async () => {
    mockActions({ health_get: healthReport, migration_pending_get: () => ({ pending: null, database: false }) })
    await mountWithApp(App, '/migrations')
    expect(byTestId('no-database')?.textContent).toContain('This project has no database')
    expect(byTestId('confirm')).toBeNull()
  })

  it('shows the Migrations screen when the project has a database', async () => {
    mockActions({ health_get: healthReport, migration_pending_get: () => ({ pending: null, database: true }) })
    await mountWithApp(App, '/health')
    expect(document.body.querySelector('nav')!.textContent).toContain('Migrations')
  })

  it('lists what would be lost and confirms the plan hash after the modal', async () => {
    const actions = mockActions({
      health_get: healthReport,
      migration_pending_get: () => ({ pending: actions.named('migration_confirm').length ? null : pendingPlan() }),
      migration_confirm: () => ({ migration: { kind: 'written', tag: '0003_drop_notes', statements: ['DROP TABLE `blog_notes`;'], applied: true } })
    })
    await mountWithApp(App, '/migrations')

    expect(byTestId('losing')?.textContent).toContain('Table "blog_notes" and all its rows')
    expect(byTestId('statements')?.textContent).toContain('DROP TABLE `blog_notes`;')

    await click(byTestId('confirm'))
    expect(actions.named('migration_confirm')).toHaveLength(0)
    await click(byTestId('confirm-migration'))

    expect(actions.named('migration_confirm')[0]?.input).toEqual({ hash: 'abc123' })
    expect(byTestId('migration-outcome')?.textContent).toContain('0003_drop_notes')
    expect(byTestId('migration-outcome')?.textContent).toContain('applied')
    expect(byTestId('migration-banner')).toBeNull()
  })
})
