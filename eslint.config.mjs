// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { getDefaultAttributes } from 'eslint-plugin-better-tailwindcss/api/defaults'

export default createConfigForNuxt({
  features: {
    standalone: true,
    stylistic: { commaDangle: 'never', braceStyle: '1tbs' }
  }
}).append(
  // Codegen golden fixtures are standalone Nuxt projects with their own lint config.
  { ignores: ['fixtures/**'] },
  betterTailwindcss.configs['correctness-error'],
  {
    settings: {
      'better-tailwindcss': {
        entryPoint: 'packages/editor/src/main.css',
        attributes: [
          ...getDefaultAttributes(),
          ['^v-bind:ui$', [{ match: 'objectValues' }]]
        ]
      }
    }
  }
)
