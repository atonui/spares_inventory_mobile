import type {InventoryItem} from './inventoryRepository';
import {inventoryRowAccessibilityLabel} from './inventoryAccessibility';

const item: InventoryItem = {
  id: 1, partId: 1, storeId: 1, partNumber: 'PART-1', description: 'Air filter',
  storeName: 'Main warehouse', storeType: 'warehouse', storeOwner: null,
  quantity: 5, minThreshold: 2, isAllocated: false, workOrder: null,
};

describe('inventoryRowAccessibilityLabel', () => {
  it('includes the item, count, healthy stock state, store, and threshold', () => {
    expect(inventoryRowAccessibilityLabel(item)).toBe(
      'View PART-1, Air filter. 5 units, in stock, at Main warehouse. Minimum stock 2.',
    );
  });

  it('announces singular units and low stock', () => {
    expect(inventoryRowAccessibilityLabel({...item, quantity: 1})).toContain('1 unit, low stock');
  });

  it('announces out of stock and allocation work order', () => {
    expect(inventoryRowAccessibilityLabel({...item, quantity: 0, isAllocated: true, workOrder: 'WO-42'})).toBe(
      'View PART-1, Air filter. 0 units, out of stock, at Main warehouse. Allocated to work order WO-42. Minimum stock 2.',
    );
  });
});
