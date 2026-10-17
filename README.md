# SparesFlow Mobile

React Native and Expo client for inventory staff and field-service engineers. The first slice includes invitation-based sign-in, secure session restore/logout, and read-only inventory browsing with local search and refresh.

## Run on a phone

1. Install Node.js 22.13 or newer and the Expo Go app on your phone.
2. Run `npm ci` and `npm start` in this directory.
3. Scan the Expo QR code with Expo Go. The phone and development machine need to be able to reach one another on the network.

With `EXPO_PUBLIC_API_BASE_URL` unset, development uses deterministic preview data. Enter a valid-looking email address and any non-empty password to try the interface. This mode never sends credentials or stores preview tokens in device secure storage.

To connect a SaaS/PostgreSQL environment, set `EXPO_PUBLIC_API_BASE_URL` to its HTTPS API base URL, then restart Expo. The app adds `/api/v1/...` paths. Do not use the production SQLite URL and do not put tokens or passwords in this variable. Release bundles fail closed when the URL is missing or not HTTPS.

## Checks

```sh
npm test
npm run test:api
npm run typecheck
npm run bundle:native
```

See `docs/superpowers/specs/2026-10-17-expo-mobile-client-design.md` for the API contract, security boundaries, and UI behavior.
