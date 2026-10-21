import {clearInventorySnapshot, getCachedInventoryItem, setInventorySnapshot} from './inventorySnapshot';
import type {InventoryItem} from './inventoryRepository';

const row: InventoryItem = {
  id: 12,
  partId: 7,
  storeId: 4,
  partNumber: 'PART-12',
  description: 'Test part',
  storeName: 'Main store',
  storeType: 'warehouse',
  storeOwner: null,
  quantity: 3,
  minThreshold: 1,
  isAllocated: false,
  workOrder: null,
};

describe('inventory snapshot', () => {
  beforeEach(() => clearInventorySnapshot());

  it('distinguishes a missing snapshot from an item absent in a loaded snapshot', () => {
    expect(getCachedInventoryItem(row.id)).toBeUndefined();

    setInventorySnapshot([row]);

    expect(getCachedInventoryItem(row.id)).toEqual(row);
    expect(getCachedInventoryItem(999)).toBeNull();
  });

  it('clears the current snapshot', () => {
    setInventorySnapshot([row]);
    clearInventorySnapshot();

    expect(getCachedInventoryItem(row.id)).toBeUndefined();
  });
});
