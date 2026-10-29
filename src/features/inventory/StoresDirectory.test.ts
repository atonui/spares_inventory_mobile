import {summarizeStores} from './StoresDirectory';
import type {InventoryItem} from './inventoryRepository';

const row: InventoryItem = {id: 1, partId: 1, storeId: 1, partNumber: 'A', description: 'Part', storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4, minThreshold: 2, isAllocated: false, workOrder: null};

it('groups by store ID even when names match and counts exclusive stock alerts', () => {
  expect(summarizeStores([
    row,
    {...row, id: 2, quantity: 0},
    {...row, id: 3, quantity: 2},
    {...row, id: 4, storeId: 2, quantity: 7},
  ])).toEqual([
    {id: 1, name: 'Main', type: 'warehouse', items: 3, low: 1, out: 1},
    {id: 2, name: 'Main', type: 'warehouse', items: 1, low: 0, out: 0},
  ]);
});

it('returns no stores when no authorized inventory exists', () => {
  expect(summarizeStores([])).toEqual([]);
});
