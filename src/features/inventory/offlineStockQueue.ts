import type {InventoryItem} from './inventoryRepository';

export type QueuedStockAdjustment = {
  operationId: string;
  userId: number;
  inventoryId: number;
  expectedQuantity: number;
  newQuantity: number;
  createdAt: number;
  status: 'queued' | 'conflict';
  error: string | null;
};

export type StockQueueStore = {
  enqueue(adjustment: QueuedStockAdjustment): Promise<void>;
  list(userId: number): Promise<QueuedStockAdjustment[]>;
  remove(operationId: string): Promise<void>;
  markConflict(operationId: string, message: string): Promise<void>;
};

export function createOperationId(now = Date.now(), random = Math.random): string {
  const seed = `${now.toString(16)}${Math.floor(random() * 0xffffffff).toString(16)}`;
  let cursor = 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const value = parseInt(seed[cursor++ % seed.length]!, 16) % 16;
    return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export async function enqueueStockCount(
  store: StockQueueStore,
  input: Omit<QueuedStockAdjustment, 'operationId' | 'createdAt' | 'status' | 'error'>,
  now = Date.now(),
): Promise<QueuedStockAdjustment> {
  if (!Number.isInteger(input.userId) || input.userId < 1 ||
      !Number.isInteger(input.inventoryId) || input.inventoryId < 1 ||
      !Number.isInteger(input.expectedQuantity) || input.expectedQuantity < 0 ||
      !Number.isInteger(input.newQuantity) || input.newQuantity < 0 ||
      input.expectedQuantity === input.newQuantity) {
    throw new Error('Enter a valid stock quantity.');
  }
  const adjustment: QueuedStockAdjustment = {
    ...input,
    operationId: createOperationId(now),
    createdAt: now,
    status: 'queued',
    error: null,
  };
  await store.enqueue(adjustment);
  return adjustment;
}

export async function syncQueuedStock(
  store: StockQueueStore,
  userId: number,
  send: (adjustment: QueuedStockAdjustment) => Promise<void>,
): Promise<{synced: number; blocked: boolean}> {
  const queue = await store.list(userId);
  let synced = 0;
  const conflictedInventory = new Set<number>();
  for (const adjustment of queue) {
    if (adjustment.status === 'conflict') {
      conflictedInventory.add(adjustment.inventoryId);
      continue;
    }
    if (conflictedInventory.has(adjustment.inventoryId)) {
      await store.markConflict(adjustment.operationId, 'An earlier stock count needs review.');
      continue;
    }
    try {
      await send(adjustment);
      await store.remove(adjustment.operationId);
      synced += 1;
    } catch (reason) {
      const status = typeof reason === 'object' && reason !== null && 'status' in reason
        ? (reason as {status?: unknown}).status : undefined;
      if (status === 409) {
        const message = reason instanceof Error ? reason.message : 'Stock changed. Review the current count.';
        await store.markConflict(adjustment.operationId, message);
        conflictedInventory.add(adjustment.inventoryId);
        continue;
      }
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 401 && status !== 429) {
        const message = reason instanceof Error ? reason.message : 'This stock change needs review.';
        await store.markConflict(adjustment.operationId, message);
        conflictedInventory.add(adjustment.inventoryId);
        continue;
      }
      return {synced, blocked: true};
    }
  }
  return {synced, blocked: false};
}

export function applyQueuedStockCounts(
  items: InventoryItem[],
  queue: QueuedStockAdjustment[],
): InventoryItem[] {
  const quantities = new Map<number, number>();
  for (const operation of queue) {
    if (operation.status === 'queued') quantities.set(operation.inventoryId, operation.newQuantity);
  }
  return items.map(item => quantities.has(item.id)
    ? {...item, quantity: quantities.get(item.id)!}
    : {...item});
}
