import { defineConfig } from 'vitest/config';

// Integration tests use real Postgres/Redis and spawn processes; under parallel
// CI load (lint + typecheck + build + three suites at once) the defaults
// (5 s per test, 10 s per hook) were exceeded intermittently. Each test file
// creates and migrates its own temporary database, and Postgres serializes
// CREATE DATABASE, so workers are capped to keep setup from queueing past
// the hook timeout when the API and vault suites run together.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 60_000,
    maxWorkers: 4,
  },
});
