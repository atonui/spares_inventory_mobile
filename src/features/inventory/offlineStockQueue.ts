import type {InventoryItem} from './inventoryRepository';

export type QueuedStockAdjustment = {
  operationId: string;
  userId: number;
  inventoryId: number;
  expectedQuantity: number;
  newQuantity: number;
  createdAt: number;
  /**
   * queued: never sent, so later edits may be merged into it.
   * sending: sent at least once with an unknown outcome. The server replays an
   *   operation ID without comparing quantities, so this entry is frozen and a
   *   later edit becomes a new operation.
   * conflict: rejected by the server and waiting for review.
   */
  status: 'queued' | 'sending' | 'conflict';
  error: string | null;
};

export function isAwaitingSync(adjustment: Pick<QueuedStockAdjustment, 'status'>): boolean {
  return adjustment.status === 'queued' || adjustment.status === 'sending';
}

export type StockQueueStore = {
  enqueue(adjustment: QueuedStockAdjustment): Promise<void>;
  replaceQueued(adjustment: QueuedStockAdjustment): Promise<void>;
  list(userId: number): Promise<QueuedStockAdjustment[]>;
  remove(operationId: string): Promise<void>;
  markConflict(operationId: string, message: string): Promise<void>;
  markSending(operationId: string): Promise<void>;
};

export function createOperationId(now = Date.now(), random = Math.random): string {
  const seed = `${now.toString(16)}${Math.floor(random() * 0xffffffff).toString(16)}`;
  let cursor = 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const value = parseInt(seed[cursor++ % seed.length]!, 16) % 16;
    return (token === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function validateCount(input: Pick<QueuedStockAdjustment, 'userId' | 'inventoryId' | 'expectedQuantity' | 'newQuantity'>) {
  if (!Number.isInteger(input.userId) || input.userId < 1 ||
      !Number.isInteger(input.inventoryId) || input.inventoryId < 1 ||
      !Number.isInteger(input.expectedQuantity) || input.expectedQuantity < 0 ||
      !Number.isInteger(input.newQuantity) || input.newQuantity < 0 ||
      input.expectedQuantity === input.newQuantity) {
    throw new Error('Enter a valid stock quantity.');
  }
}

export async function enqueueStockCount(
  store: StockQueueStore,
  input: Omit<QueuedStockAdjustment, 'operationId' | 'createdAt' | 'status' | 'error'>,
  now = Date.now(),
): Promise<QueuedStockAdjustment> {
  validateCount(input);
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

export async function saveStockCount(
  store: StockQueueStore,
  input: Omit<QueuedStockAdjustment, 'operationId' | 'createdAt' | 'status' | 'error'>,
  now = Date.now(),
): Promise<QueuedStockAdjustment> {
  validateCount(input);
  const entries = await store.list(input.userId);
  const itemEntries = entries.filter(entry => entry.inventoryId === input.inventoryId);
  const existing = itemEntries.find(entry => entry.status === 'queued');
  // A count saved after an earlier one was sent builds on that sent value,
  // which is what the server will hold once the earlier operation lands.
  const sending = itemEntries.filter(entry => entry.status === 'sending').at(-1);
  const expectedQuantity = existing?.expectedQuantity ?? sending?.newQuantity ?? input.expectedQuantity;
  if (expectedQuantity === input.newQuantity && !existing) {
    throw new Error('The count matches the current quantity.');
  }
  const adjustment: QueuedStockAdjustment = {
    ...input,
    expectedQuantity,
    operationId: existing?.operationId ?? createOperationId(now),
    createdAt: existing?.createdAt ?? now,
    status: 'queued',
    error: null,
  };
  await store.replaceQueued(adjustment);
  return adjustment;
}

export type SyncResult = {synced: number; blocked: boolean};

export type SyncOptions = {
  /**
   * Called when the server answers 403. A 403 can mean the company membership
   * was revoked, or only that this store is not accessible. Resolve when the
   * session is still valid, so the change is held for review; reject (for
   * example with the 401/403 from /me) to stop syncing and keep the queue.
   */
  confirmSession?: () => Promise<unknown>;
};

const runningSyncs = new WeakMap<StockQueueStore, Map<number, Promise<SyncResult>>>();
const followUpSyncs = new WeakMap<StockQueueStore, Map<number, Promise<SyncResult>>>();

function syncMap(maps: WeakMap<StockQueueStore, Map<number, Promise<SyncResult>>>, store: StockQueueStore) {
  let map = maps.get(store);
  if (!map) {
    map = new Map();
    maps.set(store, map);
  }
  return map;
}

/**
 * Sends queued changes in order. Only one sync runs per user and store; a call
 * made while one is running waits for it and then runs one follow-up pass, so
 * changes saved meanwhile are not left behind.
 */
export function syncQueuedStock(
  store: StockQueueStore,
  userId: number,
  send: (adjustment: QueuedStockAdjustment) => Promise<void>,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const running = syncMap(runningSyncs, store);
  const followUps = syncMap(followUpSyncs, store);
  const start = () => {
    const run = runSync(store, userId, send, options).finally(() => {
      if (running.get(userId) === run) running.delete(userId);
    });
    running.set(userId, run);
    return run;
  };
  const current = running.get(userId);
  if (!current) return start();
  let followUp = followUps.get(userId);
  if (!followUp) {
    followUp = current.catch(() => undefined).then(() => {
      followUps.delete(userId);
      return running.get(userId) ?? start();
    });
    followUps.set(userId, followUp);
  }
  return followUp;
}

function errorStatus(reason: unknown): number | undefined {
  const status = typeof reason === 'object' && reason !== null && 'status' in reason
    ? (reason as {status?: unknown}).status : undefined;
  return typeof status === 'number' ? status : undefined;
}

async function runSync(
  store: StockQueueStore,
  userId: number,
  send: (adjustment: QueuedStockAdjustment) => Promise<void>,
  {confirmSession}: SyncOptions,
): Promise<SyncResult> {
  const queue = await store.list(userId);
  let synced = 0;
  const conflictedInventory = new Set<number>();
  for (const listed of queue) {
    if (listed.status === 'conflict') {
      conflictedInventory.add(listed.inventoryId);
      continue;
    }
    if (conflictedInventory.has(listed.inventoryId)) {
      await store.markConflict(listed.operationId, 'An earlier stock count needs review.');
      continue;
    }
    // Re-read the entry: an edit may have been merged into it since the list was taken.
    const adjustment = (await store.list(userId)).find(entry => entry.operationId === listed.operationId);
    if (!adjustment || adjustment.status === 'conflict') continue;
    if (adjustment.status === 'queued') await store.markSending(adjustment.operationId);
    try {
      await send(adjustment);
      await store.remove(adjustment.operationId);
      synced += 1;
    } catch (reason) {
      const status = errorStatus(reason);
      if (status === 403) {
        if (!confirmSession) return {synced, blocked: true};
        await confirmSession();
      }
      if (status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 429) {
        const fallback = status === 409 ? 'Stock changed. Review the current count.' : 'This stock change needs review.';
        await store.markConflict(adjustment.operationId, reason instanceof Error ? reason.message : fallback);
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
    if (isAwaitingSync(operation)) quantities.set(operation.inventoryId, operation.newQuantity);
  }
  return items.map(item => quantities.has(item.id)
    ? {...item, quantity: quantities.get(item.id)!}
    : {...item});
}
