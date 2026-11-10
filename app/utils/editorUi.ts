/**
 * The editor widget kit: the class strings and Nuxt UI `ui` objects behind
 * every editor control, so the whole chrome has the right panel's look (a soft
 * borderless 30 px `bg-elevated` field, 13 px text, 8 px radius, a white/10
 * ring on hover and the selection-blue ring on focus). Editor only: published
 * apps render the same Nuxt UI components with the global defaults
 * (app.config.ts), which stay untouched.
 *
 * Prefer the components (app/components/editor/kit) over raw Nuxt UI controls:
 * - `EditorInput`: a one-line field; `commit="change"` emits `commit` on blur
 *   or Enter and Esc reverts (one undo step per edit), `mono` for code, URLs,
 *   paths and keys.
 * - `EditorTextarea`: the same, several lines.
 * - `EditorSelect`: a pick from a short list (strings or `{ label, value,
 *   icon?, disabled? }`); `compact` is an icon-only 28 px trigger.
 * - `EditorSwitch`: every boolean, including "include" checkboxes.
 * - `EditorButton`: `primary` for the one main action, `soft` for secondary
 *   actions, `ghost` for toolbar and row actions, `danger` for destructive ones.
 * - `EditorFormRow`: a labelled control in modals and settings (inline with a
 *   120 px label column, or `stacked`). The inspector panels keep `EditorRow`
 *   (88 px) and `EditorStyleSection`.
 * - `EditorModal`: every dialog: title, description, body and a right-aligned
 *   footer, dark on any page.
 * - `EditorMenu`: a dropdown of actions.
 * - `EditorCommitInput` / `EditorIconInput`: the panel's commit-on-change text
 *   and icon fields (with the Insert variable picker), built on the same field.
 *
 * Where a component doesn't fit, use the constants below on the Nuxt UI
 * component: `INPUT_UI` (UInput, `variant="soft"`), `SELECT_UI` (USelect or
 * USelectMenu, `variant="soft"`; `SELECT_BARE_UI` with `variant="none"` inside
 * an EditorField), `MENU_UI` (UDropdownMenu or UContextMenu),
 * `ACTION` (a bare 24 px icon button), `FIELD_SHELL` (a div holding a custom
 * control, see EditorField) and `MODAL_UI` (UModal).
 */

/** The soft field box: 30 px, `bg-elevated`, 13 px text. */
export const FIELD = 'h-[30px] rounded-lg bg-elevated text-[13px]'
/** The same box for code: URLs, paths, keys and header values. */
export const FIELD_MONO = 'h-[30px] rounded-lg bg-elevated font-mono text-[12px]'
/** The hover and focus rings of a field that is itself focusable. */
export const FIELD_RING = 'ring-inset hover:ring-1 hover:ring-white/10 focus-visible:ring-1 focus-visible:ring-(color:--editor-selection)'
/** A field whose value is refused. */
export const FIELD_INVALID = 'ring-1 ring-error hover:ring-error focus-visible:ring-error'
/** A field shell around a custom control (EditorField): it rings when anything inside has focus. */
export const FIELD_SHELL = 'flex h-[30px] min-w-0 items-center rounded-lg bg-elevated text-[13px] ring-inset focus-within:ring-1 focus-within:ring-(color:--editor-selection) hover:ring-1 hover:ring-white/10'

export const INPUT_UI = { base: `${FIELD} ${FIELD_RING}` }
export const INPUT_MONO_UI = { base: `${FIELD_MONO} ${FIELD_RING}` }
/** Added to a field holding the Insert variable button (a 24 px ACTION) at its end, so the text stops before it. */
export const VARIABLE_FIELD_UI = { base: 'pe-8', trailing: 'pe-1' }
export const TEXTAREA_UI = { base: `rounded-lg bg-elevated text-[13px] ${FIELD_RING}` }
export const TEXTAREA_MONO_UI = { base: `rounded-lg bg-elevated font-mono text-[12px] ${FIELD_RING}` }

/** One row of a menu or a select list. */
const MENU_ITEM = 'px-2.5 py-1.5 text-[13px]'
/** The popover: a raised rounded panel; `bildr-chrome` keeps it dark outside the editor page. */
const MENU_CONTENT = 'bildr-chrome min-w-36 rounded-xl bg-elevated p-1 ring-white/8'

