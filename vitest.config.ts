import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/test/**/*.test.ts'],
          // The editor SPA has its own project (Vue, Nuxt UI, happy-dom).
          exclude: [...configDefaults.exclude, 'packages/editor/**']
        }
      },
      'packages/editor/vitest.config.ts'
    ]
  }
})
