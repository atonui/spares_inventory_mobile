# Spares Tracker Mobile

The approved Spares Tracker SVG logo and mark variants are in `assets/branding/`. Expo uses the supplied icon and Android adaptive icon files in `assets/`.

React Native and Expo client for inventory staff and field-service engineers. It supports desktop-approved pairing, secure session restore/logout, searchable inventory, stock counts, and offline stock changes that sync when connectivity returns.

## Checks

```sh
npm test
npm run test:api
npm run typecheck
npm run bundle:native
```

See `docs/superpowers/specs/2026-10-17-expo-mobile-client-design.md` for the original API and session design, and `docs/superpowers/specs/2026-10-23-offline-stock-adjustments.md` for stock editing and offline sync behavior.
