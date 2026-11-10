# @demanity/e2e

Browser end-to-end tests: the real web app, API and identity vault, driven by
Playwright in your locally installed Chrome. A **virtual WebAuthn
authenticator** (Chrome DevTools Protocol) stands in for the user's device, so
passkey sign-up and sign-in run for real.

## Run
```bash
pnpm db:up                                   # Docker: Postgres x2 + Redis
pnpm build                                   # API, vault, db package
pnpm --filter @demanity/mobile exec expo export --platform web
pnpm e2e
```

## Notes
- **Setup:** needs the repo-root `.env` (copy `.env.example`, then run `node scripts/gen-secrets.mjs`).
- **Ports:** the stack starts on the API's 3000, the vault's 3100 and the web app's 8081. Those ports must be free.
- **Email codes:** read from the vault's development email output. No real email is sent.
- **Rate limits:** each run clears the local Redis rate-limit counters first, because the production limits (5 sign-ups per hour) would otherwise block repeated runs. It refuses to do this on a non-local Redis.
- **Leftover data:** test accounts (`e2e_*`) stay in your local development databases. They never go anywhere else.
