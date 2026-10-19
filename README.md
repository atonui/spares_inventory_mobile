# Spares Tracker Mobile

React Native and Expo client for inventory staff and field-service engineers. The first slice includes invitation-based sign-in, secure session restore/logout, and read-only inventory browsing with local search and refresh.

## Run during development

Install Node.js 22.13 or newer, run `npm ci`, then start the development server with `npm start`. Development uses deterministic preview data when `EXPO_PUBLIC_API_BASE_URL` is unset. Enter a valid-looking email address and any non-empty password to try the interface. This mode never sends credentials or stores preview tokens in device secure storage.

## Install a native build on a phone

This project includes EAS Build profiles so iOS and Android binaries can be built in the cloud without a local Xcode or Android Studio setup.

1. Sign in to Expo and link this repository to an EAS project once:

   ```sh
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

2. Build and install a development client. It uses preview data by default and connects to a running Expo development server:

   ```sh
   npx eas-cli@latest build --profile development --platform android
   npx expo start --dev-client
   ```

   Use `--platform ios` for an iPhone build. Internal iOS installation requires an Apple Developer account and registered test devices.

3. Build a standalone demo app for your phone. It uses deterministic mock data, makes no API requests, and is labeled “Spares Tracker Demo” with a separate app identifier:

   ```sh
   npx eas-cli@latest build --profile preview --platform android
   ```

4. Build an internal staging app to test the real SaaS API:

   ```sh
   npx eas-cli@latest build --profile staging --platform android
   ```

   Set `EXPO_PUBLIC_API_BASE_URL` in the EAS `preview` environment to the HTTPS SaaS/PostgreSQL API base URL first. The staging app is labeled “Spares Tracker Staging” and has a separate app identifier. Production builds use the EAS `production` environment and fail closed at startup when the URL is missing or is not HTTPS. Never set the SQLite production URL. The variable is public app configuration, so do not put credentials or tokens in it.

The `development` profile creates an internal development client. The `preview` and `staging` profiles create installable internal Android APKs. The `production` profile creates store-distributed builds and increments the app build number.

For local development against a SaaS/PostgreSQL environment, set `EXPO_PUBLIC_API_BASE_URL` to its HTTPS API base URL before starting Expo. The app adds `/api/v1/...` paths. Never use the production SQLite URL or put tokens or passwords in this variable.

## Checks

```sh
npm test
npm run test:api
npm run typecheck
npm run bundle:native
```

See `docs/superpowers/specs/2026-10-17-expo-mobile-client-design.md` for the API contract, security boundaries, and UI behavior.
