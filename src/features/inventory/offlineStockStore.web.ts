import type {InventoryItem} from './inventoryRepository';
import type {NativeUser} from '../../api/client';
import {parseEquipment, parsePart, parseStore, type EquipmentRecord, type PartRecord, type StoreDestination} from '../../api/transferContract';
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
  async saveStoreDirectory(userId: number, stores: StoreDestination[]) {
    globalThis.localStorage?.setItem(`spares-tracker.stores.v1.${userId}`, JSON.stringify(stores));
    globalThis.localStorage?.setItem(`spares-tracker.directory_saved_at.v1.stores.${userId}`, String(Date.now()));
  },
  async loadStoreDirectory(userId: number): Promise<StoreDestination[] | null> {
    try {
      const raw = globalThis.localStorage?.getItem(`spares-tracker.stores.v1.${userId}`);
      const stores: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(stores) ? stores.map(parseStore) : null;
    } catch { return null; }
  },
  async savePartCatalog(userId: number, parts: PartRecord[]) {
    globalThis.localStorage?.setItem(`spares-tracker.parts_catalog.v1.${userId}`, JSON.stringify(parts));
    globalThis.localStorage?.setItem(`spares-tracker.directory_saved_at.v1.parts.${userId}`, String(Date.now()));
  },
  async loadPartCatalog(userId: number): Promise<PartRecord[] | null> {
    try {
      const raw = globalThis.localStorage?.getItem(`spares-tracker.parts_catalog.v1.${userId}`);
      const parts: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(parts) ? parts.map(part => {
        if (typeof part !== 'object' || part === null || Array.isArray(part)) throw new Error('Invalid saved part');
        const row = part as Record<string, unknown>;
        return parsePart({id: row.id, part_number: row.partNumber, description: row.description, category: row.category});
      }) : null;
    } catch { return null; }
  },
  async saveEquipmentDirectory(userId: number, equipment: EquipmentRecord[]) {
    globalThis.localStorage?.setItem(`spares-tracker.equipment_directory.v1.${userId}`, JSON.stringify(equipment));
    globalThis.localStorage?.setItem(`spares-tracker.directory_saved_at.v1.equipment.${userId}`, String(Date.now()));
  },
  async loadEquipmentDirectory(userId: number): Promise<EquipmentRecord[] | null> {
    try {
      const raw = globalThis.localStorage?.getItem(`spares-tracker.equipment_directory.v1.${userId}`);
      const equipment: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(equipment) ? equipment.map(item => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('Invalid saved equipment');
        const row = item as Record<string, unknown>;
        return parseEquipment({id: row.id, equipment_name: row.name, make: row.make, model: row.model,
          serial_number: row.serialNumber, assigned_user_id: row.assignedUserId,
          assigned_user_name: row.assignedUserName, next_calibration_date: row.nextCalibrationDate, status: row.status});
      }) : null;
    } catch { return null; }
  },
  async getDirectorySavedAt(userId: number, directory: 'parts' | 'stores' | 'equipment'): Promise<number | null> {
    const value = globalThis.localStorage?.getItem(`spares-tracker.directory_saved_at.v1.${directory}.${userId}`);
    return value && /^\d+$/.test(value) ? Number(value) : null;
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
  async getScanHapticsEnabled(userId) {
    return globalThis.localStorage?.getItem(`spares-tracker.scan_haptics_enabled.${userId}`) !== 'false';
  },
  async setScanHapticsEnabled(userId, enabled) {
    globalThis.localStorage?.setItem(`spares-tracker.scan_haptics_enabled.${userId}`, String(enabled));
  },
  async getScanSoundsEnabled(userId) {
    return globalThis.localStorage?.getItem(`spares-tracker.scan_sounds_enabled.${userId}`) === 'true';
  },
  async setScanSoundsEnabled(userId, enabled) {
    globalThis.localStorage?.setItem(`spares-tracker.scan_sounds_enabled.${userId}`, String(enabled));
  },
  async enqueue(adjustment) {
    const entries = getWebEntries();
    entries.push(adjustment);
    saveWebEntries(entries);
    notifyQueueChanged();
  },
  async replaceQueued(adjustment) {
    const entries = getWebEntries();
    const existing = entries.find(item => item.userId === adjustment.userId &&
      item.inventoryId === adjustment.inventoryId && item.status === 'queued');
    const replacement = existing
      ? {...adjustment, expectedQuantity: existing.expectedQuantity, operationId: existing.operationId, createdAt: existing.createdAt}
      : adjustment;
    saveWebEntries([...entries.filter(item => !(item.userId === adjustment.userId &&
      item.inventoryId === adjustment.inventoryId && item.status === 'queued')), replacement]);
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
