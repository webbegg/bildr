import { z } from 'zod'
import { ThemePatchSchema, themeOptions } from '#shared/design/theme'
import { IdSchema } from '#shared/document/schema'
import { defineAction } from './define'

export const themeGet = defineAction({
  name: 'theme_get',
  description: 'Get the project theme (semantic colours, font, base radius, spacing density) and the options each field accepts: Tailwind palette names (or any #rrggbb hex for a colour), fonts, radii and spacings.',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    const project = await services.loadProject(projectId)
    return { theme: project.theme, options: themeOptions() }
  }
})

export const themeUpdate = defineAction({
  name: 'theme_update',
  description: 'Change part of the project theme. Colours (primary, secondary, success, info, warning, error, neutral) take a Tailwind palette name or a #rrggbb hex; fields left out keep their value. Token classes such as bg-primary, mt-10 and rounded-lg follow the theme. Undoable.',
  input: ThemePatchSchema.extend({ projectId: IdSchema }),
  run: async ({ projectId, ...theme }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update theme', [{ op: 'setTheme', theme }])
    return { version: project.version, theme: project.theme }
  }
})
