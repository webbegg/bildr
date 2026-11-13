import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '#shared': fileURLToPath(new URL('./shared', import.meta.url))
          }
        },
        test: {
          name: 'root',
          include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
          // The editor SPA has its own project (Vue, Nuxt UI, happy-dom).
          exclude: [...configDefaults.exclude, 'packages/editor/**']
        }
      },
      'packages/editor/vitest.config.ts'
    ]
  }
})
