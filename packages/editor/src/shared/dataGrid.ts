import type { DataField } from './dataModel.ts'

/**
 * The editable rows table's pure parts (S4): where a key moves the active cell, and how a cell's text becomes the value saved
 * (and back). The module's `fixture_row_update` is the judge of a value: this only reads typed text into the JSON value it
 * would be, and hands over what it cannot read (a word in a number cell) so the module's refusal says what is wrong.
 */

export interface CellPos {
  row: number
  col: number
}

export type CellMove = 'up' | 'down' | 'left' | 'right' | 'next' | 'previous'

/**
 * The cell a move leads to in a grid of `size`. The arrows stop at the edges; Tab (`next`) and Shift+Tab (`previous`) go
 * along the row and wrap to the next or the previous one, and return null past the last or the first cell: the focus leaves
 * the grid there, as it does from any table.
 */
export function moveCell(pos: CellPos, move: CellMove, size: { rows: number, cols: number }): CellPos | null {
  const last = { row: size.rows - 1, col: size.cols - 1 }
  switch (move) {
    case 'up':
      return { row: Math.max(0, pos.row - 1), col: pos.col }
    case 'down':
      return { row: Math.min(Math.max(0, last.row), pos.row + 1), col: pos.col }
    case 'left':
      return { row: pos.row, col: Math.max(0, pos.col - 1) }
    case 'right':
      return { row: pos.row, col: Math.min(Math.max(0, last.col), pos.col + 1) }
    case 'next':
      if (pos.col < last.col) return { row: pos.row, col: pos.col + 1 }
      return pos.row < last.row ? { row: pos.row + 1, col: 0 } : null
    case 'previous':
      if (pos.col > 0) return { row: pos.row, col: pos.col - 1 }
      return pos.row > 0 && last.col >= 0 ? { row: pos.row - 1, col: last.col } : null
  }
}

/** The text a cell starts editing with: the stored value, or nothing for an empty one. */
export const cellEditText = (value: unknown): string => value === null || value === undefined ? '' : String(value)

/**
 * The value typed text saves as. Text stays as typed, but an optional one that is emptied is none (null: the key leaves the
 * row); numbers are read, and what is not a number is sent as it is so the module says "must be a number"; dates, date-times
 * and uuids are trimmed, empty is none.
 */
export function cellValue(field: DataField, text: string): string | number | null {
  const trimmed = text.trim()
  switch (field.type) {
    case 'text':
    case 'image':
      return text === '' && !field.required ? null : text
    case 'integer':
    case 'number':
      if (trimmed === '') return null
      return Number.isFinite(Number(trimmed)) ? Number(trimmed) : trimmed
    default:
      return trimmed === '' ? null : trimmed
  }
}
