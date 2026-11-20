import {
  applyQueuedStockCounts,
  enqueueStockCount,
  saveStockCount,
  syncQueuedStock,
  type QueuedStockAdjustment,
  type StockQueueStore,
} from './offlineStockQueue';
import type {InventoryItem} from './inventoryRepository';

class MemoryQueue implements StockQueueStore {
  entries: QueuedStockAdjustment[] = [];
  async enqueue(item: QueuedStockAdjustment) { this.entries.push(item); }
  async replaceQueued(item: QueuedStockAdjustment) {
    const existing = this.entries.find(entry => entry.userId === item.userId &&
      entry.inventoryId === item.inventoryId && entry.status === 'queued');
    const replacement = existing
      ? {...item, expectedQuantity: existing.expectedQuantity, operationId: existing.operationId, createdAt: existing.createdAt}
      : item;
    this.entries = [...this.entries.filter(entry => !(entry.userId === item.userId &&
      entry.inventoryId === item.inventoryId && entry.status === 'queued')), replacement];
  }
  async list(userId: number) { return this.entries.filter(item => item.userId === userId); }
  async remove(id: string) { this.entries = this.entries.filter(item => item.operationId !== id); }
  async markConflict(id: string, error: string) {
    this.entries = this.entries.map(item => item.operationId === id ? {...item, status: 'conflict', error} : item);
  }
  async markSending(id: string) {
    this.entries = this.entries.map(item => item.operationId === id && item.status === 'queued' ? {...item, status: 'sending'} : item);
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

  it('coalesces repeated edits to one item into one server adjustment', async () => {
    const store = new MemoryQueue();
    const first = await saveStockCount(store, {
      userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 8,
    }, 1000);
    const second = await saveStockCount(store, {
      userId: 7, inventoryId: 11, expectedQuantity: 8, newQuantity: 12,
    }, 2000);

    expect(await store.list(7)).toEqual([{...first, newQuantity: 12}]);
    expect(second).toMatchObject({operationId: first.operationId, expectedQuantity: 4, newQuantity: 12, createdAt: 1000});

    const sent: QueuedStockAdjustment[] = [];
    const result = await syncQueuedStock(store, 7, async operation => { sent.push(operation); });
    expect(result).toEqual({synced: 1, blocked: false});
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({expectedQuantity: 4, newQuantity: 12});
  });

  it('keeps conflicted counts separate when a new count is saved', async () => {
    const store = new MemoryQueue();
    const conflict = await enqueueStockCount(store, {
      userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 8,
    }, 1000);
    await store.markConflict(conflict.operationId, 'Needs review');

    const next = await saveStockCount(store, {
      userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 10,
    }, 2000);

    expect(await store.list(7)).toEqual([{...conflict, status: 'conflict', error: 'Needs review'}, next]);
  });

  it('retains offline operations and marks stale counts for review', async () => {
    const store = new MemoryQueue();
    const operation = await enqueueStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    const result = await syncQueuedStock(store, 7, async () => { throw new TypeError('offline'); });
    expect(result).toEqual({synced: 0, blocked: true});
    // Sent once with an unknown outcome: frozen so later edits cannot reuse its operation ID.
    expect((await store.list(7))[0]?.status).toBe('sending');

    await syncQueuedStock(store, 7, async () => { throw Object.assign(new Error('Stock changed'), {status: 409}); });
    expect((await store.list(7))[0]).toMatchObject({operationId: operation.operationId, status: 'conflict'});
  });

  it('keeps an edit saved while its earlier count is being sent', async () => {
    const store = new MemoryQueue();
    const first = await saveStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    let release!: () => void;
    const sent: QueuedStockAdjustment[] = [];
    const running = syncQueuedStock(store, 7, operation => {
      sent.push(operation);
      return new Promise<void>(resolve => { release = resolve; });
    });
    await new Promise(resolve => setImmediate(resolve));

    const second = await saveStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 9, newQuantity: 12}, 2000);
    expect(second.operationId).not.toBe(first.operationId);
    expect(second.expectedQuantity).toBe(9);
    release();
    await running;

    expect(await store.list(7)).toEqual([second]);
    expect(applyQueuedStockCounts([inventoryItem], await store.list(7))[0]?.quantity).toBe(12);
    await syncQueuedStock(store, 7, async operation => { sent.push(operation); });
    expect(sent.map(operation => [operation.operationId, operation.expectedQuantity, operation.newQuantity]))
      .toEqual([[first.operationId, 4, 9], [second.operationId, 9, 12]]);
  });

  it('does not merge a new edit into a count whose send outcome is unknown', async () => {
    const store = new MemoryQueue();
    const first = await saveStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    await syncQueuedStock(store, 7, async () => { throw new TypeError('connection lost'); });

    const second = await saveStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 6}, 2000);

    expect(second).toMatchObject({expectedQuantity: 9, newQuantity: 6, status: 'queued'});
    expect(second.operationId).not.toBe(first.operationId);
    expect(await store.list(7)).toEqual([{...first, status: 'sending'}, second]);
    expect(applyQueuedStockCounts([inventoryItem], await store.list(7))[0]?.quantity).toBe(6);
  });

  it('runs one sync at a time and picks up changes saved during the run', async () => {
    const store = new MemoryQueue();
    await saveStockCount(store, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    let release!: () => void;
    const sent: number[] = [];
    const send = (operation: QueuedStockAdjustment) => {
      sent.push(operation.inventoryId);
      return sent.length === 1 ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
    };
    const first = syncQueuedStock(store, 7, send);
    await new Promise(resolve => setImmediate(resolve));
    await saveStockCount(store, {userId: 7, inventoryId: 12, expectedQuantity: 1, newQuantity: 3}, 2000);
    const second = syncQueuedStock(store, 7, send);
    const third = syncQueuedStock(store, 7, send);
    expect(third).toBe(second);
    release();

    await expect(first).resolves.toEqual({synced: 1, blocked: false});
    await expect(second).resolves.toEqual({synced: 1, blocked: false});
    expect(sent).toEqual([11, 12]);
    expect(await store.list(7)).toEqual([]);
  });

  it('checks the session before treating a 403 as a per-item problem', async () => {
    const forbidden = () => { throw Object.assign(new Error('Permission denied for this store'), {status: 403}); };

    const blocked = new MemoryQueue();
    await saveStockCount(blocked, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    await expect(syncQueuedStock(blocked, 7, async () => forbidden())).resolves.toEqual({synced: 0, blocked: true});
    expect((await blocked.list(7))[0]?.status).toBe('sending');

    const revoked = new MemoryQueue();
    await saveStockCount(revoked, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    const membershipError = Object.assign(new Error('Active company membership required'), {status: 403});
    await expect(syncQueuedStock(revoked, 7, async () => forbidden(), {
      confirmSession: async () => { throw membershipError; },
    })).rejects.toBe(membershipError);
    expect((await revoked.list(7))[0]?.status).toBe('sending');

    const storeDenied = new MemoryQueue();
    await saveStockCount(storeDenied, {userId: 7, inventoryId: 11, expectedQuantity: 4, newQuantity: 9}, 1000);
    const confirmSession = jest.fn(async () => undefined);
    await expect(syncQueuedStock(storeDenied, 7, async () => forbidden(), {confirmSession}))
      .resolves.toEqual({synced: 0, blocked: false});
    expect(confirmSession).toHaveBeenCalledTimes(1);
    expect((await storeDenied.list(7))[0]).toMatchObject({status: 'conflict', error: 'Permission denied for this store'});
  });

  it('validates quantity changes before persisting them', async () => {
    const store = new MemoryQueue();
    await expect(enqueueStockCount(store, {
      userId: 7, inventoryId: 11, expectedQuantity: -1, newQuantity: 9,
    })).rejects.toThrow('Enter a valid stock quantity.');
    expect(store.entries).toHaveLength(0);
  });
});
