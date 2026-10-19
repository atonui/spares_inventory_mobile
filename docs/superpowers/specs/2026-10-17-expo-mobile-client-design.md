# React Native with Expo Mobile Client Design

**Status:** Approved direction; implementation underway  
**Date:** 2026-10-17  
**Project:** `atonui/spares_inventory_mobile`  
**Display name:** Spares Tracker (do not rename repository or technical identifiers)

## Purpose and first slice

Build one iOS and Android client for inventory staff and field-service engineers. The first usable slice covers invitation-only sign-in, secure session restoration and logout, and read-only company inventory browsing with search and cursor pagination. Carry the approved Spares Tracker visual design into the native app without adding workflows or changing backend behavior.

Use React Native with Expo and TypeScript. The existing Expo client in `atonui/spares_inventory` was reviewed for API and session edge cases; its tested transport behavior was selectively carried over, while the Spares Tracker screen and preview data are implemented here.

## Goals and non-goals

Goals: shared iOS/Android implementation; approved Sign in and Inventory screens; small repository interfaces with deterministic mocks; an HTTPS implementation of the current six-route v1 API; secure credentials; testable behavior.

Out of scope: backend or tenant-policy changes; sign-up, invitations, password recovery, account switching or administration; stock mutations, barcode scanning, offline writes, or store submission; a second codebase per platform.

## Contract and environment

The backend generates its OpenAPI document at `<API_BASE_URL>/api/v1/openapi.json`; do not check in a copied JSON contract. The running generated contract and backend route implementation remain authoritative. The production SQLite service must never be selected for mobile SaaS integration.

| Method | Path | Use |
|---|---|---|
| GET | `/api/v1/csrf-token` | Fetch CSRF token before sign-in. |
| POST | `/api/v1/auth/native/login` | Invitation-only email/password/remember-me sign-in. |
| POST | `/api/v1/auth/native/refresh` | Rotate access and refresh credentials. |
| GET | `/api/v1/me` | Validate and load the current user. |
| GET | `/api/v1/inventory` | Read one tenant-scoped inventory page. |
| POST | `/api/v1/auth/logout` | Revoke the current server session. |

`EXPO_PUBLIC_API_BASE_URL` is configuration, not a secret. Real API mode requires an explicit HTTPS SaaS/PostgreSQL base URL. If absent, development/test uses deterministic mock repositories; release configuration fails rather than silently using mock data. Do not commit environment values or credentials.

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

1. Sign-in requests `/api/v1/csrf-token`, then posts existing `email`, `password`, and `remember_me` fields to `/api/v1/auth/native/login` with `X-CSRF-Token`. Do not send browser cookies. Validate the full response before storing a single serialized session value.
2. Restore reads the secure session and validates it through `/api/v1/me`. A protected 401 triggers at most one refresh and one retry of the original request.
3. Refresh posts the refresh token with a generated `X-Request-ID`; reuse the same ID only when retrying that identical request after an ambiguous/lost response. Persist rotated credentials atomically and coalesce concurrent refresh attempts.
4. Clear credentials when refresh is rejected as expired/revoked. Preserve them on transient network/service errors. Decode `{error:{status,code,detail,request_id}}`; display safe detail only and never log credentials.
5. Logout clears credentials only after server confirmation; otherwise retain the session and show a retryable error.

Use HTTPS, bearer auth only for protected routes, omit cookies, and avoid storing/caching auth responses. Tokens must not appear in logs, analytics, crash metadata, or UI text.

## Inventory behavior

Fetch `/api/v1/inventory` with `limit=50` and opaque `cursor` until `page.next_cursor` is null. URL-encode cursors and fail safely on repeated cursors. Validate response shape and retain item fields `id`, part/store IDs, part number, description, store name/type/owner, quantity, minimum threshold, allocation state, and optional work order.

The v1 contract has no search query. Search is local over the complete fetched dataset; the UI may reveal rows while pages accumulate, but results must not silently omit later pages. Show loading, empty, retryable error, and populated states. No stock mutation controls.

## Visual design and accessibility

Use navy `#15263B`, amber `#E9A23B`, slate `#64748B`, pale neutral `#F5F7FA`, and white surfaces. Use live “Spares Tracker” text with a geometric shelf icon containing one amber stock block; app icons remain icon-only. Preserve semantic stock, error, warning, and success colors and labels. Amber primary actions use navy text. Support platform touch targets, focus, text scaling, and non-color status cues.

## Verification and delivery

Current verification includes `npm test`, `npm run test:api`, `npm run typecheck`, and Android/iOS JavaScript bundle export. Covered behaviors include config safety, CSRF-before-login, bearer-only protected requests, refresh request-ID reuse, coalesced refresh/retry, transient/rejected refresh outcomes, logout retention, cursor accumulation/repetition protection, sign-in validation, sample inventory, and read-only UI. Further malformed-response and session-storage tests can be added as the first slice expands.

Use Expo development builds/cloud builds for native integration and GitHub Actions for reproducible checks. A phone-friendly preview may use Expo Snack, but production source and tests live in this repository. SaaS smoke testing waits for the SaaS/PostgreSQL API base URL; never test against the production SQLite service.
