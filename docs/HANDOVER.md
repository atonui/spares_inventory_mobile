# Spares Tracker Mobile — Engineering Handover

**Repository:** `atonui/spares_inventory_mobile`  
**Stack:** Expo SDK 58, React Native 0.88, React 19, TypeScript, Expo Router  
**Prepared:** 2026-11-16 · **Updated:** 2026-11-20 (backend is PostgreSQL-only)

This document describes the implementation visible in the repository at the time it was written and records operational context that is not fully captured by the design specs. The generated backend OpenAPI document is authoritative for what a deployed backend currently serves. Treat the deployment details below as repo configuration, not proof of what is configured in a particular EAS or Vercel project.

## 1. Overview

Spares Tracker Mobile is for inventory staff and field-service engineers working in stores, warehouses, and in the field. The app pairs with an existing desktop account; it is not a standalone account-registration app.

The current mobile feature set includes:

- Desktop-approved device pairing, native session restore, and sign-out.
- A home overview and inventory browsing, search, store filtering, sorting, stock status, and item details.
- QR/barcode camera scanning and manual pairing-code entry.
- Browsing parts, stores, assigned equipment, pending transfers, and stock movement history.
- Online receiving, consuming/issuing, transferring, receiving, and returning stock.
- Add-stock and count adjustments, including an offline queue, conflict review, and a short undo window.
- Per-user saved inventory and directory data for offline viewing. The native app uses SQLite; web preview uses browser local storage.

The main landing route is inventory; Home is a separate compact overview reached through app navigation. Reports and company administration are not mobile workflows today.

For intended screens and interaction behavior, start with [the screen wireframes and storyboard](design/mobile-screen-wireframes-and-storyboard.md). For the expanded implemented API surface, use [mobile API coverage](design/mobile-api-coverage.md). The original specs are useful for design rationale and edge-case expectations: [client design](superpowers/specs/2026-10-17-expo-mobile-client-design.md), [roles and scanning](superpowers/specs/2026-10-23-mobile-roles-and-stock-scanning.md), and [offline adjustments](superpowers/specs/2026-10-23-offline-stock-adjustments.md).

## 2. Architecture

### Project map

- `src/app/` contains Expo Router screens and route layout. Routes include inventory (`index.tsx`), Home, Scan, Offline changes, Profile, Settings, item detail, parts, stores, equipment, transfers, My Parts, and Receive Stock. `_layout.tsx` hosts the root stack and a session-revocation watcher.
- `src/api/` contains the authenticated HTTP client, mock client, runtime selection, session storage adapters, and response parsers/contracts.
- `src/core/config/` resolves app variant and API configuration.
- `src/features/auth/` contains pairing UI and client role capabilities.
- `src/features/inventory/` contains inventory fetching/parsing/sorting, detail and stock-operation UI, offline snapshots and queue persistence, store directories, and scan lookup.
- `src/features/navigation/`, `src/features/network/`, and `src/features/overview/` hold shared navigation/icons, connectivity helpers, and directory/record screens.

Keep routes in `src/app/`; reusable behavior and UI belongs under `src/features/` or `src/api/`. Expo Router discovers files in `src/app/`, so putting helper modules there can accidentally create routes.

### State and data flow

There is no global Redux-style state store. Screens use React state/effects and pass data through route parameters or shared feature components. Inventory fetching and cursor accumulation are in `inventoryRepository.ts`; the inventory screen coordinates the current list, filters, loading state, saved snapshot, and queue overlay. Local persistence is accessed through the `offlineStockStore` interface, with native and `.web.ts` implementations selected by platform resolution.

The UI overlays queued desired quantities on saved inventory so a worker sees their locally accepted change immediately. A completed server refresh replaces the snapshot only when all pages have loaded; progressive pages can be rendered during the first load while the last complete snapshot remains a fallback. The app currently fetches every inventory page on refresh to preserve a complete offline inventory.

### Navigation

