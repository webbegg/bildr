import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    name: 'editor',
    environment: 'happy-dom',
    include: ['test/**/*.test.ts']
  }
}))
