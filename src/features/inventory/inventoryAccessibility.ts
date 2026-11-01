import type {InventoryItem} from './inventoryRepository';

export function inventoryRowAccessibilityLabel(item: InventoryItem, category?: string): string {
  const stockStatus = item.quantity === 0
    ? 'out of stock'
    : item.quantity <= item.minThreshold
      ? 'low stock'
      : 'in stock';
  const allocation = item.isAllocated
    ? ` Allocated${item.workOrder ? ` to work order ${item.workOrder}.` : '.'}`
    : '';

  const categoryLabel = category ? ` Category ${category}.` : '';
  return `View ${item.partNumber}, ${item.description}.${categoryLabel} ${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'}, ${stockStatus}, at ${item.storeName}.${allocation} Minimum stock ${item.minThreshold}.`;
}
