# ADR 0006: Plain SQL migrations with node-postgres

- **Status:** Accepted (2026-11-09)
- **Requirements:** R3, R4

## Context
Both the identity vault and the activity database are security-critical schemas. Reviewers need to be able to read exactly what the database enforces.

## Decision
- **Migrations are plain SQL files** named `NNNN_name.sql`, one folder per service:
  - `apps/vault/migrations`
  - `apps/api/migrations`
- **A small shared runner applies them** (`@demanity/db`, `migrate()`). It:
  - applies the files in order, each in its own transaction;
  - records a SHA-256 checksum for every applied file;
  - **refuses to start if an applied migration was later edited**;
  - takes an advisory lock, so two runners can't migrate at the same time.
- **Queries use [node-postgres](https://node-postgres.com/) (`pg`)** with parameterized SQL only.

## Alternatives considered
- **Drizzle ORM.** Its docs currently describe the 1.0 release candidate, while the stable release is 0.45. Building against docs that don't match the installed version is a correctness risk. We can revisit once 1.0 is stable.
- **Prisma.** It adds a generated client and its own migration engine. That is more machinery between reviewers and the actual SQL.

## Consequences
- The schema is reviewed as SQL, exactly as the database runs it.
- There is no generated type layer, so row types are declared by hand at each query.
- Integration tests run against real Postgres: a throwaway database is created and then dropped for each test file.
