import { describe, expect, it, vi } from 'vitest'
import { click, mockActions, mountWithApp, settle } from '../helpers.ts'
import App from '../../src/App.vue'
import DesignView from '../../src/views/DesignView.vue'
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

/** Mounts the whole App at `path`, over a project with a database (unless `database` is false) and nothing pending. */
const open = async (path: string, pending: unknown = null, database = true) => {
  const actions = mockActions({
    ...baseHandlers(),
    env_status: () => ({ variables: [] }),
    health_get: healthReport,
    migration_pending_get: () => ({ pending, database }),
    code_view: () => ({ files: [] })
  })
  const mounted = await mountWithApp(App, path)
  return { actions, ...mounted }
}

/** The mode of the editor the Design or Data screen created, read from the screen that provides it. */
const modeOf = (mounted: Awaited<ReturnType<typeof open>>) =>
  (mounted.wrapper.findComponent(DesignView).vm as unknown as { editor: { mode: string } }).editor.mode

/** The links the page's navigation landmarks hold: a left rail of screens would be a `<nav>` of links; the breadcrumbs are buttons. */
const navLinks = () => qa('nav a[href]').map(link => link.getAttribute('href'))

/** The labels the view menu lists, in order (it is opened with the keyboard, as the other menu tests do). */
const menuLabels = async () => {
  q('[data-view-menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  return qa('[role^="menuitem"]').map(item => text(item))
}

describe('the top bar menu is the only navigation', () => {
  it('lists Canvas, Design system, Data, Code, Checks and Settings, once each, and renders no left nav', async () => {
    await open('/design')
    // The editor's breadcrumbs are <nav>s, so the old rail is told by what it held: a <nav> of links to screens.
    expect(navLinks()).toEqual([])
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
    expect(navLinks()).toEqual([])
  })

  it.each([
    ['Design system', 'design'],
    ['Settings', 'settings'],
    ['Canvas', 'build']
  ])('keeps %s on the Design screen, in the %s mode', async (label, mode) => {
    const mounted = await open('/design')
    await menuItem(q('[data-view-menu]'), label)
    expect(mounted.router.currentRoute.value.path).toBe('/design')
    expect(text(q('[data-view-menu]'))).toBe(label)
    expect(modeOf(mounted)).toBe(mode)
  })

  it.each([
    ['Canvas', '/code', '/design'],
    ['Settings', '/health', '/design'],
    ['Design system', '/code', '/design'],
    ['Data', '/code', '/data'],
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
    ['/code?path=.bildr%2Fmodules%2Fblog%2Fentities%2Fpost.json', 'Code'],
    ['/health', 'Checks']
  ])('opens the deep link %s as it is, with the menu showing %s', async (link, label) => {
    const { router } = await open(link)
    expect(router.currentRoute.value.fullPath).toBe(link)
    expect(text(q('[data-view-menu]'))).toBe(label)
    expect(text(q('[data-brand]'))).toBe('bildr')
    expect(navLinks()).toEqual([])
  })

  it('opens the Data deep link on /data, with only the item and the tab the screen shows in its query (S2)', async () => {
    const { router } = await open('/data')
    const route = router.currentRoute.value
    expect(route.path).toBe('/data')
    expect(Object.keys(route.query).sort()).toEqual(['item', 'tab'])
    expect(text(q('[data-view-menu]'))).toBe('Data')
    expect(text(q('[data-brand]'))).toBe('bildr')
    expect(navLinks()).toEqual([])
  })

  it.each([
    ['/design/', 'Canvas'],
    ['/data/', 'Data'],
    ['/code/', 'Code'],
    ['/health/', 'Checks'],
    ['/migrations/', 'Data'],
    ['/model/', 'Data']
  ])('names the screen of the deep link %s with a trailing slash: %s', async (link, label) => {
    await open(link)
    expect(text(q('[data-view-menu]'))).toBe(label)
  })

  it('retires the Model screen: /model opens All model files in the Data workspace, which the menu names Data (S3)', async () => {
    const { router } = await open('/model')
    const route = router.currentRoute.value
    expect(route.path).toBe('/data')
    expect(route.query).toEqual({ item: 'files' })
    expect(text(q('[data-view-menu]'))).toBe('Data')
    expect(q('[data-data-files]')).not.toBeNull()
    expect(router.hasRoute('model')).toBe(false)
    expect(await menuLabels()).not.toContain('Model')
  })

  it('keeps the file a /model deep link names, as file= (S3)', async () => {
    const { router } = await open('/model?path=.bildr%2Flayouts%2Fmain.json')
    expect(router.currentRoute.value.path).toBe('/data')
    expect(router.currentRoute.value.query).toEqual({ item: 'files', file: '.bildr/layouts/main.json' })
    const content = q('[data-testid="raw-content"]')
    expect((content?.matches('textarea') ? content : content?.querySelector('textarea')) as HTMLTextAreaElement | null).toHaveProperty('value', expect.stringContaining('"lay_main"'))
  })

  it('goes back to the Design screen from Code, with the menu naming what the screen then shows', async () => {
    const { router } = await open('/design')
    await menuItem(q('[data-view-menu]'), 'Design system')
    await menuItem(q('[data-view-menu]'), 'Code')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/code'))
    await settle()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/design'))
    await settle()
    // Going back creates a new editor, which starts on the Canvas: the history keeps the screen, not the view.
    expect(text(q('[data-view-menu]'))).toBe('Canvas')
    expect(qa('[data-view-menu]')).toHaveLength(1)
  })

  it('renders no migrations banner and no Review link when the project has no database and nothing is pending', async () => {
    await open('/design', null, false)
    expect(q('[data-testid="migration-banner"]')).toBeNull()
    expect(qa('a').filter(link => /migrations/.test(link.getAttribute('href') ?? ''))).toEqual([])
    expect(qa('a').filter(link => text(link) === 'Review')).toEqual([])
    expect(await menuLabels()).not.toContain('Migrations')
  })

  it('reaches Migrations only through the banner, which links to it', async () => {
    const { router } = await open('/health', pendingPlan())
    expect(await menuLabels()).not.toContain('Migrations')
    q('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    await click(q('[data-testid="migration-banner"] a'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.query).toEqual({ item: 'migrations' })
  })
})
