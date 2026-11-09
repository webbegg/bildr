/**
 * How a Form's submit reaches the server, by where the app runs: the editor's
 * draft preview has no published snapshot, so no public endpoint, and creates
 * the record with the `record_create` action (S20: "drafts via
 * `record_create`"); a published app posts to its public data endpoint, which
 * takes it only for `publicCreate` collections.
 */
export type FormTarget = { kind: 'draft', projectId: string } | { kind: 'published', projectSlug: string }

export type FormSubmitRequest
  = | { via: 'action', name: 'record_create', input: { projectId: string, collection: string, values: Record<string, string> } }
    | { via: 'http', url: string, body: { values: Record<string, string> } }

export function formSubmitRequest(target: FormTarget, collection: string, values: Record<string, string>): FormSubmitRequest {
  if (target.kind === 'draft') return { via: 'action', name: 'record_create', input: { projectId: target.projectId, collection, values } }
  return { via: 'http', url: `/api/public/${target.projectSlug}/${collection}`, body: { values } }
}
