# Mobile Roles and Stock Scanning

**Status:** Phase 1 implementation

## Goal

Make tenant role behavior explicit in the mobile client and let a signed-in user scan a supported QR/barcode to find matching inventory. Preserve backend authorization as the authority for every read and mutation.

## Server-derived behavior

Company roles are `owner`, `admin`, `manager`, and `engineer`. A user may also be a platform administrator; that does not grant company membership or tenant inventory access by itself.

| Capability | Owner | Admin | Manager | Engineer | Platform admin without company membership |
|---|---:|---:|---:|---:|---:|
| Read tenant inventory | Yes | Yes | Yes | Yes | No |
| Adjust stock in any store | Yes | Yes | No | No | No |
| Adjust stock in central or personally assigned stores | Yes | Yes | Yes | Yes | No |
| Manage company users/invitations | Yes | Yes | No | No | No |
| Invite or assign an admin | Yes | No | No | No | No |
| Platform controls | No | No | No | No | Yes, platform-only web surface |

Stock adjustment capability is item-specific: manager and engineer access depends on the inventory row's store being central or assigned to that user. The app may use this rule to avoid presenting an unavailable control, but the API remains authoritative. Allocated stock remains non-adjustable through the mobile count flow.

## Scanner behavior

- Use the existing Expo Camera dependency after an explicit camera permission grant.
- Support QR and common retail/industrial barcode formats Expo Camera exposes.
- Decode a raw part number, or a URL containing `part_number`, `partNumber`, `sku`, or `code`.
- Match decoded values case-insensitively against the locally loaded inventory part numbers.
- If multiple inventory rows share the part number, show all rows and let the user select the correct store.
- Show a clear no-match state and the scanned value; scanning never performs a stock mutation.
- Keep desktop pairing QR behavior separate from the signed-in inventory scanner.
- Work with the latest in-memory inventory snapshot, including optimistic offline counts. If the snapshot is unavailable, provide a retry path to return to Inventory.

## Contract limits and follow-on work

The generated v1 contract currently includes tenant `/me`, paginated inventory, and stock adjustments, but no barcode field or endpoints for parts, stores, transfers, equipment, work orders, reports, or tenant administration. Scanning therefore resolves to part number only until the backend adds a versioned barcode identifier and lookup contract. Full web capability parity needs further versioned API work; the platform-admin surface and sensitive platform controls remain web-only.

## Accessibility and safety

- Camera permission is requested only after the user opens Scan.
- Scanner controls have accessible labels and actionable permission-denied copy.
- A result must be selected before details open when more than one row matches.
- Role checks only shape the UI; they never replace API authorization.
