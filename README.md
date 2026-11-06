# Spares Tracker Mobile

The approved Spares Tracker SVG logo and mark variants are in `assets/branding/`. Expo uses the supplied icon and Android adaptive icon files in `assets/`.

React Native and Expo client for inventory staff and field-service engineers. It supports desktop-approved pairing, secure session restore/logout, searchable inventory, store and transfer workflows, online receiving and consumption, stock counts, offline stock changes that sync when connectivity returns, and QR/barcode lookup against saved inventory.

Company role behavior follows the backend: owners and admins may adjust unallocated stock in any store; managers and engineers may adjust central or personally assigned stock. The app hides adjustment controls where the server would deny access, while the API remains authoritative. Platform-admin access does not grant tenant inventory access.

The scanner accepts part numbers directly or from QR URLs using `part_number`, `partNumber`, `sku`, or `code` query parameters. Scan lookup remains part-number based because the inventory API has no barcode field. Inventory search submits text and selected-store filters to the versioned API, while saved inventory remains available for offline search. The initial inventory refresh still downloads all pages to maintain the offline snapshot. Inventory, parts, stores, transfers, overview totals, equipment, and movement history use versioned v1 endpoints. Reports and company administration have no mobile API workflows yet. See [mobile API coverage](docs/design/mobile-api-coverage.md) for the route inventory and remaining integration work.

## Backend environments

The EAS `production` and `live-preview` build profiles connect to the migrated SaaS/PostgreSQL API. Use `live-preview` to pair an internal build with the desktop account; the `preview` profile remains a demo build backed by mock data. Live preview uses production accounts and inventory, so count changes are real. Local development uses mock data unless `EXPO_PUBLIC_API_BASE_URL` is set in an ignored `.env.local` file. Do not put credentials in the API URL or commit credentials.

The `staging` profile requires `EXPO_PUBLIC_API_BASE_URL` to be configured in the EAS `preview` environment and should point to a separate non-production SaaS/PostgreSQL deployment. Do not use the production URL for staging tests. Before validating sign-in or stock changes on staging, use an authorized test account against that non-production deployment.

Build the live internal app with `eas build --profile live-preview --platform all`.

## Checks

```sh
npm test
npm run test:api
npm run typecheck
npm run bundle:native
```

The generated API contract check reads only `/api/v1/openapi.json`, without credentials or data requests. Run it against a non-production SaaS/PostgreSQL deployment after the backend contract is deployed:

```sh
SAAS_API_BASE_URL="https://your-staging-api.example" npm run check:mobile-api-contract
```

See `docs/superpowers/specs/2026-10-17-expo-mobile-client-design.md` for the original API and session design, `docs/superpowers/specs/2026-10-23-offline-stock-adjustments.md` for stock editing and offline sync behavior, and `docs/superpowers/specs/2026-10-23-mobile-roles-and-stock-scanning.md` for role and scanner behavior.
