# Spares Tracker Mobile

The approved Spares Tracker SVG logo and mark variants are in `assets/branding/`. Expo uses the supplied icon and Android adaptive icon files in `assets/`.

React Native and Expo client for inventory staff and field-service engineers. It supports desktop-approved pairing, secure session restore/logout, searchable inventory, stock counts, offline stock changes that sync when connectivity returns, and QR/barcode lookup against saved inventory.

Company role behavior follows the backend: owners and admins may adjust unallocated stock in any store; managers and engineers may adjust central or personally assigned stock. The app hides adjustment controls where the server would deny access, while the API remains authoritative. Platform-admin access does not grant tenant inventory access.

The scanner accepts part numbers directly or from QR URLs using `part_number`, `partNumber`, `sku`, or `code` query parameters. The current generated v1 API has no barcode field, so other desktop workflows (parts, stores, equipment, transfers, reports, and company administration) still need versioned mobile endpoints before they can be added safely.

## Backend environments

The EAS `production` build profile connects to the migrated SaaS/PostgreSQL API. The `preview` profile remains a demo build backed by mock data. Local development uses mock data unless `EXPO_PUBLIC_API_BASE_URL` is set in an ignored `.env.local` file. Do not put credentials in the API URL or commit credentials.

The `staging` profile requires `EXPO_PUBLIC_API_BASE_URL` to be configured in the EAS `preview` environment and should point to a separate non-production SaaS/PostgreSQL deployment. Do not use the production URL for staging or live smoke tests. Before validating sign-in or stock changes, use an authorized test account against a non-production deployment.

## Checks

```sh
npm test
npm run test:api
npm run typecheck
npm run bundle:native
```

See `docs/superpowers/specs/2026-10-17-expo-mobile-client-design.md` for the original API and session design, `docs/superpowers/specs/2026-10-23-offline-stock-adjustments.md` for stock editing and offline sync behavior, and `docs/superpowers/specs/2026-10-23-mobile-roles-and-stock-scanning.md` for role and scanner behavior.