Expo Router uses a root stack with hidden headers. App tabs/navigation are rendered by `AppBottomNavigation`; task routes such as scan and item details are pushed on top. The inventory route is the initial work area; Home is a separate overview. Confirm actual navigation patterns in the screens and storyboard before adding new routes.

### API client

Screens call the `api` object from `src/api/runtime.ts`. Runtime config selects mock data for the demo variant; configured non-demo builds create the authenticated client with an HTTPS API base URL. The client centralizes JSON transport, bearer headers, response validation, cursor handling, refresh/retry, and endpoint-specific request shapes. It omits cookies and requires HTTPS. Company/tenant scope is derived from the bearer session and is not supplied as a client-selected tenant ID.

Do not treat `mockClient.ts` behavior as evidence that a backend route exists. For live routes and schemas, inspect the deployed `/api/v1/openapi.json` and `docs/design/mobile-api-coverage.md`.

## 3. Authentication

### Desktop-approved pairing

The user begins pairing from the already signed-in desktop account's Connect mobile app area. The phone scans the short-lived QR capability or accepts a pairing code. The mobile app submits it to `POST /api/v1/auth/mobile-pairing/claim`, receives a claim token, and polls `POST /api/v1/auth/mobile-pairing/complete` until the desktop user approves or the claim expires. The QR/code does not itself authorize inventory access; desktop approval is explicit. The app polls at 1.5-second intervals and stops on expiry or cancellation.

When approval returns a session, the app saves it, calls `/api/v1/me`, saves the profile for offline recovery, and loads inventory. This final step matters: a successful desktop approval alone does not complete the mobile signed-in state.

Accounts are created only by invitation on the web app (`POST /api/users` returns 410), and admins cannot set user passwords; password changes go through account recovery on the web. The mobile app has no sign-up, invitation, or password flows and should not add them.

The separate native login method is implemented in the API client, including CSRF acquisition, but the expected user-facing sign-in entry in current product flow is desktop pairing. Do not expose a new credential flow without aligning it with product and backend requirements.

### Restore and token lifecycle

On native platforms, the access/refresh session pair is JSON in Expo SecureStore (iOS Keychain / Android Keystore). On web preview, the adapter uses `sessionStorage`; it is not equivalent to native secure storage and generally lasts only for the browser tab/session. On app start, `/api/v1/me` validates the saved session. A 401 triggers a refresh attempt and retry once; refresh calls are coalesced so concurrent requests do not rotate the same token pair independently. The same request ID is reused for a retry after a lost refresh response because the backend supports replay for that ID.

Transient network errors can keep the existing session/profile and use saved data. 401/403 responses are authorization outcomes, not offline signals: they clear the session/snapshot or trigger revalidation rather than showing cached inventory as though access remains valid. The root layout also checks `/me` when the app returns to foreground and every 30 seconds while active; revoked/expired access signs out.

### Logout

Logout posts to `/api/v1/auth/logout`; local session credentials are cleared only after server confirmation. If the server responds 401/403, local access is cleared because it is already invalid. Before sign-out, the UI warns about queued/conflicted stock changes. The active offline user pointer and current inventory snapshot are cleared, but the queue is stored per user and is not automatically erased. This avoids silently deleting unsynced work; users can sign back in as that user to recover it.

## 4. Offline behavior

The backend runs only on PostgreSQL (multi-tenant, with row-level security per organization) and has no SQLite code. SQLite appears in this app only as the on-device offline cache.

Offline persistence is scoped by user ID, not by a client-controlled tenant. On native, Expo SQLite stores inventory snapshots, profile/directory data, and queued stock adjustments. On web, a local-storage adapter provides preview behavior; browser storage durability and transaction semantics differ from SQLite.

A stock count/add-stock action validates a whole-number quantity, creates or replaces a queued operation, updates the visible count optimistically, and offers Undo for about eight seconds. A queue record contains user ID, inventory row ID, expected quantity, desired quantity, operation UUID, timestamp, status, and an error message; it contains no auth token. Multiple queued count edits for the same item coalesce while preserving the original expected server quantity and operation ID.

