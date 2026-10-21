import {sortInventory} from './inventorySort';
import type {InventoryItem} from './inventoryRepository';

const item = (overrides: Partial<InventoryItem>): InventoryItem => ({
  id: 1,
  partId: 1,
  storeId: 1,
  partNumber: 'PART-1',
  description: 'Part',
  storeName: 'Main Store',
  storeType: 'warehouse',
  storeOwner: null,
  quantity: 5,
  minThreshold: 2,
  isAllocated: false,
  workOrder: null,
  ...overrides,
});

const rows = [
  item({id: 3, partNumber: 'B-20', quantity: 2}),
  item({id: 1, partNumber: 'A-10', quantity: 4}),
  item({id: 2, partNumber: 'A-2', quantity: 2}),
];

describe('sortInventory', () => {
  it('preserves source order for Default', () => {
    expect(sortInventory(rows, 'default').map(row => row.id)).toEqual([3, 1, 2]);
  });

  it('sorts part numbers naturally and ignores letter case', () => {
    const mixedCase = [item({id: 4, partNumber: 'a-10'}), ...rows];
    expect(sortInventory(mixedCase, 'partNumber').map(row => row.id)).toEqual([2, 4, 1, 3]);
  });

  it('sorts by quantity ascending and preserves source order for ties', () => {
    expect(sortInventory(rows, 'lowestStock').map(row => row.id)).toEqual([3, 2, 1]);
  });

  it('does not mutate the source rows', () => {
    const source = [...rows];
    const original = [...source];
    sortInventory(source, 'partNumber');
    expect(source).toEqual(original);
  });
});
