# Spares Tracker Mobile

React Native and Expo client for inventory staff and field-service engineers. The first slice includes invitation-based sign-in, secure session restore/logout, and read-only inventory browsing with local search and refresh.

## Run during development

Install Node.js 22.13 or newer, run `npm ci`, then start the development server with `npm start`. Development uses deterministic preview data when `EXPO_PUBLIC_API_BASE_URL` is unset. Enter a valid-looking email address and any non-empty password to try the interface. This mode never sends credentials or stores preview tokens in device secure storage.

For local development against a SaaS/PostgreSQL environment, set `EXPO_PUBLIC_API_BASE_URL` to its HTTPS API base URL before starting Expo. The app adds `/api/v1/...` paths. Never use the production SQLite URL or put tokens or passwords in this variable.

## Checks

```sh
npm test
npm run test:api
npm run typecheck
npm run bundle:native
```

See `docs/superpowers/specs/2026-10-17-expo-mobile-client-design.md` for the API contract, security boundaries, and UI behavior.