The app attempts sync after a save, when network connectivity returns, and during refresh/re-entry paths. Sync sends queued entries in order to `POST /api/v1/inventory/adjustments`. Stable operation IDs make retries idempotent. The server checks `expected_quantity` atomically; a 409 means the server count changed. That operation is marked as a conflict, and later queued edits for that same inventory row are held for review. Temporary/network failures leave work queued. Other client 4xx failures (except 401 and 429) are marked for review instead of retrying indefinitely. 401 is handled as session validation; rate limits and server/network failures remain retryable.

Conflict resolution requires refreshing the current server quantity before the user discards the stale count; the worker can then enter a new count from the current value. The offline queue currently covers count/add-stock adjustments only. Receive, consume, and transfer operations require an online response; they are not queued offline. This boundary prevents presenting an unconfirmed movement as committed.

## 5. Roles and authorization

`src/features/auth/roleCapabilities.ts` mirrors the known stock-access policy for control visibility:

| Role | Client-side stock adjustment visibility |
|---|---|
| Owner / admin | Unallocated stock in any store |
| Manager / engineer | Unallocated stock in a central store or personally assigned store |
| Other roles | No adjustment control |

Allocated inventory is not adjustable through these controls. Platform-admin status alone does not grant company inventory access. The UI hides controls the user should not be able to use to reduce confusion, but this is only a usability hint. Every protected action is still checked by the server; never rely on client role checks as authorization. The session's active company membership and server-derived tenant scope are authoritative.

The rules above are those implemented/documented for stock access. **UNVERIFIED:** this handover has not independently compared every route's permission matrix against the live backend OpenAPI and service code. Before adding a sensitive workflow, check its backend policy and response behavior directly.

## 6. Scanning and barcode support

The scan route requests camera permission only after the user opens Scan. Expo Camera reads supported QR and barcode formats. A scanned plain string is treated as a part number. For URL payloads, the app extracts a value from `part_number`, `partNumber`, `sku`, or `code` query parameters, then compares it case-insensitively against loaded inventory part numbers. If the same part number occurs in multiple inventory rows/stores, the UI can present the matches for selection. Scan lookup is currently a lookup workflow, not an independent stock movement.

The scanner currently has success/not-found audio assets and optional haptic feedback, with a user setting to disable haptics. Audio player setup/playback failures are caught so visual results remain available. Device-level sound/vibration behavior can vary with OS settings and hardware; verify on actual devices.

The current inventory API response has **no barcode/UPC field**, so the scanner cannot reliably resolve barcode-only identifiers. It is part-number based because part number is the stable identifier currently present in the mobile inventory contract. Supporting real barcode lookup requires the backend to add a barcode/UPC field to the inventory (and likely parts) response, define normalization and uniqueness/duplicate behavior, optionally support server-side search by that field, regenerate/deploy OpenAPI, then update client parsing, lookup, tests, and ambiguous-match UI. The desktop write path/import process must also populate that identifier. Until those pieces exist, do not claim that scanning any barcode resolves an item. Part numbers are limited to 25 characters on the server, so a longer scanned value cannot match a part.

## 7. Builds and environments

The repository defines these EAS build profiles in `eas.json`:

| Profile | Distribution / variant | API target in repo | Notes |
|---|---|---|---|
| `production` | Store / `production` | Railway production SaaS/PostgreSQL URL | Store build; auto-increments app version. |
| `live-preview` | Internal / `staging` variant | Same Railway production API URL | Internal APK on Android; real production accounts and inventory. Count/movement changes are real. |
| `preview` | Internal / `demo` variant | Mock client | Demo data, Android APK. |
| `staging` | Internal / `staging` variant | `EXPO_PUBLIC_API_BASE_URL` expected from EAS `preview` environment | Must be a separate non-production SaaS/PostgreSQL backend. Android APK. Actual EAS variable value is not in the repo. |
| `development` | Internal development client / `development` | Local/dev config; mock unless an API URL is configured | Useful for development builds. |

