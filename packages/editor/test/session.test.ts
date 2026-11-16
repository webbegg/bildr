import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { POLL_MS } from '../src/status.ts'
import { healthReport } from './fixtures.ts'
import { SESSION_401_MESSAGE, UNAUTHORIZED, byTestId, mockActions, mountWithApp } from './helpers.ts'

const NOTICE = 'This editor session ended. Open the editor again from the link in the nuxt dev log.'

afterEach(() => {
  vi.useRealTimers()
})

describe('Ended session', () => {
  it('replaces the screen with one notice when a call gets 401, and shows no per-call error', async () => {
    mockActions({ model_get: () => UNAUTHORIZED, health_get: () => UNAUTHORIZED, migration_pending_get: () => UNAUTHORIZED })
    await mountWithApp(App, '/data')

    expect(byTestId('session-ended')?.textContent).toContain(NOTICE)
    expect(document.body.textContent).not.toContain(SESSION_401_MESSAGE)
    expect(document.body.querySelector('nav')).toBeNull()
  })

  it('stops polling after a 401, while a live session keeps polling', async () => {
    let ended = false
    const answer = (value: unknown) => () => ended ? UNAUTHORIZED : value
    const actions = mockActions({ health_get: answer(healthReport), migration_pending_get: answer({ pending: null }) })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // `mountWithApp` settles on zero-delay timers, which only run while fake time advances.
    let mounted = false
    void mountWithApp(App, '/health').then(() => {
      mounted = true
    })
    while (!mounted) await vi.advanceTimersByTimeAsync(10)

    const before = actions.named('health_get').length
    await vi.advanceTimersByTimeAsync(POLL_MS + 100)
    expect(actions.named('health_get').length).toBeGreaterThan(before)
    expect(byTestId('session-ended')).toBeNull()

    ended = true
    await vi.advanceTimersByTimeAsync(POLL_MS + 100)
    expect(byTestId('session-ended')?.textContent).toContain(NOTICE)
    const afterEnd = actions.calls.length
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    expect(actions.calls.length).toBe(afterEnd)
  })
})
