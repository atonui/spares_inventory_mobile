# Expo Mobile Client Implementation Plan

> Execution method: native implementation in this session. The user selected React Native with Expo; this replaces the previous Flutter plan before app code existed.

**Goal:** Build the first Spares Tracker mobile slice: invitation-only sign-in, secure session handling, and read-only tenant inventory with local search and cursor pagination.

**Architecture:** Expo SDK + React Native + TypeScript, Expo Router, repository interfaces, mock-first development, `expo-secure-store` for credentials, and an HTTPS implementation of the six generated v1 endpoints.

**Spec:** `docs/superpowers/specs/2026-10-17-expo-mobile-client-design.md`

## Constraints

- Preserve repository and technical identifiers; display name Spares Tracker.
- No tenant IDs in requests; the authenticated server session determines tenant scope.
- Mock API only in development/tests; release requires explicit HTTPS SaaS URL.
- Never select production SQLite or commit API credentials.
- Keep app inventory read-only and preserve branding/accessibility semantics.
- Follow generated Expo `AGENTS.md`: Expo Router routes under `src/app/`, SDK-compatible native packages via `npx expo install`, no hand-edited generated `ios/` or `android/` folders.

## Task 1: Expo scaffold, config safety, branding — complete

Create Expo TypeScript project files, Expo Router setup, app config validation, Spares Tracker SVG source and icon exports. Write config tests first for development mocks, missing release URL rejection, non-HTTPS rejection, and URL normalization. Verify with Jest and `tsc`.

## Task 2: API transport and authentication — initial slice complete

Read current generated OpenAPI and backend handlers before finalizing fixtures. Implement typed API errors and injected fetch transport; test CSRF request ordering, native login payload/response validation, no cookies, safe error envelope, malformed JSON and transient transport errors. Implement secure-store adapter and session lifecycle; test atomic session storage, restore via `/me`, refresh request-ID reuse on an identical ambiguous retry, concurrent refresh coalescing, one-time protected-request retry, rejected refresh clearing, transient failure retention, and confirmed logout.

## Task 3: Sign-in and session gate — initial slice complete

Build accessible, responsive sign-in UI with validation, remember-me, safe retryable errors, restoration/loading states, and inventory navigation. Use repository injection so deterministic mocks work without API credentials. Add widget tests for validation, error feedback, successful login, restored session, and sign-out.

## Task 4: Inventory data and pagination — initial slice complete

Implement validated inventory DTO, deterministic mock repository, and HTTP repository. Write tests for initial `limit=50`, cursor URL encoding, page accumulation, null termination, repeated-cursor protection, malformed pages, and deterministic mock data.

## Task 5: Inventory browse/search UI — initial slice complete

Implement loading, populated, empty, retryable-error, search, pagination progress, status labels, and retry behavior. Search the full accumulated set locally. Add controller and widget tests, including confirmation that no stock mutation controls are present.

## Task 6: Build-mode wiring and CI — initial slice complete

Wire mock/real repositories from validated config; configure Expo app identity and icons without renaming repo or package identifiers. Add README setup and SaaS smoke-test checklist. Add GitHub Actions for install, lint, typecheck, Jest, and Expo Doctor. Run the full suite and inspect the diff before opening a reviewable PR.

## Review focus

- Partial or malformed auth response never creates a stored session.
- Simultaneous 401s share one rotation; retried requests never refresh a second time.
- Only exact ambiguous refresh retry reuses its request ID.
- Pagination cannot loop forever and search cannot omit later pages.
- Release config never silently falls back to mock or non-HTTPS API.
