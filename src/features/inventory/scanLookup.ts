import type {InventoryItem} from './inventoryRepository';

const partNumberParameters = new Set(['part_number', 'partnumber', 'sku', 'code']);

export function extractScannedPartNumber(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return null;

  if (/^(?:https?:\/\/|[a-z][a-z\d+.-]*:\/\/)/i.test(value)) {
    try {
      const url = new URL(value);
      for (const [key, candidate] of url.searchParams.entries()) {
        if (partNumberParameters.has(key.toLowerCase()) && candidate.trim()) return candidate.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  return value;
}

export function findInventoryMatches(
  items: readonly InventoryItem[],
  scannedValue: string,
): InventoryItem[] {
  const partNumber = extractScannedPartNumber(scannedValue);
  if (!partNumber) return [];
  const normalized = partNumber.toLocaleUpperCase();
  return items.filter(item => item.partNumber.trim().toLocaleUpperCase() === normalized);
}
