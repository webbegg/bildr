import type { DataRecord } from './records'

/** Numbers requests so only the latest one's answer applies, e.g. when records are opened in quick succession. */
export function createLatestGuard() {
  let latest = 0
  return {
    start: () => ++latest,
    isLatest: (token: number) => token === latest
  }
}

/** The open record as the panel shows it: the list row, replaced by the fetched record once it arrives; values the fetch left empty keep the row's. */
export function openRecordView(row: DataRecord, fetched: DataRecord | null): DataRecord {
  if (!fetched || fetched.id !== row.id) return row
  const values = { ...row.values }
  for (const [key, value] of Object.entries(fetched.values)) if (value !== null && value !== undefined) values[key] = value
  return { ...fetched, values }
}
