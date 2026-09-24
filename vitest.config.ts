import { defineConfig } from 'vitest/config'

// One Vitest run covers every workspace. Each project is a plain unit-test
// project: the engine and shared packages are pure TypeScript, and Worker tests
// exercise pure functions (no @cloudflare/vitest-pool-workers).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'engine',
          root: './packages/engine',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'worker',
          root: './apps/worker',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
})