Variant configuration in `app.config.js` gives demo and staging distinct app labels/identifiers so they can coexist with production. `EXPO_PUBLIC_API_BASE_URL` can also be set in ignored local `.env.local`; never place credentials in URLs or commit secrets.

The README says a Vercel web preview is deployed and the conversation identified `https://sparesinventorymobile.vercel.app/`. The repo includes `vercel.json` for a static Expo web export. **UNVERIFIED:** this checkout does not establish which Vercel project/deployment is currently production, which branch it deploys, or which environment variables are set there. Verify these in the Vercel dashboard before changing deployment settings.

`live-preview` is a material operational risk: its name sounds safe, but its checked-in API URL points to production and it uses the staging app variant only for app identity. Pairing it to a real desktop account exposes production inventory, and stock writes affect production. Restrict distribution and replace this profile's target with a non-production API when staging is available; verify the actual EAS profile/env configuration before sharing builds.

## 8. Tests and checks

Run from the repo root after installing dependencies (`npm ci`):

| Command | Coverage / purpose |
|---|---|
| `npm test` | Jest unit/component suite: API/session behavior, role capabilities, inventory parsing/sorting/snapshots, offline queue/store behavior, screen flows, scanner, and operations. |
| `npm run test:api` | Node test runner for API contract/operation checks, including generated OpenAPI checker behavior and stock-operation request shapes. |
| `npm run typecheck` | TypeScript compiler, no output (`tsc --noEmit`). |
| `npm run lint` | Expo lint (ESLint configuration). |
| `npx expo-doctor` | Expo config/dependency diagnostics. |
| `npm run bundle:native` | Expo export for Android and iOS JavaScript bundles; catches Metro/platform bundling issues, not native device behavior. |
| `SAAS_API_BASE_URL=https://<non-production-host> npm run check:mobile-api-contract` | Reads only `/api/v1/openapi.json`; checks required routes, inventory search/store query parameters, and bearer declarations. It does not authenticate or test data endpoints. Must target non-production SaaS/PostgreSQL. |

Some shell environments parse the assignment differently; if needed, export `SAAS_API_BASE_URL` first, then run the checker. Never run live mobile validation against the production API; use a separate non-production deployment. Physical iOS/Android pairing, camera, haptics, keyboard, and layout validation still requires devices/builds; a successful JS export does not validate those behaviors.

