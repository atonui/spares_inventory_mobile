# Flutter Mobile Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved first Flutter slice for iOS and Android: invitation-only sign-in, secure session handling, and read-only tenant inventory with search and cursor pagination.

**Architecture:** Keep a feature-first Flutter app with presentation state depending on auth and inventory repository interfaces. Implement one HTTP transport and secure session store, with deterministic mock repositories for local development/tests and explicit HTTPS configuration for SaaS integration. Keep tenant scope server-derived from the bearer session.

**Tech Stack:** Flutter/Dart, `ChangeNotifier`, a small HTTP client dependency, platform secure storage (iOS Keychain/Android Keystore), Flutter unit and widget tests.

**Spec:** `docs/superpowers/specs/2026-10-17-flutter-mobile-client-design.md`

## Global Constraints

- Build one shared Flutter app for iOS and Android.
- Keep the display name SparesFlow provisional; do not rename the repository, package, or technical identifiers.
- Implement only invitation-only sign-in, session restoration/logout, and read-only inventory browse/search/pagination.
- Use the current six generated v1 routes; do not treat copied OpenAPI JSON as the source of truth.
- Real API mode requires an explicit HTTPS SaaS/PostgreSQL base URL; never fall back to production SQLite.
- Mock mode is allowed in development/tests; release configuration must reject missing or non-HTTPS API URLs.
- Store access and refresh credentials using platform secure storage; never log or expose credentials.
- Keep inventory tenant context entirely server-derived; send no tenant identifier.
- Preserve the approved palette, semantic stock/error/warning/success colors, text scaling, labels, and touch targets.

## Review Focus

- Malformed or partial login/session responses must not create a partially valid saved session; test at the auth repository boundary.
- Concurrent protected requests receiving 401 must share one refresh and each retry at most once; test in the authenticated transport task.
- A refresh network timeout must preserve credentials, while a rejected/expired refresh must clear them; test both outcomes in the session task.
- Repeated, malformed, or non-terminating inventory cursors must fail safely without an infinite loop; test in the inventory repository task.
- Search must include records from every fetched page and must not imply server-side filtering; test the fully accumulated dataset in the inventory task.

---

## File Structure

- `lib/main.dart`: application entry and dependency assembly.
- `lib/app/app.dart`: Material app, theme, routing, and startup gate.
- `lib/app/app_controller.dart`: startup/session navigation state.
- `lib/core/config/app_config.dart`: mock/real mode and API URL validation.
- `lib/core/network/api_client.dart`: HTTP transport, bearer attachment, request IDs, and bounded auth retry.
- `lib/core/network/api_error.dart`: decoded server and transport failures.
- `lib/core/session/session.dart`: validated in-memory session value.
- `lib/core/session/session_store.dart`: secure persistence interface and plugin implementation.
- `lib/features/auth/auth_repository.dart`: auth interface and HTTP implementation.
- `lib/features/auth/auth_controller.dart`: login/restore/logout presentation state.
- `lib/features/auth/login_screen.dart`: approved sign-in screen.
- `lib/features/inventory/inventory_item.dart`: validated inventory DTO.
- `lib/features/inventory/inventory_repository.dart`: repository interface, mock, and paginated HTTP implementation.
- `lib/features/inventory/inventory_controller.dart`: loading, pagination, and local search state.
- `lib/features/inventory/inventory_screen.dart`: approved inventory list and its empty/error/loading states.
- `assets/branding/`: clean SVG source and app-ready icon exports from the approved shelf mark.
- `test/`: focused unit and widget tests mirroring the feature boundaries above.

Flutter-generated platform files and `pubspec.yaml` are created in Task 1. Add additional files only when an implementation or test needs them; keep responsibilities aligned with this map.

## Task 1: Scaffold the app shell and approved visual system

