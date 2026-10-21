import type {InventoryItem} from './inventoryRepository';

let snapshot: InventoryItem[] | null = null;

export function setInventorySnapshot(items: InventoryItem[]): void {
  snapshot = items.map(item => ({...item}));
}

export function getCachedInventoryItem(id: number): InventoryItem | null | undefined {
  if (snapshot === null) return undefined;
  return snapshot.find(item => item.id === id) ?? null;
}

export function clearInventorySnapshot(): void {
  snapshot = null;
}
