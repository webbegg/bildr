/**
 * What the Data workspace's drafts (the query Definition's, the action's steps) share: a copy of a plain value, so a draft never
 * shares what the model's refresh replaces, and whether two plain values are the same (JSON compares them: key order counts, as
 * it does in the file a step is stored in).
 */

/** A copy of a plain value, so the base and the draft never share what the model's refresh replaces. */
export function plainCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