**Files:**
- Create: Flutter-generated project files for `ios/`, `android/`, `pubspec.yaml`, `analysis_options.yaml`, and `test/`
- Create: `lib/main.dart`
- Create: `lib/app/app.dart`
- Create: `lib/app/app_controller.dart`
- Create: `lib/core/config/app_config.dart`
- Create: `assets/branding/sparesflow-logo.svg` and icon-only exports
- Test: `test/app/app_test.dart`

**Interfaces:**
- Produces `AppConfig.fromEnvironment({required bool isRelease, Map<String, String>? environment})` with `bool useMockApi` and nullable `Uri apiBaseUrl`.
- Produces a theme with navy `#15263B`, amber `#E9A23B`, slate `#64748B`, pale `#F5F7FA`, and white surfaces; amber primary actions use navy text.
- Produces an app shell that accepts injected auth and inventory controllers/repositories; screens are wired in later tasks.

- [ ] **Step 1: Write failing config and app-shell tests**
  - `app_config_uses_mock_when_development_url_is_absent`
  - `app_config_rejects_missing_release_url`
  - `app_config_rejects_non_https_real_url`
  - `app_theme_uses_approved_brand_colors`
- [ ] **Step 2: Run `flutter test test/app/app_test.dart` and verify the tests fail for missing implementation**
- [ ] **Step 3: Scaffold Flutter for iOS and Android; implement `AppConfig`, `MaterialApp`, theme, startup gate, and SVG asset registration**
- [ ] **Step 4: Add source SVG horizontal mark and icon-only shelf mark; export platform icon sizes from the SVG source without embedding the wordmark in raster assets**
- [ ] **Step 5: Run `flutter analyze` and `flutter test test/app/app_test.dart`; expect no analyzer issues and all tests passing**
- [ ] **Step 6: Commit as `feat: scaffold SparesFlow Flutter app shell`**

## Task 2: Implement API transport and login contract

**Files:**
- Create: `lib/core/network/api_error.dart`
- Create: `lib/core/network/api_client.dart`
- Create: `lib/features/auth/auth_repository.dart`
- Test: `test/core/network/api_client_test.dart`
- Test: `test/features/auth/auth_repository_test.dart`

**Interfaces:**
- Consumes `AppConfig` and session interfaces from Task 1 / Task 3 (use a small injected token provider until Task 3 supplies the concrete adapter).
- Produces `ApiClient.get(path, {query, authenticated})` and `.post(path, {body, headers, authenticated})`, returning decoded JSON or throwing typed `ApiError`.
- Produces `AuthRepository.login({required String email, required String password, required bool rememberMe}) -> Future<Session>` and `restore() -> Future<Session?>` interfaces; HTTP login implementation uses CSRF then native login.
- Decode `{error:{status,code,detail,request_id}}`; sanitize user-facing errors to safe `detail`.

- [ ] **Step 1: Inspect the generated OpenAPI document and backend route handlers; record exact request/response fields and status codes for CSRF, native login, and `/me` in focused test fixtures (do not commit a copied OpenAPI file)**
- [ ] **Step 2: Write failing transport/repository tests**
  - `get_csrf_token_precedes_login_and_sends_x_csrf_token`
  - `login_maps_exact_contract_fields_to_session`
  - `malformed_login_response_does_not_save_session`
  - `api_error_decodes_standard_envelope_and_request_id`
  - `http_and_invalid_json_errors_are_typed_and_safe`
- [ ] **Step 3: Run the focused tests and verify expected failures**
- [ ] **Step 4: Implement typed errors, JSON transport, CSRF flow, and response validation using the exact fields verified in Step 1**
- [ ] **Step 5: Run focused tests and `flutter analyze`; expect all tests passing**
- [ ] **Step 6: Commit as `feat: add v1 API transport and login`**

## Task 3: Add secure session lifecycle and bounded refresh

**Files:**
- Create: `lib/core/session/session.dart`
- Create: `lib/core/session/session_store.dart`
- Create: `lib/features/auth/auth_controller.dart`
- Modify: `lib/core/network/api_client.dart`
- Modify: `lib/features/auth/auth_repository.dart`
- Test: `test/core/session/session_store_test.dart`
- Test: `test/features/auth/auth_repository_test.dart`
- Test: `test/core/network/api_client_test.dart`

