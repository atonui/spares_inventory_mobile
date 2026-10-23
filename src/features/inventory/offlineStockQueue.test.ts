import {
  applyQueuedStockCounts,
  enqueueStockCount,
  syncQueuedStock,
  type QueuedStockAdjustment,
  type StockQueueStore,
} from './offlineStockQueue';
import type {InventoryItem} from './inventoryRepository';

class MemoryQueue implements StockQueueStore {
  entries: QueuedStockAdjustment[] = [];
  async enqueue(item: QueuedStockAdjustment) { this.entries.push(item); }
  async list(userId: number) { return this.entries.filter(item => item.userId === userId); }
  async remove(id: string) { this.entries = this.entries.filter(item => item.operationId !== id); }
  async markConflict(id: string, error: string) {
    this.entries = this.entries.map(item => item.operationId === id ? {...item, status: 'conflict', error} : item);
  }
}

const inventoryItem: InventoryItem = {
  id: 11, partId: 4, storeId: 2, partNumber: 'P-11', description: 'Spare',
  storeName: 'Main', storeType: 'warehouse', storeOwner: null, quantity: 4,
  minThreshold: 1, isAllocated: false, workOrder: null,
};

describe('offline stock queue', () => {
  it('projects queued stock counts over server inventory without changing the server DTO', async () => {
    const store = new MemoryQueue();
    await enqueueStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    const result = applyQueuedStockCounts([inventoryItem], await store.list(7));
    expect(result[0]?.quantity).toBe(9);
    expect(inventoryItem.quantity).toBe(4);
  });

  it('removes an operation only after the idempotent API accepts it', async () => {
    const store = new MemoryQueue();
    const operation = await enqueueStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    const result = await syncQueuedStock(store, 7, async sent => {
      expect(sent.operationId).toBe(operation.operationId);
    });
    expect(result).toEqual({synced: 1, blocked: false});
    expect(await store.list(7)).toEqual([]);
  });

  it('retains offline operations and marks stale counts for review', async () => {
    const store = new MemoryQueue();
    const operation = await enqueueStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    const result = await syncQueuedStock(store, 7, async () => { throw new TypeError('offline'); });
    expect(result).toEqual({synced: 0, blocked: true});
    expect((await store.list(7))[0]?.status).toBe('queued');

    await syncQueuedStock(store, 7, async () => { throw Object.assign(new Error('Stock changed'), {status: 409}); });
    expect((await store.list(7))[0]).toMatchObject({operationId: operation.operationId, status: 'conflict'});
  });

  it('validates quantity changes before persisting them', async () => {
    const store = new MemoryQueue();
    await expect(enqueueStockCount(store, {
      userId: 7, inventoryId: 11, expectedQuantity: -1, newQuantity: 9,
    })).rejects.toThrow('Enter a valid stock quantity.');
    expect(store.entries).toHaveLength(0);
  });
});
