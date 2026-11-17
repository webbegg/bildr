import type { Row } from '@bildr/codegen/query'
import { attempt } from './dataArtifactActions.ts'
import type { Editor } from './useEditor.ts'

/**
 * Saving sample data (D4, S4): what the Rows tab and the record panel ask of the module. A write of the shown collection's
 * fixtures is one module action (`fixture_row_create`, `fixture_row_update`, `fixture_rows_delete`), which validates against
 * the collection's fields and writes `.bildr/`: the editor never writes the app's own rows (E2). Each returns the module's
 * refusal as the sentence the caller shows where the user is typing (`undefined`: it was saved), not the screen's banner.
 *
 * A row is named by its id, or, when it has none, by its place among the rows, which a delete moves. So an update or a delete
 * also sends `base`: the row as the user was shown it. The module refuses (409) when the row now at that key is another one.
 */

/** A cell's value to save: what `cellValue` reads of typed text, or a boolean toggled. */
export type CellValue = string | number | boolean | null

const refusal = (done: { result: unknown } | { error: string }): string | undefined => 'error' in done ? done.error : undefined

/** Saves one value of one sample row; `base` is the row as it was shown when the edit began. */
export async function saveSampleValue(editor: Editor, entity: string, row: string, field: string, value: CellValue, base?: Row): Promise<string | undefined> {
  return refusal(await attempt(editor, 'fixture_row_update', { entity, row, ...(base ? { base } : {}), values: { [field]: value } }, 'Could not save the value'))
}

/** Adds a blank sample row; its refusal, if any. */
export async function addSampleRow(editor: Editor, entity: string): Promise<string | undefined> {
  return refusal(await attempt(editor, 'fixture_row_create', { entity }, 'Could not add the row'))
}

/** Deletes sample rows by id (one or several: all or none); `base` holds the rows as they were shown, by key. The module's refusal, if any. */
export async function deleteSampleRows(editor: Editor, entity: string, rows: string[], base?: Record<string, Row>): Promise<string | undefined> {
  return refusal(await attempt(editor, 'fixture_rows_delete', { entity, rows, ...(base ? { base } : {}) }, 'Could not delete the rows'))
}