**Interfaces:**
- Produces immutable `Session({required String accessToken, required String refreshToken, required DateTime expiresAt, required UserSummary user})` and `SessionStore.read()`, `.write(Session)`, `.clear()`.
- Produces `AuthRepository.refresh(Session) -> Future<Session>` and `.logout(Session) -> Future<void>`.
- `AuthController` exposes startup, sign-in, sign-out, loading, error, and current-user state through `ChangeNotifier`.
- Authenticated `401` refreshes once and retries the original request once; simultaneous refreshes coalesce.

- [ ] **Step 1: Write failing secure-store and lifecycle tests**
  - `secure_store_round_trips_one_session_value_and_clears_it`
  - `restore_validates_saved_session_with_me`
  - `refresh_reuses_request_id_for_identical_ambiguous_retry`
  - `concurrent_401_responses_share_one_refresh`
  - `retried_request_is_not_refreshed_twice`
  - `transient_refresh_failure_retains_session`
  - `rejected_refresh_clears_session`
  - `logout_clears_only_after_server_confirmation`
- [ ] **Step 2: Run focused tests and verify expected failures**
- [ ] **Step 3: Implement Keychain/Keystore-backed storage and atomic session serialization; use a fake secure-storage adapter in unit tests**
- [ ] **Step 4: Implement startup validation, refresh rotation, stable request ID on an identical ambiguous retry, refresh coalescing, logout, and auth state transitions**
- [ ] **Step 5: Run session and transport tests plus `flutter analyze`; expect all tests passing**
- [ ] **Step 6: Commit as `feat: add secure auth session lifecycle`**

## Task 4: Build sign-in and session navigation UI

**Files:**
- Create: `lib/features/auth/login_screen.dart`
- Modify: `lib/app/app.dart`
- Modify: `lib/app/app_controller.dart`
- Test: `test/features/auth/login_screen_test.dart`
- Test: `test/app/app_test.dart`

**Interfaces:**
- Consumes `AuthController` from Task 3.
- Login fields are email, password, and the existing remember-me option; validation and error feedback do not reveal server internals.
- Successful login enters inventory; restore enters inventory when valid and sign-in when no session remains.

- [ ] **Step 1: Write widget tests**
  - `login_requires_valid_email_and_nonempty_password`
  - `login_shows_safe_retryable_error`
  - `login_success_navigates_to_inventory`
  - `restored_session_skips_sign_in_screen`
- [ ] **Step 2: Run tests to verify expected failures**
- [ ] **Step 3: Implement the approved sign-in screen and startup/session gate using existing workflow and visual design**
- [ ] **Step 4: Run widget tests and `flutter analyze`; expect all passing**
- [ ] **Step 5: Commit as `feat: add SparesFlow sign-in screen`**

## Task 5: Implement inventory DTO, pagination, and mock data

**Files:**
- Create: `lib/features/inventory/inventory_item.dart`
- Create: `lib/features/inventory/inventory_repository.dart`
- Test: `test/features/inventory/inventory_repository_test.dart`

**Interfaces:**
- Produces `InventoryItem` with validated API fields: `id`, part/store IDs, part number, description, store name/type/owner, quantity, minimum threshold, allocation state, optional work order.
- Produces `InventoryRepository.fetchAll() -> Future<List<InventoryItem>>`; the HTTP implementation requests `GET /api/v1/inventory?limit=50&cursor=...` until `next_cursor` is null.
- Mock implementation returns deterministic tenant-neutral sample data and supports preview/tests without API credentials.

- [ ] **Step 1: Write failing repository tests**
  - `fetches_first_page_with_limit_50`
  - `encodes_cursor_as_query_parameter_and_accumulates_pages`
  - `stops_when_next_cursor_is_null`
  - `repeated_cursor_fails_without_looping`
  - `malformed_page_is_reported_as_recoverable_error`
  - `mock_data_is_deterministic`