export const MENU_UI = {
  content: MENU_CONTENT,
  item: `${MENU_ITEM} data-highlighted:before:bg-white/8 data-[state=open]:before:bg-white/8`,
  itemDescription: 'text-[11px]'
}

export const SELECT_UI = {
  base: `${FIELD} ${FIELD_RING} focus-visible:outline-0`,
  trailingIcon: 'size-3.5 text-dimmed',
  placeholder: 'text-dimmed',
  content: MENU_CONTENT,
  item: `${MENU_ITEM} data-highlighted:not-data-disabled:before:bg-white/8`,
  itemTrailingIcon: 'size-3.5',
  itemDescription: 'text-[11px]'
}
export const SELECT_MONO_UI = { ...SELECT_UI, base: `${FIELD_MONO} ${FIELD_RING} focus-visible:outline-0` }
/** A `variant="none"` select inside a field shell (EditorField), which draws the box. */
export const SELECT_BARE_UI = { ...SELECT_UI, base: 'focus-visible:outline-0' }
/** An icon-only select: the current option's icon in a 28 px ghost button. */
export const SELECT_COMPACT_UI = {
  ...SELECT_UI,
  base: 'size-7 justify-center rounded-md p-0 text-dimmed hover:bg-white/8 hover:text-highlighted focus-visible:outline-0 focus-visible:ring-1 focus-visible:ring-(color:--editor-selection)',
  leading: 'static p-0',
  leadingIcon: 'size-4',
  trailing: 'hidden'
}

/** A bare 24 px icon button (section headers, row actions); `aria-expanded` keeps it lit while its menu is open. */
export const ACTION = 'grid size-6 shrink-0 place-items-center rounded-md text-toned hover:bg-white/8 hover:text-highlighted aria-expanded:bg-white/8 aria-expanded:text-highlighted'

export const BUTTON_SIZES = {
  sm: 'h-[30px] gap-1.5 rounded-lg px-2.5 text-[13px]',
  xs: 'h-6 gap-1 rounded-md px-2 text-xs'
}
/** An icon-only button is square. */
export const BUTTON_SQUARE = {
  sm: 'w-[30px] justify-center px-0',
  xs: 'w-6 justify-center px-0'
}
export const BUTTON_ICON = { sm: 'size-4', xs: 'size-3.5' }
export const BUTTON_VARIANTS = {
  primary: { color: 'primary', variant: 'solid', class: 'text-white' },
  soft: { color: 'neutral', variant: 'soft', class: '' },
  ghost: { color: 'neutral', variant: 'ghost', class: 'text-toned hover:bg-white/8 hover:text-highlighted' },
  danger: { color: 'error', variant: 'soft', class: '' }
} as const

/**
 * The modal: `bildr-chrome` (main.css) gives the overlay and the dialog the
 * dark editor variables on any page, `/` included.
 */
export const MODAL_UI = {
  overlay: 'bildr-chrome',
  content: 'bildr-chrome rounded-xl bg-default ring-white/8 divide-white/8',
  header: 'min-h-0 px-5 py-4 sm:px-5',
  title: 'text-[13px] font-semibold',
  description: 'mt-0.5 text-[12px] text-muted',
  close: 'top-3 end-3',
  body: 'p-5 sm:p-5',
  footer: 'justify-end gap-2 px-5 py-3 sm:px-5'
}
export const MODAL_WIDTHS = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl'
}
export type ModalWidth = keyof typeof MODAL_WIDTHS

/** A select option. */
export interface EditorOption {
  label: string
  value: string
  icon?: string
  disabled?: boolean
}

/** Select items as options: a string is its own label and value. */
export function toOptions(items: readonly (string | EditorOption)[]): EditorOption[] {
  return items.map(item => (typeof item === 'string' ? { label: item, value: item } : item))
}

export function findOption(options: readonly EditorOption[], value: string | undefined): EditorOption | undefined {
  return value === undefined ? undefined : options.find(option => option.value === value)
}

export type UiSlots = Record<string, string | undefined>

/** A kit `ui` with a caller's additions: the caller's classes go last, so they win (Nuxt UI merges them). */
export function mergeUi(base: UiSlots, extra?: UiSlots): UiSlots {
  if (!extra) return base
  const merged: UiSlots = { ...base }
  for (const [slot, classes] of Object.entries(extra)) {
    merged[slot] = [base[slot], classes].filter(Boolean).join(' ')
  }
  return merged
}
