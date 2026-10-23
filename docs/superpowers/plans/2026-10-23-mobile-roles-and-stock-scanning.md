# Mobile Roles and Stock Scanning Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make stock adjustment controls reflect server-defined company role/store access and add QR/barcode lookup into the locally loaded inventory.

**Architecture:** Add pure capability and scan-decoding helpers, then use them in the existing stock-detail and new Expo Router scanner screens. Camera scanning selects an inventory row and navigates to its existing details route; it does not mutate data.

**Tech Stack:** Expo SDK 58, React Native, TypeScript, Expo Camera, Expo Router, Jest, React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-23-mobile-roles-and-stock-scanning.md`

## Global Constraints

- Server authorization is authoritative; client capability checks are display hints only.
- Never infer tenant access from platform-admin status.
- Keep desktop pairing QR separate from inventory scanning.
- Scan results resolve to part number because the current v1 inventory contract has no barcode field.
- Preserve the existing stock adjustment and offline queue workflows.

## Review Focus

- An unknown role or platform-only account never receives company-admin or stock-adjustment capabilities.
- Managers and engineers can adjust only central or personally assigned stores in the UI.
- A scan result never mutates stock and handles multiple matching store rows.
- URLs without a supported part-number query parameter do not accidentally resolve to unrelated inventory.
- Camera permission denial and empty inventory produce recoverable states.

---

### Task 1: Role and scanner resolution helpers

**Files:**
- Create: `src/features/auth/roleCapabilities.ts`
- Test: `src/features/auth/roleCapabilities.test.ts`
- Create: `src/features/inventory/scanLookup.ts`
- Test: `src/features/inventory/scanLookup.test.ts`

**Interfaces:**
- `canManageCompany(role: string): boolean`
- `canInviteAdmin(role: string): boolean`
- `canAdjustStock(user: Pick<NativeUser, 'id' | 'role'>, item: Pick<InventoryItem, 'storeType' | 'storeOwner' | 'isAllocated'>): boolean`
- `extractScannedPartNumber(rawValue: string): string | null`
- `findInventoryMatches(items: readonly InventoryItem[], scannedValue: string): InventoryItem[]`

- [x] Write tests for the role matrix, per-store adjustment visibility, allocated rows, URL/raw-code decoding, case-insensitive exact matching, and duplicate part rows.
- [x] Run the focused tests and verify they fail because the helpers do not exist.
- [x] Implement the smallest pure helpers that satisfy the tests.
- [x] Re-run focused tests and typecheck.

### Task 2: Gate stock controls using server-aligned capability hints

**Files:**
- Modify: `src/app/inventory/[itemId].tsx`
- Modify: `src/features/inventory/InventoryItemDetails.tsx`
- Modify: `src/features/inventory/StockAdjustmentControls.tsx`
- Test: `tests/inventory-item-detail.test.tsx`

**Interfaces:**
- Consumes Task 1 `canAdjustStock`.
- The details screen loads the cached profile scoped to the route's user ID before offering stock controls.

- [x] Add a failing render test that manager/engineer cannot see adjustment controls for another user's non-central store.
- [x] Add a failing render test that owner/admin can see controls for another user's store, while allocated rows remain non-adjustable.
- [x] Run the focused tests and verify the expected failures.
- [x] Implement profile loading and capability-based control visibility without changing queue semantics.
- [x] Run detail tests and typecheck.

### Task 3: Inventory QR/barcode scanner route

**Files:**
- Create: `src/app/scan.tsx`
- Modify: `src/features/inventory/inventorySnapshot.ts`
- Modify: `src/app/index.tsx`
- Test: `tests/inventory-scan.test.tsx`

**Interfaces:**
- Consumes Task 1 `findInventoryMatches`.
- Scanner reads the existing inventory snapshot and navigates to `/inventory/[itemId]` only after a user selects a matched row.

- [x] Add failing tests for scanner permission, no-match feedback, multiple match selection, and selection navigation.
- [x] Run the focused tests and confirm failures.
- [x] Add a Scan entry point, snapshot accessor, and camera route using Expo Camera with an explicit supported barcode list.
- [x] Run scanner tests, full Jest suite, lint, and typecheck.

### Task 4: Document contract gaps and verify delivery

**Files:**
- Modify: `README.md`
- Check: generated mobile API contract guard and Expo native bundle export.

- [x] Document current role-aware stock behavior and the fact that full desktop feature parity awaits versioned endpoints for the remaining workflows.
- [x] Run `npm test`, `npm run test:api`, `npm run typecheck`, and `npm run lint`.
- [x] Run native bundle export for Android and iOS.
- [ ] Re-run `npm run check:mobile-api-contract` after `SAAS_API_BASE_URL` is available for a SaaS/PostgreSQL environment. Current attempt stopped safely with the documented missing-URL message.
- [x] Review the complete diff and open PR #36 on `feat/mobile-role-aware-scanning`.
