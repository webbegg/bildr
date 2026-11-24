/**
 * The Layout section's alignment matrix (layout-containers L2, Figma's 3×3
 * pad): one control over a stack's `justify` (its main axis) and `items` (its
 * cross axis). A row's main axis runs along x, a column's along y; a reversed
 * stack starts at the far end, so its cells are mirrored on the main axis. A
 * distributed `justify` (between, around, evenly) fills the main-axis line,
 * and a click then only moves the cross axis; a stretched `items` fills the
 * cross-axis line. Without a token CSS applies: `justify` start, `items`
 * stretch.
 */

export type AxisPosition = 'start' | 'center' | 'end'

/** Distribute: packed (the matrix places the children) or spread over the main axis. */
export type Distribution = 'packed' | 'between' | 'around' | 'evenly'

export interface AlignState {
  /** The row axis is horizontal. */
  row: boolean
  reversed: boolean
  main: AxisPosition | 'distributed'
  distribution: Distribution
  cross: AxisPosition | 'stretch' | 'baseline'
}

export interface MatrixCell {
  /** Column of the matrix, 0 (left) to 2 (right). */
  x: number
  /** Row of the matrix, 0 (top) to 2 (bottom). */
  y: number
  /** The `justify` the cell writes when packed. */
  main: AxisPosition
  /** The `items` the cell writes. */
  cross: AxisPosition
  active: boolean
  /** Where the children go, as a person says it ("Top left", "Center"). */
  label: string
}

export const DISTRIBUTIONS: readonly Distribution[] = ['packed', 'between', 'around', 'evenly']

const POSITIONS: readonly AxisPosition[] = ['start', 'center', 'end']
const SPREADS = ['between', 'around', 'evenly']

/** The matrix state of a stack's direction, justify and items (undefined: CSS's default). */
export function alignState(direction: string, justify: string | undefined, items: string | undefined): AlignState {
  const spread = !!justify && SPREADS.includes(justify)
  const cross = items === 'stretch' || items === 'baseline' || POSITIONS.includes(items as AxisPosition) ? items as AlignState['cross'] : 'stretch'
  return {
    row: direction.startsWith('row'),
    reversed: direction.endsWith('-reverse'),
    main: spread ? 'distributed' : POSITIONS.includes(justify as AxisPosition) ? justify as AxisPosition : 'start',
    distribution: spread ? justify as Distribution : 'packed',
    cross
  }
}

const VERTICAL = ['Top', '', 'Bottom']
const HORIZONTAL = ['left', '', 'right']

/** The cell's label from its place: "Top left", "Left", "Center"... */
const cellLabel = (x: number, y: number) => {
  const words = [VERTICAL[y], HORIZONTAL[x]].filter(Boolean)
  if (!words.length) return 'Center'
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The nine cells, top-left first, with the ones the state places children in active. */
export function matrixCells(state: AlignState): MatrixCell[] {
  const cells: MatrixCell[] = []
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const [mainAt, crossAt] = state.row ? [x, y] : [y, x]
      const main = POSITIONS[state.reversed ? 2 - mainAt : mainAt]!
      const cross = POSITIONS[crossAt]!
      const mainActive = state.main === 'distributed' || state.main === main
      const crossActive = state.cross === 'stretch' || (state.cross === 'baseline' ? cross === 'start' : state.cross === cross)
      cells.push({ x, y, main, cross, active: mainActive && crossActive, label: cellLabel(x, y) })
    }
  }
  return cells
}

/**
 * What a cell writes: its `justify` (kept when distributed) and `items`.
 * `stretch` (Alt+click) stretches the cross axis, `between` (a double-click)
 * spreads the main axis.
 */
export function cellWrite(state: AlignState, cell: MatrixCell, gesture: 'place' | 'stretch' | 'between' = 'place'): Record<string, string> {
  const items = gesture === 'stretch' ? 'stretch' : cell.cross
  if (gesture === 'between') return { justify: 'between', items }
  return state.main === 'distributed' ? { items } : { justify: cell.main, items }
}

/** What Distribute writes: a spread as its `justify`; Packed puts the children at the start where a spread applied. */
export function distributeWrite(state: AlignState, next: Distribution): Record<string, string> {
  if (next === state.distribution) return {}
  if (next === 'packed') return { justify: 'start' }
  return { justify: next }
}
