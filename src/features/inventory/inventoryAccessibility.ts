import type {InventoryItem} from './inventoryRepository';

export function inventoryRowAccessibilityLabel(item: InventoryItem): string {
  const stockStatus = item.quantity === 0
    ? 'out of stock'
    : item.quantity <= item.minThreshold
      ? 'low stock'
      : 'in stock';
  const allocation = item.isAllocated
    ? ` Allocated${item.workOrder ? ` to work order ${item.workOrder}.` : '.'}`
    : '';

  return `View ${item.partNumber}, ${item.description}. ${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'}, ${stockStatus}, at ${item.storeName}.${allocation} Minimum stock ${item.minThreshold}.`;
}