The most recent user-reported verification before this handover (PR #46) was 14 suites / 71 tests, lint, typecheck, and Expo web export passing; `--clear` was needed after a stale Metro cache. Later merged changes have their own PR checks. **UNVERIFIED:** this handover has not rerun or audited the current CI state for the current main commit.

## 9. API coverage gaps

The app now has versioned v1 routes for auth/session, inventory, parts, overview, equipment, movement history, stores/transfers, stock adjustments, receiving, consuming, transfer creation/completion, and logout. See [the API coverage table](design/mobile-api-coverage.md) for the exact paths.

Known gaps and limits:

- No barcode/UPC field in the inventory response; scanner resolution is part-number based.
- Inventory search currently covers part number, description, store name/type, and work order. Supplier, serial number, and location search require backend fields and searchable contract support.
- Initial refresh downloads all inventory pages to keep a complete offline snapshot. This transfer/startup cost grows with tenant size; page-by-page rendering improves perceived speed but does not eliminate the full download.
- No mobile report generation/export, company settings, user/role administration, or invitations. These should wait for versioned backend endpoints and documented permission behavior.
- The versioned contract advertises email-change confirmation, but the mobile app does not call it.
- The contract checker confirms OpenAPI route/security declarations, not authorization for each role, database behavior, or end-to-end workflow correctness.

The API coverage page is dated 2026-11-05. Recheck deployed OpenAPI before treating this list as the live backend state.

## 10. Decisions log

| Decision | Why |
|---|---|
| Desktop-approved pairing rather than a QR containing a session | A QR is a short-lived claim capability, not access. The desktop owner/admin explicitly approves each device; credentials are returned only after approval. |
| Server derives company scope from bearer session | Prevents a modified client from selecting another tenant and keeps authorization on the trusted side. |
| Keep offline stock changes in a durable per-user queue | Warehouse connectivity is unreliable; local acknowledgement lets workers continue while preserving the operation for retry. Per-user scoping prevents one signed-in user seeing another user's queued work. |
| Send expected quantity and operation ID with an adjustment | Expected quantity prevents silently overwriting intervening server changes; stable IDs make network retries idempotent. Conflicts are surfaced for a human decision. |
| Keep receiving, consuming, and transfers online-only | These are movement operations with server-side consequences. The app does not mark them complete offline without backend confirmation or a matching offline protocol. |
| Treat 401/403 differently from connection failure | Cached stock must not conceal expired sessions or revoked membership. Only transient connectivity failures permit offline fallback. |
| Use Expo Router and Expo-native storage/camera/network modules | Keeps navigation and native capabilities aligned with the Expo-managed app and shared iOS/Android codebase. Check SDK 58 versioned docs before changing Expo APIs. |
| Keep mock data behind demo variant | Designers/developers can use deterministic preview data without accidentally writing to a live tenant. Live and staging profiles must remain visibly distinct operationally. |
| Render inventory pages progressively but retain only completed snapshots | Early rows improve perceived responsiveness; a partial fetch must not overwrite the last complete offline snapshot and falsely imply the directory is complete. |

## 11. Known issues, debt, and deliberate deferrals

- Full inventory pagination is still required to create/refresh the complete offline snapshot. Large tenants pay the transfer cost even when the visible search is narrow.
- Barcode-only lookup, supplier/serial/location search, alert-specific server result sets, and incremental snapshot refresh await API contract support.
- The web preview stores session data in tab-scoped `sessionStorage` and offline data in `localStorage`; browser storage is a preview convenience, not native-equivalent security/durability.
- Offline queue support is limited to count/add-stock adjustments. Receiving, consuming, and transfer mutations fail/require online service.
- Reports and company administration are deliberately deferred until the backend exposes mobile routes and permission rules.
- Live contract validation against a non-production SaaS/PostgreSQL deployment and a full physical iOS/Android workflow review are still listed as remaining integration work in the docs. Confirm whether these have since been completed before scheduling another validation cycle.
- **UNVERIFIED:** the current EAS environment variables, Vercel project/branch settings, production deployment health, and status of the live contract check were not accessible from the repo contents used to prepare this file.

## 12. Suggested next steps (priority order)

1. **Reduce production risk:** inspect the actual EAS `live-preview` environment and stop distributing it as a safe preview while it targets production data. Point internal validation to a separate staging SaaS/PostgreSQL backend; verify the `staging` profile's EAS URL is configured correctly.
2. **Finish contract validation:** deploy the current generated mobile API contract to staging and run `check:mobile-api-contract`; then test pairing, revoked access, search/store filtering, receive/consume/transfer, and adjustment conflicts using an authorized staging account.
3. **Complete device review:** on physical iOS and Android, check pairing/restore/revocation/sign-out, scan permission and supported formats, haptic/audio feedback and its setting, numeric keyboard behavior, offline recovery, and small-screen layouts. Record OS/device/build versions and gaps.
4. **Settle barcode support end-to-end:** agree on identifier format, uniqueness and duplicate behavior with backend/desktop; add barcode/UPC to generated API and data entry/import flows; then update mobile parser, lookup, and tests.
5. **Plan for larger inventories:** measure cold-start and refresh against a realistically large staging tenant. Decide whether to implement demand pagination, incremental snapshot updates, or a server-managed offline download without breaking local search/offline completeness expectations.
6. **Prioritize additional workflows by API readiness:** reports/admin need new versioned routes and per-role rules. Keep those out of the mobile UI until the contract, audit behavior, and failure semantics are agreed.

