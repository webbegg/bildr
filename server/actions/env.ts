import { z } from 'zod'
import { IdSchema } from '#shared/document/schema'
import { ENV_MAX_VARS, EnvNameSchema, envListEntry, envList as listed, EnvValueSchema, setEnvVar } from '#shared/env/variables'
import { ActionError, defineAction } from './define'

/**
 * Project environment variables (`{{ env.NAME }}`), stored outside the
 * document: not in project_get, the undo history or change events, and not
 * undoable. Public values resolve in texts, props and theme colours and are
 * published with the app; secret values are write-only and only the server
 * reads them, for API sources (URL and headers).
 */

const USE_HINT = 'Reference one as {{ env.NAME }}: public variables work in any text or prop, theme colours ({{ env.NAME }} holding #rrggbb) and API sources; secret variables work only in an API source\'s url and headers, resolved on the server.'

export const envList = defineAction({
  name: 'env_list',
  description: `List the project's environment variables: { name, secret: false, value } for public ones, { name, secret: true, set: true } for secret ones (secret values are write-only and never returned). ${USE_HINT}`,
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    await services.loadProject(projectId)
    return { variables: listed(await services.env.list(projectId)) }
  }
})

export const envSet = defineAction({
  name: 'env_set',
  description: `Create or update an environment variable. A new variable needs a value and is public unless secret is true. Left out, value and secret keep their current values; turning a secret public needs a new value. Values are strings up to 4 KB, at most ${ENV_MAX_VARS} variables. Not undoable. Public values reach the published app on the next publish; API sources read the current values. ${USE_HINT}`,
  input: z.object({
    projectId: IdSchema,
    name: EnvNameSchema.describe('Capital letters, digits and _, starting with a letter, e.g. API_KEY'),
    value: EnvValueSchema.optional().describe('The value; for a secret it can never be read back'),
    secret: z.boolean().optional().describe('Secret variables never leave the server')
  }),
  run: async ({ projectId, ...input }, ctx) => {
    const project = await ctx.services.loadProject(projectId)
    const result = setEnvVar(await ctx.services.env.list(projectId), input)
    if ('problem' in result) throw new ActionError('invalid', result.problem)
    await ctx.services.env.save(projectId, result.vars)
    ctx.notify(projectId, project.version)
    return envListEntry(result.vars.find(v => v.name === input.name)!)
  }
})

export const envDelete = defineAction({
  name: 'env_delete',
  description: 'Delete an environment variable. Refs to it stop resolving: published apps render them empty after the next publish, and API sources using it fail until it is set again. Not undoable.',
  input: z.object({ projectId: IdSchema, name: EnvNameSchema }),
  run: async ({ projectId, name }, ctx) => {
    const project = await ctx.services.loadProject(projectId)
    const vars = await ctx.services.env.list(projectId)
    if (!vars.some(v => v.name === name)) throw new ActionError('not_found', `Variable "${name}" not found`)
    await ctx.services.env.save(projectId, vars.filter(v => v.name !== name))
    ctx.notify(projectId, project.version)
    return { name }
  }
})
