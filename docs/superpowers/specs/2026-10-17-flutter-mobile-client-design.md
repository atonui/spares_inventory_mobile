# Flutter Mobile Client Design

**Status:** Draft for review  
**Date:** 2026-10-17  
**Project:** `atonui/spares_inventory_mobile`  
**Display name:** SparesFlow (provisional; do not rename repository, package, or technical identifiers)

## Purpose

Build the first shared iOS and Android client for inventory staff and field-service engineers. The first usable slice covers invitation-only sign-in, secure session restoration and logout, and read-only company inventory browsing with search and pagination. It carries the approved SparesFlow visual design into the Flutter app without adding workflows or changing backend behavior.

The mobile repository is currently empty. The existing Expo client in `atonui/spares_inventory` is a behavioral reference for its API and session edge cases; it is not an implementation base. All company scope remains server-derived from the authenticated session.

## Goals

1. Create one Flutter application for iOS and Android.
2. Implement the approved Inventory and Sign in screens using the SparesFlow palette and shelf mark.
3. Keep API access behind a small interface so the UI can use deterministic mock data in development and tests, with an HTTPS implementation for the SaaS API.
4. Implement the current six-route v1 contract, including refresh-token rotation.
5. Keep inventory read-only; do not add movement, receipt, dispatch, or work-order mutation flows.

## Non-goals

- Changes to `atonui/spares_inventory`, API routes, tenant policy, or database behavior.
- Sign-up, invitation creation, password recovery, user administration, tenant selection, platform administration, or account switching.
- Stock adjustments, dispatch, receiving, barcode scanning, offline writes, or store submission.
- A second native codebase or a port of the Expo source.

## Contract and Environment

The backend generates its OpenAPI document at `<API_BASE_URL>/api/v1/openapi.json`; do not check in a copied OpenAPI JSON file as the contract source. The current route allowlist is:

| Method | Path | Use |
|---|---|---|
| GET | `/api/v1/csrf-token` | Fetch the CSRF token for login. |
| POST | `/api/v1/auth/native/login` | Invitation-only credential sign-in. |
| POST | `/api/v1/auth/native/refresh` | Rotate an access/refresh credential pair. |
| GET | `/api/v1/me` | Validate and load the current user. |
| GET | `/api/v1/inventory` | Read one tenant-scoped inventory page. |
| POST | `/api/v1/auth/logout` | Revoke the current server session. |

The running generated contract and backend route implementation are authoritative. The older `2026-10-16-versioned-native-api-contract-design.md` describes refresh as future work; that section is stale relative to the current six-route contract and must not be used to omit refresh support.

`API_BASE_URL` is an environment configuration value, not a secret. Real API mode must require an explicit HTTPS SaaS/PostgreSQL base URL. The production SQLite service must never be selected as a fallback. When no URL is supplied in a development/test build, the app uses the mock implementation; a release build must fail configuration validation instead of silently using mock data. Do not commit real environment values or credentials.

## Application Structure

Use a feature-first Flutter structure with small boundaries and no heavy application framework:

- `lib/app/`: app entry, routing, theme, and startup/session gate.
- `lib/core/config/`: API base URL and development/mock-mode validation.
- `lib/core/network/`: JSON HTTP transport, v1 error decoding, request IDs, and shared retry handling.
- `lib/core/session/`: token model and secure session store.
- `lib/features/auth/`: login, session restoration, refresh, and logout.
- `lib/features/inventory/`: inventory DTOs, repository, paging, local search, and list UI.
- `assets/branding/`: source logo/icon artwork and app-ready exports.
- `test/`: transport, repository, session, and widget tests.

Expose repository interfaces to presentation state. Provide a deterministic mock implementation for preview and tests and a real HTTP implementation for integration. Avoid tenant IDs in client requests: the bearer session is the only tenant context.

Use Flutter's built-in `ChangeNotifier` for the first slice unless baseline project setup reveals a concrete need for another state package. Use platform secure storage backed by iOS Keychain and Android Keystore for the session pair. Keep dependencies limited to HTTP transport and secure storage; resolve current compatible package versions during implementation.

## Authentication and Session Behavior

