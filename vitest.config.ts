import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'tools/*/src/**/*.test.ts'],
    passWithNoTests: true,
  },
  // The one tool's own `@/` alias (tools/eventstorming/vite.config.ts), so its pure
  // model tests run under the root suite without a second runner.
  resolve: { alias: { '@': fileURLToPath(new URL('./tools/eventstorming/src', import.meta.url)) } },
})
