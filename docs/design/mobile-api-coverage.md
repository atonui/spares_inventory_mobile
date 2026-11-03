# Mobile API coverage

This document reflects the client and versioned API surface as of 2026-11-03. The backend's generated `/api/v1/openapi.json` remains authoritative for live route availability and schemas. The original first-scope design document is historical; this page records the expanded implementation.

## Versioned routes used by the app

| Capability | Route(s) | Current behavior |
|---|---|---|
| Sign in and pair | `GET /api/v1/csrf-token`, `POST /api/v1/auth/native/login`, `POST /api/v1/auth/native/refresh`, `POST /api/v1/auth/mobile-pairing/claim`, `POST /api/v1/auth/mobile-pairing/complete`, `GET /api/v1/me`, `POST /api/v1/auth/logout` | Session credentials are managed by the mobile API client and secure session storage. |
| Browse inventory | `GET /api/v1/inventory` | Cursor-paginated tenant inventory; client follows all pages and searches the loaded dataset locally. |
| Browse parts | `GET /api/v1/parts` | Cursor-paginated active parts directory with the fields needed by mobile workflows. |
| Browse stores and transfers | `GET /api/v1/stores`, `GET /api/v1/inventory/transfers` | Cursor-paginated store directory and pending transfers. |
| Count and adjust | `POST /api/v1/inventory/adjustments` | Supports expected-quantity conflict checks and stable operation IDs for retries; queued adjustments can be saved offline and synced later. |
| Receive, consume, and transfer stock | `POST /api/v1/inventory/add`, `POST /api/v1/inventory/consume`, `POST /api/v1/inventory/transfer`, `POST /api/v1/inventory/transfers/{transfer_id}/receive`, `POST /api/v1/inventory/transfers/{transfer_id}/return` | Online workflows; these operations are not part of the offline adjustment queue. |

The versioned contract also advertises `POST /api/v1/auth/email-change/confirm`; the mobile app does not currently call it.

## Legacy routes still called by the mobile client

| Capability | Current route(s) | Gap |
|---|---|---|
| Overview totals | `GET /api/stats`, `GET /api/equipment/statistics` | Not under `/api/v1`; should move to a documented, versioned overview contract. |
| Equipment directory | `GET /api/equipment` | Not under `/api/v1`; no versioned mobile equipment directory contract. |
| Movement history | `GET /api/movements` | Not under `/api/v1`; no versioned mobile movement-history contract. |

These calls currently rely on authenticated legacy routes and client-side response parsing. They work in the current deployment, but remain outside the generated native API contract and should be migrated before contract-only tooling can validate them.

## Search, scanning, and scale

- Inventory supports cursor pagination but the v1 route has no server-side search query. The client loads every page, then searches locally. This is correct for complete results but increases startup time and data transfer as tenant inventories grow.
- The current inventory response has no barcode/UPC field. Scan lookup decodes supported part-number values from QR payloads and matches part numbers in the loaded inventory. Barcode-only identifiers cannot resolve reliably until the backend contract exposes them.
- Search by supplier, serial number, or location is not supported unless those fields are added to the API response and made searchable.
- Large-list loading and offline snapshots are client-managed; the API does not currently provide server-side filtering or alert-specific result pages.

## Not implemented in the mobile API

Reports and company administration remain desktop workflows. There are no mobile routes for report generation/export, company settings, user/role administration, or invitations. Add these only after the backend defines versioned endpoints and permission behavior.

## Validation status and next work

The repository checker validates routes and bearer declarations in the generated OpenAPI document. It requires `SAAS_API_BASE_URL` pointing to a non-production SaaS/PostgreSQL environment and must be run after the updated backend contract is deployed to that environment. It does not send credentials or call data endpoints.

Remaining integration work:

1. Version overview, equipment, and movement-history reads, then migrate the four remaining legacy read calls above.
2. Add server-side inventory search/filter parameters and barcode identifiers to the versioned inventory contract, then update client search and scan lookup.
3. Run the live OpenAPI contract check against staging and complete an authorized iOS and Android device review for pairing, scanning, counts, offline recovery, and sign-out.
4. Define API scope and permissions before implementing reports or administration in the app.