- [ ] **Step 2: Run repository tests and verify expected failures**
- [ ] **Step 3: Implement DTO validation, paginated HTTP repository, repeated-cursor guard, and deterministic mock repository**
- [ ] **Step 4: Run repository tests and `flutter analyze`; expect all passing**
- [ ] **Step 5: Commit as `feat: add paginated inventory repositories`**

## Task 6: Add inventory state and browse/search screen

**Files:**
- Create: `lib/features/inventory/inventory_controller.dart`
- Create: `lib/features/inventory/inventory_screen.dart`
- Modify: `lib/app/app.dart`
- Test: `test/features/inventory/inventory_controller_test.dart`
- Test: `test/features/inventory/inventory_screen_test.dart`

**Interfaces:**
- Consumes `InventoryRepository` from Task 5.
- Controller exposes items, query, loading, loading-more, empty, and recoverable error states; search filters the complete fetched collection locally.
- Screen presents inventory list, part search, status label, pagination/loading feedback, empty state, and retryable errors; no inventory mutation controls.

- [ ] **Step 1: Write failing controller/widget tests**
  - `search_matches_part_number_and_description_across_all_pages`
  - `screen_shows_loading_empty_and_retryable_error_states`
  - `screen_shows_status_text_without_color_only_encoding`
  - `screen_contains_no_stock_mutation_actions`
- [ ] **Step 2: Run tests and verify expected failures**
- [ ] **Step 3: Implement controller and approved inventory screen with responsive layouts, accessible labels, text scaling, and status semantics**
- [ ] **Step 4: Run inventory tests, all widget tests, and `flutter analyze`; expect all passing**
- [ ] **Step 5: Commit as `feat: add searchable inventory screen`**

## Task 7: Wire build modes and verify release safety

**Files:**
- Modify: `lib/main.dart`
- Modify: `lib/core/config/app_config.dart`
- Modify: `pubspec.yaml`
- Create: `README.md`
- Create: `docs/testing/mobile-smoke-test.md`
- Test: `test/core/config/app_config_test.dart`
- Test: `test/app/app_test.dart`

**Interfaces:**
- Development and test builds without `API_BASE_URL` select deterministic mocks.
- Real API builds require explicit HTTPS `API_BASE_URL`; release cannot silently use mock mode.
- Document commands for analyze/tests and configuration for SaaS/PostgreSQL integration without storing credentials.

- [ ] **Step 1: Write failing configuration tests**
  - `release_without_api_url_fails_before_startup`
  - `release_with_http_url_fails_before_startup`
  - `release_with_https_url_selects_real_api`
- [ ] **Step 2: Run configuration tests and verify expected failures**
- [ ] **Step 3: Wire dependency construction for mock and real modes and document local run/test commands**
- [ ] **Step 4: Write a manual iOS/Android SaaS smoke checklist covering sign-in, restore, search, pagination, logout, text scaling, and unavailable-service recovery**
- [ ] **Step 5: Run `flutter analyze`, `flutter test`, and release configuration tests; expect no analyzer issues and all tests passing**
- [ ] **Step 6: Commit as `test: verify mobile release configuration and smoke flow`**

## Self-Review

- **Spec coverage:** Tasks 1–7 cover platform scaffold, brand assets/theme/accessibility, mock-first and explicit real modes, all six routes, secure session behavior, read-only inventory pagination/search, recoverable states, tests, and SaaS smoke checks.
- **Step scan:** Each task has a test-first sequence, a bounded implementation surface, explicit verification, and a commit. Task 2 requires checking the running generated contract/backend handlers before pinning payload fixtures, because those fields must not be guessed.
- **Type consistency:** Session and repository interfaces are named in Tasks 2–6; auth and inventory controllers consume those interfaces; app assembly is completed in Task 7.
- **Review focus:** The five highest-risk input cases are listed above and tied to named tests in their owning tasks.
- **Proportion:** The plan defines interfaces, files, and tests without prescribing implementation bodies beyond contract-required behavior.
