import { defineConfig } from 'vitest/config';

// Integration tests use real Postgres/Redis and spawn processes; under parallel
// CI load (lint + typecheck + build + three suites at once) the defaults
// (5 s per test, 10 s per hook) were exceeded intermittently.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
