# ADR 0001: Node.js/TypeScript + Expo, mobile-first

- **Status:** Accepted (2026-11-09)
- **Requirements:** R4

## Context
- Demanity will be marketed to Gen Z and millennials, so it has to ship as a mobile app.
- Guests must be able to browse on the web, and search engines must be able to index public pages.
- As an open-source project, it needs a large pool of potential contributors.

## Decision
- **Codebase:** a TypeScript monorepo managed with pnpm and Turborepo.
- **App:** **Expo (React Native) with Expo Router**, one universal app for iOS, Android and web.
- **API:** **Fastify** on Node.js LTS.
- **Data:**
  - PostgreSQL, the source of truth (its unique constraints enforce one ballot per token);
  - Redis, for caching and rate limits;
  - Meilisearch, for search;
  - BullMQ, for ingestion jobs.
- **Passkeys:**
  - server side: [SimpleWebAuthn](https://simplewebauthn.dev/);
  - client side: a native passkey library, chosen in Phase 1.
- **Privacy split:** a separate **identity-vault** service with its own database ([ADR 0002](0002-uniqueness-token-and-identity-vault.md)).
- **Operations:** OpenTelemetry, containers and infrastructure-as-code.
- **AI fact-checking:** sits behind a provider adapter. The default is the latest Claude model.

## Alternatives considered
| Option | Why not chosen |
|---|---|
| Elixir/Phoenix | Smaller contributor pool; weaker mobile story |
| Python/Django + React | Two languages; less suited to real-time features |
| Fork of Lemmy (Rust) | Federation conflicts with central one-person verification |
| Next.js web + a separate native app | Two UI codebases. Expo Router covers web from one codebase instead. Revisit if web SEO falls short. |

## Consequences
- One language across client and server.
- Web SEO depends on Expo Router's static and server rendering. This needs validating in Phase 0.