1. **Sign in:** request `/api/v1/csrf-token`, then POST the existing email/password/remember-me fields to `/api/v1/auth/native/login` with `X-CSRF-Token`. Do not send browser cookies. Validate the response fields before saving the access token, refresh token, expiry, and user summary as one session value.
2. **Restore:** read the secure session at startup and validate it through `/api/v1/me`. A protected `401` triggers one token refresh and one retry of the original request.
3. **Refresh:** POST the refresh token to `/api/v1/auth/native/refresh` with a generated `X-Request-ID`. Reuse the exact same request ID only when retrying the identical refresh request after an ambiguous/lost response, as required by the server's bounded retry behavior. Persist the rotated pair atomically. Coalesce concurrent refresh attempts so a single expired access token does not replay the same refresh token multiple times.
4. **Failure handling:** clear stored credentials when the refresh credential is rejected as expired or revoked. Keep the pair for transient network/service failures so the user can retry. Decode the standard `{error:{status,code,detail,request_id}}` response and show only safe `detail`; never log credentials.
5. **Logout:** POST `/api/v1/auth/logout` with the access bearer. Clear secure credentials only after the server confirms success. If the server cannot confirm, retain the pair and show a retryable error.

Requests use HTTPS, `Authorization: Bearer` only on protected routes, `credentials`/cookies omitted, and no-store behavior for session responses. No refresh or access token appears in analytics, logs, crash metadata, or UI text.

## Inventory Behavior

- Fetch `/api/v1/inventory` using `limit=50` and the opaque `cursor`; continue with `page.next_cursor` until it is `null`. Treat cursors as opaque, URL-encode them, and fail safely if a non-null cursor repeats.
- Validate each page shape and preserve the API's item fields: `id`, part/store IDs, part number, description, store name/type/owner, quantity, minimum threshold, allocation state, and optional work order.
- The current v1 contract does not provide a search query parameter. Search is therefore local over the complete fetched dataset; do not imply it is a server-side search. The UI may reveal rows incrementally, but search results must not silently omit later API pages.
- Show loading, empty, retryable error, and populated states in the existing Inventory screen. Keep list status semantics from the current product; the mobile slice makes no stock changes.

## Visual Design and Accessibility

- Use deep navy `#15263B`, amber `#E9A23B`, slate `#64748B`, pale neutral `#F5F7FA`, and white surfaces.
- Use the live-text “SparesFlow” wordmark and the geometric shelf icon with one amber stock block. Keep app icons icon-only.
- Preserve existing semantic colors and labels for Available/Allocated stock, errors, warnings, and success states.
- Amber-filled primary actions use navy text for contrast. Use a darker slate for small secondary text on pale neutral surfaces when necessary; the exact palette slate remains suitable on white and for supporting icons.
- Preserve platform touch-target and focus behavior, support text scaling, and pair color with status labels rather than relying on color alone.

## Error and Loading States

Transport errors, invalid JSON, malformed success responses, API envelopes, timeout/unreachable service, expired refresh tokens, and empty inventory receive distinct user-recoverable states. Do not retry unsafe operations automatically; this first slice only reads inventory and performs the explicitly idempotent session flows above. Show request IDs only in a support/debug detail affordance where appropriate, never raw server internals.

## Verification

The implementation is accepted when:

1. `flutter analyze` and `flutter test` pass on a clean checkout.
2. Unit tests cover login CSRF ordering, response validation, secure session save/clear behavior, startup restore, refresh request-ID reuse, one-time 401 retry, concurrent refresh coalescing, transient refresh retention, and rejected refresh clearing.
3. Inventory tests cover cursor encoding, page accumulation, null termination, repeated-cursor protection, malformed pages, local search across all fetched pages, and empty/error/loading states.
4. Widget tests cover sign-in validation/error feedback, inventory search, status labels, and session navigation without changing the approved workflows.
5. No tests or configuration can select the production SQLite API as the real mobile backend; SaaS integration uses an explicit HTTPS base URL.
6. Manual smoke testing documents iOS and Android layout, text scaling, sign-in, restore, inventory search, pagination, logout, and server-unavailable recovery against the SaaS/PostgreSQL environment once its base URL is supplied.

## Delivery Sequence

1. Review and approve this design spec.
2. Write and review a task-by-task implementation plan.
3. Scaffold the Flutter app and brand assets, then implement the mock-first vertical slice behind the agreed repository interfaces.
4. Verify the app with unit/widget tests and a SaaS/PostgreSQL smoke test when the correct API base URL is available.

The app design is intentionally limited to the approved first slice. Later features should be specified against the versioned API before they are added.
