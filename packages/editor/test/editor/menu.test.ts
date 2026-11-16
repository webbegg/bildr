import { describe, expect, it, vi } from 'vitest'
import { click, mockActions, mountWithApp, settle } from '../helpers.ts'
import App from '../../src/App.vue'
import { healthReport, pendingPlan } from '../fixtures.ts'
import { baseHandlers, menuItem, setupHarness } from '../design/harness.ts'

/**
 * The shell's one navigation (S1): the top bar's view menu, on every screen. The left nav is gone.
 * Mounted as the whole App over the mocked actions, so the routes, the banner and the menu run together.
 */

setupHarness()

const q = (selector: string) => document.body.querySelector<HTMLElement>(selector)
const qa = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)]
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const ENTRIES = ['Canvas', 'Design system', 'Data', 'Code', 'Checks', 'Settings']

/** Mounts the whole App at `path`, over a project with a database and nothing pending. */
const open = async (path: string, pending: unknown = null) => {
  const actions = mockActions({
    ...baseHandlers(),
    env_status: () => ({ variables: [] }),
    health_get: healthReport,
    migration_pending_get: () => ({ pending, database: true }),
    code_view: () => ({ files: [] })
  })
  const mounted = await mountWithApp(App, path)
  return { actions, ...mounted }
}

/** The labels the view menu lists, in order (it is opened with the keyboard, as the other menu tests do). */
const menuLabels = async () => {
  q('[data-view-menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  return qa('[role^="menuitem"]').map(item => text(item))
}

describe('the top bar menu is the only navigation', () => {
  it('lists Canvas, Design system, Data, Code, Checks and Settings, once each, and renders no left nav', async () => {
    await open('/design')
    expect(q('nav')).toBeNull()
    expect(qa('[data-view-menu]')).toHaveLength(1)
    expect(await menuLabels()).toEqual(ENTRIES)
  })

  it('keeps the brand left of the menu', async () => {
    await open('/design')
    expect(text(q('[data-brand]'))).toBe('bildr')
    expect(q('[data-brand]')!.compareDocumentPosition(q('[data-view-menu]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['Data', '/data'],
    ['Code', '/code'],
    ['Checks', '/health']
  ])('goes to the route of %s (%s)', async (label, path) => {
    const { router } = await open('/design')
    await menuItem(q('[data-view-menu]'), label)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(path))
    await settle()
    expect(text(q('[data-view-menu]'))).toBe(label)
    expect(q('nav')).toBeNull()
  })

  it.each([
    ['Design system', 'design'],
    ['Settings', 'settings'],
    ['Canvas', 'build']
  ])('keeps %s on the Design screen', async (label) => {
    const { router } = await open('/design')
    await menuItem(q('[data-view-menu]'), label)
    expect(router.currentRoute.value.path).toBe('/design')
    expect(text(q('[data-view-menu]'))).toBe(label)
  })

  it.each([
    ['Canvas', '/code', '/design'],
    ['Settings', '/health', '/design'],
    ['Design system', '/migrations', '/design'],
    ['Data', '/model', '/data'],
    ['Checks', '/code', '/health']
  ])('chooses %s from the screen at %s, and lands on %s', async (label, from, to) => {
    const { router } = await open(from)
    await menuItem(q('[data-view-menu]'), label)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(to))
    await settle()
    expect(text(q('[data-view-menu]'))).toBe(label)
  })

  it.each([
    ['/design', 'Canvas'],
    ['/data', 'Data'],
    ['/code?path=.bildr%2Fmodules%2Fblog%2Fentities%2Fpost.json', 'Code'],
    ['/health', 'Checks'],
    ['/migrations', 'Migrations'],
    ['/model', 'Model']
  ])('opens the deep link %s with the menu showing %s', async (link, label) => {
    const { router } = await open(link)
    expect(router.currentRoute.value.fullPath).toBe(link)
    expect(text(q('[data-view-menu]'))).toBe(label)
    expect(text(q('[data-brand]'))).toBe('bildr')
    expect(q('nav')).toBeNull()
  })

  it('reaches Migrations only through the banner, which links to it', async () => {
    const { router } = await open('/health', pendingPlan())
    expect(await menuLabels()).not.toContain('Migrations')
    q('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    await click(q('[data-testid="migration-banner"] a'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/migrations'))
  })
})
