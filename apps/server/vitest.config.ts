import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    setupFiles: ['./test/setup.ts'],
    // All integration tests share one Postgres DB and re-seed a single demo user
    // (email demo@switch.app) in their own beforeAll via runSeed(). Vitest's default
    // file parallelism runs test files concurrently in separate workers, which races
    // multiple runSeed() calls against that same shared row set (one file deleting
    // accounts/transactions while another is mid-insert). Serialize file execution so
    // each file's seed-then-test cycle completes before the next one starts.
    fileParallelism: false,
  },
});
