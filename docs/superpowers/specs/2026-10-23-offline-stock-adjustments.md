# Offline Stock Adjustments

**Status:** Implemented; pending backend deploy and SaaS/PostgreSQL device validation

## User flow

- Stock details for unallocated inventory provides **Add stock** and **Edit count**.
- Add stock accepts a positive whole-number receipt. Edit count sets the new counted total, including zero.
- The user sees the updated count immediately. The adjustment is stored locally and survives app restarts.
- When connectivity returns, the app submits queued operations in creation order. The app also retries when the inventory screen or item details is opened/refreshed.
- A server-side count mismatch is retained as **Needs review**. Later changes for that same item are held. The user can refresh the current server quantity, discard outdated pending counts, then enter a new count.
- Allocated/work-order stock cannot be adjusted through this flow.

## Persistence and authorization

Expo SQLite stores inventory snapshots, a user-scoped cached profile, and queued operations on native platforms. The browser preview uses per-user local storage. A queued record contains only the user ID, inventory row ID, expected quantity, desired quantity, stable operation UUID, creation time, and queue status. It contains no auth tokens or tenant selector. Bearer session ownership and tenant scope remain server-derived.

Logout clears the active offline profile pointer; queued changes remain partitioned by user ID so another account cannot sync them. A successful `/api/v1/me` refreshes the cached profile. If the stored session exists but the service is unreachable, the app can display the cached profile and inventory. A 401 or 403 never falls back to offline access.

## API contract

`POST /api/v1/inventory/adjustments` accepts `operation_id`, `inventory_id`, `expected_quantity`, and `new_quantity`. It requires a bearer session, checks store and part access, rejects allocated stock, and returns `409` if the server quantity no longer matches the expected quantity. The adjustment and movement/audit records commit together. A unique movement operation ID makes retries after an ambiguous network response safe. Each successful retry returns success without applying the stock change again.

Both SQLite and PostgreSQL migration tracks add the operation key to movements. OpenAPI remains generated from the live backend; no generated contract JSON is checked in.

## Verification

Queue unit tests cover optimistic display, accepted sync, offline retention, conflict marking, and input validation. API tests cover adjustment, same-operation retry, stale-count conflict, bearer-only auth, validation, and generated contract inclusion. Production mobile validation must use a SaaS/PostgreSQL environment, never the production SQLite service.
