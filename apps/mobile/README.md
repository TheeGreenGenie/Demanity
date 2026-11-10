# @demanity/mobile

The Demanity app: one Expo Router codebase for iOS, Android and web.

## Running it
```bash
pnpm install           # from the repo root
pnpm --filter @demanity/mobile start   # then press i / a / w
```

## Checks
```bash
pnpm --filter @demanity/mobile typecheck
pnpm --filter @demanity/mobile lint
```

## Notes
- **Template origin.** This app was generated from Expo's default template (SDK 58). The template's license is kept in [LICENSE-EXPO-TEMPLATE](LICENSE-EXPO-TEMPLATE), and Demanity's own code is AGPL-3.0-or-later.
- **Adding packages.** Use `pnpm expo install <pkg>` so the versions match the SDK.
  - On pnpm, pass `-- -D` for dev dependencies. The `--dev` flag shown in Expo's docs doesn't work with pnpm.
- **Before changing Expo APIs,** read [AGENTS.md](AGENTS.md).
- **ESLint is pinned to 9.x here,** because `eslint-plugin-react`, which `eslint-config-expo` depends on, doesn't support ESLint 10 yet.
