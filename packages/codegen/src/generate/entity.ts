import type { EntityFile } from '../model/schemas.ts'
import { allFields, datasourceOf, entityNames, isWritable, repositoryOf } from './context.ts'
import type { Field, ModuleContext } from './context.ts'
import { importLine } from './imports.ts'
import { VALUE_TYPES } from '../model/field-types.ts'
import { file, header, pascal, regexLiteral, tsLiteral, tsString } from './text.ts'

/** Kernel schemas a field expression uses, so callers can import them. */
export type KernelName = 'IdSchema' | 'TimestampSchema'

/** The zod expression for one field: base type, bounds, pattern, then nullability and default. */
export const zodField = (field: Field, kernel: Set<KernelName>): string => {
  let expression: string
  if (field.name === 'id' && field.type === 'uuid') {
    kernel.add('IdSchema')
    expression = 'IdSchema'
  } else if (field.type === 'datetime') {
    kernel.add('TimestampSchema')
    expression = 'TimestampSchema'
  } else if (field.type === 'select') {
    expression = `z.enum([${(field.options ?? []).map(tsString).join(', ')}])`
  } else if (field.type === 'image') {
    // An entity's image has always been any text (a path like /img/a.png too): its stored rows keep loading.
    expression = 'z.string()'
  } else {
    expression = VALUE_TYPES[field.type].zod
  }
  if (field.min !== undefined) expression += `.min(${field.min})`
  if (field.max !== undefined) expression += `.max(${field.max})`
  if (field.pattern !== undefined) expression += `.regex(${regexLiteral(field.pattern)}${field.patternMessage ? `, ${tsString(field.patternMessage)}` : ''})`
  if (field.nullable) expression += `.nullable()${field.default === undefined ? '.default(null)' : ''}`
  if (field.default !== undefined) expression += `.default(${tsLiteral(field.default)})`
  else if (!field.required && !field.nullable) expression += '.optional()'
  return expression
}

/** `shared/domain/<entity>.ts`: the entity's zod schemas and types (decision: one schema for form, route and repository). */
export const domainFile = (context: ModuleContext, entity: EntityFile) => {
  const names = entityNames(entity)
  const repository = repositoryOf(context, entity)
  const writable = isWritable(repository)
  const kernel = new Set<KernelName>()
  const fields = allFields(entity).map(field => `  ${field.name}: ${zodField(field, kernel)}`)
  const source = repository ? datasourceOf(context, repository) : undefined
  // Omitted from what clients send: timestamps first, then other read-only fields.
  const omitted = [...(entity.timestamps ? ['createdAt', 'updatedAt'] : []), ...entity.fields.filter(field => field.readonly).map(field => field.name)]
  const unique = entity.fields.filter(field => field.unique)

  return {
    path: context.paths.entity(names.file),
    source: context.source(entity.id),
    content: file([
      header(context.source(entity.id)),
      'import { z } from \'zod\'',
      kernel.size > 0 && importLine('#core/kernel/ids', [...kernel]),
      '',
      source?.kind === 'rest' && !writable && `/** A read-only entity owned by the "${source.name}" REST data source. */`,
      `export const ${names.type}Schema = z.object({`,
      fields.join(',\n'),
      '})',
      `export type ${names.type} = z.infer<typeof ${names.type}Schema>`,
      ...(writable
        ? [
            '',
            `/** What a client may send to create a ${names.type}.${entity.idStrategy === 'uuid' ? ' The id is client-generated for optimistic inserts.' : ''} */`,
            `export const New${names.type}Schema = ${omitted.length ? `${names.type}Schema.omit({ ${omitted.map(name => `${name}: true`).join(', ')} })` : `${names.type}Schema`}`,
            `export type New${names.type} = z.input<typeof New${names.type}Schema>`
          ]
        : []),
      ...(unique.length ? ['', ...unique.map(field => `export const ${names.type}${pascal(field.name)}Schema = ${names.type}Schema.shape.${field.name}`)] : [])
    ])
  }
}
