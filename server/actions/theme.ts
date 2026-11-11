import { z } from 'zod'
import { CustomColorsPatchSchema, ThemePatchSchema, themeOptions } from '#shared/design/theme'
import { IdSchema } from '#shared/document/schema'
import { defineAction } from './define'

export const themeGet = defineAction({
  name: 'theme_get',
  description: 'Get the project theme (semantic colours, optional custom named colours, font, base radius, spacing density) and the options each field accepts: Tailwind palette names (or any #rrggbb hex for a colour), fonts, radii and spacings. Custom colours (theme.custom, name → hex) are usable by name on colour style keys, e.g. { "bg": "brand" }.',
  input: z.object({ projectId: IdSchema }),
  readOnly: true,
  run: async ({ projectId }, { services }) => {
    const project = await services.loadProject(projectId)
    return { theme: project.theme, options: themeOptions() }
  }
})

export const themeUpdate = defineAction({
  name: 'theme_update',
  description: 'Change part of the project theme. Colours (primary, secondary, success, info, warning, error, neutral) take a Tailwind palette name or a #rrggbb hex; fields left out keep their value. custom adds or changes named colours of the project\'s own (name → #rgb, #rrggbb or #rrggbbaa; names are lowercase with dashes, e.g. brand or ink-2, and cannot be a colour token such as primary or muted); null removes one, refused while a style still uses it. Colour style keys (bg, color, borderColor) take a custom colour by name. Token classes such as bg-primary, mt-10 and rounded-lg follow the theme. Undoable.',
  input: ThemePatchSchema.extend({ projectId: IdSchema, custom: CustomColorsPatchSchema.optional() }),
  run: async ({ projectId, custom, ...theme }, ctx) => {
    const project = await ctx.services.mutate(ctx, projectId, 'Update theme', [{ op: 'setTheme', theme, ...(custom ? { custom } : {}) }])
    return { version: project.version, theme: project.theme }
  }
})
