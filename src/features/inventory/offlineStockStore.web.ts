import type {InventoryItem} from './inventoryRepository';
import type {NativeUser} from '../../api/client';
import type {QueuedStockAdjustment} from './offlineStockQueue';
import type {OfflineStockStorage} from './offlineStockStore';

const webStorageKey = 'spares-tracker.stock-adjustments.v1';
const queueListeners = new Set<() => void>();

function notifyQueueChanged() {
  for (const listener of queueListeners) listener();
}

function isQueuedAdjustment(value: unknown): value is QueuedStockAdjustment {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.operationId === 'string' && typeof item.userId === 'number' &&
    typeof item.inventoryId === 'number' && typeof item.expectedQuantity === 'number' &&
    typeof item.newQuantity === 'number' && typeof item.createdAt === 'number' &&
    (item.status === 'queued' || item.status === 'conflict') &&
    (item.error === null || typeof item.error === 'string');
}

function getWebEntries(): QueuedStockAdjustment[] {
  try {
    const raw = globalThis.localStorage?.getItem(webStorageKey);
    if (!raw) return [];
    const entries: unknown = JSON.parse(raw);
    return Array.isArray(entries) ? entries.filter(isQueuedAdjustment) : [];
  } catch {
    return [];
  }
}

function saveWebEntries(entries: QueuedStockAdjustment[]) {
  globalThis.localStorage?.setItem(webStorageKey, JSON.stringify(entries));
}

export const offlineStockStore: OfflineStockStorage = {
  subscribeQueueChanges(listener) {
    queueListeners.add(listener);
    return () => queueListeners.delete(listener);
  },
  async saveInventorySnapshot(userId: number, items: InventoryItem[]) {
    globalThis.localStorage?.setItem(`spares-tracker.inventory.v1.${userId}`, JSON.stringify(items));
    globalThis.localStorage?.setItem(`spares-tracker.inventory-saved-at.v1.${userId}`, String(Date.now()));
  },
  async loadInventorySnapshot(userId: number): Promise<InventoryItem[] | null> {
    try {
      const raw = globalThis.localStorage?.getItem(`spares-tracker.inventory.v1.${userId}`);
      const items: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(items) ? items as InventoryItem[] : null;
    } catch {
      return null;
    }
  },
  async getInventorySnapshotSavedAt(userId: number): Promise<number | null> {
    const value = globalThis.localStorage?.getItem(`spares-tracker.inventory-saved-at.v1.${userId}`);
    return value && /^\d+$/.test(value) ? Number(value) : null;
  },
  async saveProfile(profile: NativeUser) {
    globalThis.localStorage?.setItem(`spares-tracker.profile.v1.${profile.id}`, JSON.stringify(profile));
    globalThis.localStorage?.setItem('spares-tracker.active-user.v1', String(profile.id));
  },
  async loadProfile(userId: number): Promise<NativeUser | null> {
    try {
      const raw = globalThis.localStorage?.getItem(`spares-tracker.profile.v1.${userId}`);
      return raw ? JSON.parse(raw) as NativeUser : null;
    } catch {
      return null;
    }
  },
  async getActiveUserId() {
    const value = globalThis.localStorage?.getItem('spares-tracker.active-user.v1');
    return value && /^\d+$/.test(value) ? Number(value) : null;
  },
  async setActiveUserId(userId) {
    if (userId === null) globalThis.localStorage?.removeItem('spares-tracker.active-user.v1');
    else globalThis.localStorage?.setItem('spares-tracker.active-user.v1', String(userId));
  },
  async enqueue(adjustment) {
    const entries = getWebEntries();
    entries.push(adjustment);
    saveWebEntries(entries);
    notifyQueueChanged();
  },
  async list(userId) {
    return getWebEntries().filter(item => item.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  async remove(operationId) {
    saveWebEntries(getWebEntries().filter(item => item.operationId !== operationId));
    notifyQueueChanged();
  },
  async markConflict(operationId, message) {
    saveWebEntries(getWebEntries().map(item => item.operationId === operationId
      ? {...item, status: 'conflict', error: message} : item));
    notifyQueueChanged();
  },
};
