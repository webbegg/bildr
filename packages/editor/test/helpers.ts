import { defineComponent, h } from 'vue'
import type { Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ui from '@nuxt/ui/vue-plugin'
import UApp from '@nuxt/ui/components/App.vue'
import { afterEach, vi } from 'vitest'
import { ACTIONS } from '../../nuxt/src/actions/registry.ts'
import { sessionEnded } from '../src/api.ts'
import App from '../src/App.vue'
import { routes } from '../src/router.ts'
import { STATUS_KEY, createStatus } from '../src/status.ts'

const mounted: VueWrapper[] = []

// Unmount after each test, so no poll timer outlives the stubbed fetch, then clear what was teleported to the body.
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  sessionEnded.value = false
  vi.unstubAllGlobals()
})

/** An action handler's failure: the HTTP error body `{ok:false, code, message, problems?}`. */
export class Failure {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly problems?: Array<{ path: string, message: string }>
  ) {}
}

/** The guard's exact 401 body (`packages/nuxt/src/server/handler.ts`): no `code`, because the guard answers before any action runs. */
export const SESSION_401_MESSAGE = 'Missing or wrong bildr session token: open the editor from the link in the dev server log'

/** Return it from a handler to answer that call as the guard does when the session token is missing or wrong. */
export const UNAUTHORIZED = Symbol('unauthorized')

export type Handler = (input: Record<string, unknown>) => unknown

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * What the app's own routes answer (`/api/<module>/<plural>`, P5): by path, the JSON body, a `Failure`
 * (its status) or a function of the query string. A path nobody answers is an unreachable app (a network error).
 */
export type AppRoutes = Record<string, unknown | ((query: URLSearchParams) => unknown)>

/** Stubs `fetch` with the action endpoint: each call is recorded and answered by the handler for its name. */
export const mockActions = (handlers: Record<string, Handler>, routes: AppRoutes = {}) => {
  const calls: Array<{ name: string, input: Record<string, unknown> }> = []
  const appCalls: string[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (!String(url).startsWith('/__bildr/api/')) {
      const target = new URL(String(url), 'http://app.test')
      appCalls.push(target.pathname + target.search)
      const answer = routes[target.pathname]
      if (answer === undefined) throw new TypeError('Failed to fetch')
      // A route may answer later (a promise, even one that never settles): an aborted request fails as the browser's does.
      const aborted = new Promise<never>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError'))))
      const body = await Promise.race([Promise.resolve(typeof answer === 'function' ? (answer as (query: URLSearchParams) => unknown)(target.searchParams) : answer), aborted])
      return body instanceof Failure ? json(body.status, { message: body.message }) : json(200, body)
    }
    const name = String(url).replace('/__bildr/api/actions/', '')
    const input = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ name, input })
    // The contract: every call must be one @bildr/nuxt's real registry accepts, so the mocks can't drift from it.
    const action = ACTIONS.find(candidate => candidate.name === name)
    if (!action) throw new Error(`The editor called ${name}, which @bildr/nuxt doesn't register`)
    const parsed = action.input.safeParse(input)
    if (!parsed.success) throw new Error(`The editor called ${name} with input the action refuses: ${parsed.error.message}`)
    const handler = handlers[name]
    if (!handler) return json(501, { ok: false, code: 'unavailable', message: `No handler for ${name}` })
    const out = await handler(input)
    if (out === UNAUTHORIZED) return json(401, { ok: false, message: SESSION_401_MESSAGE })
    if (out instanceof Failure) {
      return json(out.status, { ok: false, code: out.code, message: out.message, ...(out.problems ? { problems: out.problems } : {}) })
    }
    return json(200, { ok: true, result: out })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, appCalls, fetch: fetchMock, named: (name: string) => calls.filter(call => call.name === name) }
}

/** Mounts `component` (a screen inside `<UApp>`, or the whole App, which has its own) with the Nuxt UI plugin, a router at `path` and the shared status. */
export const mountWithApp = async (component: Component, path = '/') => {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const status = createStatus()
  const Root = component === App ? App : defineComponent({ render: () => h(UApp, null, { default: () => h(component) }) })
  const wrapper = mount(Root, {
    attachTo: document.body,
    global: { plugins: [router, ui], provide: { [STATUS_KEY as symbol]: status } }
  })
  mounted.push(wrapper)
  await settle()
  return { wrapper, router, status }
}

/** Lets pending fetches, promises and re-renders finish. */
export const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

export const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
export const allByTestId = (id: string) => [...document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]

/** Types into a native input or textarea and fires `input`, as a user would. */
export const typeInto = async (element: HTMLElement | null, value: string) => {
  if (!element) throw new Error('element not found')
  const target = element.matches('input, textarea') ? element as HTMLInputElement : element.querySelector<HTMLInputElement>('input, textarea')
  if (!target) throw new Error('no input inside element')
  target.value = value
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
}

export const click = async (element: HTMLElement | null) => {
  if (!element) throw new Error('element not found')
  element.click()
  await settle()
}
