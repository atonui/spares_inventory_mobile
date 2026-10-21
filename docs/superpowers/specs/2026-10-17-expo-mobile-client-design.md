# React Native with Expo Mobile Client Design

**Status:** First scope and desktop-approved mobile pairing implemented; live SaaS and physical-device validation pending

**Date:** 2026-10-17  
**Project:** `atonui/spares_inventory_mobile`  
**Display name:** SparesFlow (provisional; do not rename repository or technical identifiers)

## Purpose and first slice

Build one iOS and Android client for inventory staff and field-service engineers. The first usable slice covers desktop-approved account pairing, secure session restoration and logout, and read-only company inventory browsing with search and cursor pagination. Carry the approved SparesFlow visual design into the native app.

Use React Native with Expo and TypeScript. The existing Expo client in `atonui/spares_inventory` was reviewed for API and session edge cases; its tested transport behavior was selectively carried over, while the SparesFlow pairing screen and preview data are implemented here.

## Goals and non-goals

Goals: shared iOS/Android implementation; desktop-account pairing and Inventory screens; small repository interfaces with deterministic mocks; an HTTPS implementation of the generated v1 API; secure credentials; testable behavior.

Out of scope: self-service sign-up, invitations, password recovery, account switching or administration; stock mutations, offline writes, or store submission; a second codebase per platform.

## Contract and environment

The backend generates its OpenAPI document at `<API_BASE_URL>/api/v1/openapi.json`; do not check in a copied JSON contract. The running generated contract and backend route implementation remain authoritative. The production SQLite service must never be selected for mobile SaaS integration.

| Method | Path | Use |
|---|---|---|
| POST | `/api/v1/auth/native/refresh` | Rotate access and refresh credentials. |
| POST | `/api/v1/auth/mobile-pairing/claim` | Exchange a short-lived desktop QR capability for a pending device claim. |
| POST | `/api/v1/auth/mobile-pairing/complete` | Poll approval and receive a one-time native session after desktop approval. |
| GET | `/api/v1/csrf-token` | Fetch CSRF token before session logout. |
| GET | `/api/v1/me` | Validate and load the current user. |
| GET | `/api/v1/inventory` | Read one tenant-scoped inventory page. |
| POST | `/api/v1/auth/logout` | Revoke the current server session. |

The desktop user starts pairing from Profile → Connect mobile app. The QR capability expires after two minutes and may be claimed once. Claiming never grants access; the desktop must explicitly approve the named device. The server issues one native session only after approval. Pairing capability responses are never cached.

`EXPO_PUBLIC_API_BASE_URL` is configuration, not a secret. Real API mode requires an explicit HTTPS SaaS/PostgreSQL base URL. If absent, development/test uses deterministic mock repositories; release configuration fails rather than silently using mock data. Do not commit environment values or credentials.

Before a live mobile smoke test, compare the backend's generated contract with the seven required routes using `SAAS_API_BASE_URL="https://your-saas-postgres-api.example" npm run check:mobile-api-contract`. This reads only `/api/v1/openapi.json`; it does not send credentials or call data endpoints. Never point it at the production SQLite service.

## Architecture

Use Expo Router and TypeScript. The first slice currently uses a single routed screen plus a typed API client and inventory repository:

- `src/app/`: Expo Router layout and invitation sign-in/inventory screen.
- `src/core/config/`: HTTPS and mock/real-mode validation.
- `src/api/`: JSON fetch transport, refresh/session behavior, SecureStore adapter, and deterministic mock client.
- `src/features/inventory/`: validated DTO, cursor pagination, and repeated-cursor protection.
- `assets/branding/`: clean SVG source; platform icons are generated from the icon-only SVG.
- `tests/` and colocated `*.test.ts`: API transport, config, inventory, and sign-in/inventory screen coverage.

Use Expo SecureStore for the access/refresh pair (iOS Keychain and Android Keystore). Keep dependencies focused on Expo SDK modules and React Native UI primitives. Company scope is derived from the bearer session; never send tenant identifiers.

## Authentication and session behavior

1. Pairing explains that the user must first sign in to their desktop account. Scan the desktop’s short-lived QR code, send only its payload and a generic device label to the claim endpoint, then poll using the claim token in the request body. Do not send browser cookies or put capability tokens in URLs. Validate the full approval response before storing a single serialized session value.
2. Restore reads the secure session and validates it through `/api/v1/me`. A protected 401 triggers at most one refresh and one retry of the original request.
3. Refresh posts the refresh token with a generated `X-Request-ID`; reuse the same ID only when retrying that identical request after an ambiguous/lost response. Persist rotated credentials atomically and coalesce concurrent refresh attempts.
4. Clear credentials when refresh is rejected as expired/revoked. Preserve them on transient network/service errors. Decode `{error:{status,code,detail,request_id}}`; display safe detail only and never log credentials.
5. Logout clears credentials only after server confirmation; otherwise retain the session and show a retryable error.

Use HTTPS, bearer auth only for protected routes, omit cookies, and avoid storing/caching auth responses. Tokens must not appear in logs, analytics, crash metadata, or UI text.

## Inventory behavior

Fetch `/api/v1/inventory` with `limit=50` and opaque `cursor` until `page.next_cursor` is null. URL-encode cursors and fail safely on repeated cursors. Validate response shape and retain item fields `id`, part/store IDs, part number, description, store name/type/owner, quantity, minimum threshold, allocation state, and optional work order.

The v1 contract has no search query. Search is local over the complete fetched dataset; the UI may reveal rows while pages accumulate, but results must not silently omit later pages. Show loading, empty, retryable error, and populated states. No stock mutation controls.

## Visual design and accessibility

Use navy `#15263B`, amber `#E9A23B`, slate `#64748B`, pale neutral `#F5F7FA`, and white surfaces. Use live “SparesFlow” text with a geometric shelf icon containing one amber stock block; app icons remain icon-only. Preserve semantic stock, error, warning, and success colors and labels. Amber primary actions use navy text. Support platform touch targets, focus, text scaling, and non-color status cues.

## Verification and delivery

Current verification includes `npm test`, `npm run test:api`, `npm run typecheck`, lint, Expo Doctor, and Android/iOS JavaScript bundle export. Covered behaviors include config safety, CSRF-before-login, bearer-only protected requests, refresh request-ID reuse, coalesced refresh/retry, transient/rejected refresh outcomes, logout retention, cursor accumulation/repetition protection, sign-in validation, successful and rejected sign-in, valid/expired/transient session restoration, sample inventory, search/filter/sort, item details, and read-only UI.

The first-scope implementation is complete. Live validation still requires an HTTPS SaaS/PostgreSQL API base URL and an authorized test account. Physical-device verification still requires a linked Expo project and EAS development builds. Do not test against the production SQLite service.

Use Expo development builds/cloud builds for native integration and GitHub Actions for reproducible checks. A phone-friendly preview may use Expo Snack, but production source and tests live in this repository.
