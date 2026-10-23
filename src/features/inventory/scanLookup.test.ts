import {extractScannedPartNumber, findInventoryMatches} from './scanLookup';
import type {InventoryItem} from './inventoryRepository';

const item = (id: number, partNumber: string, storeName: string): InventoryItem => ({
  id,
  partId: id,
  storeId: id,
  partNumber,
  description: 'Scanned part',
  storeName,
  storeType: 'central',
  storeOwner: null,
  quantity: 3,
  minThreshold: 1,
  isAllocated: false,
  workOrder: null,
});

describe('inventory scan lookup', () => {
  it('extracts a trimmed raw part number or a supported URL parameter', () => {
    expect(extractScannedPartNumber('  PN-0042\n')).toBe('PN-0042');
    expect(extractScannedPartNumber('https://stock.example/item?part_number=PN-0042')).toBe('PN-0042');
    expect(extractScannedPartNumber('https://stock.example/item?sku=PN-0042')).toBe('PN-0042');
    expect(extractScannedPartNumber('https://stock.example/item?other=PN-0042')).toBeNull();
  });

  it('matches exact part numbers case-insensitively and returns rows from every store', () => {
    const rows = [item(1, 'PN-0042', 'Central'), item(2, 'pn-0042', 'Engineer'), item(3, 'PN-00420', 'Warehouse')];
    expect(findInventoryMatches(rows, ' pn-0042 ')).toEqual(rows.slice(0, 2));
    expect(findInventoryMatches(rows, 'https://stock.example/?code=PN-0042').map(row => row.id)).toEqual([1, 2]);
  });

  it('returns no match for invalid QR payloads and empty scans', () => {
    expect(findInventoryMatches([item(1, 'PN-0042', 'Central')], 'https://stock.example/item')).toEqual([]);
    expect(findInventoryMatches([item(1, 'PN-0042', 'Central')], ' ')).toEqual([]);
  });
});
