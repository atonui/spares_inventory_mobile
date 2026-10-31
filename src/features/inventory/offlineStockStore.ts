import {Platform} from 'react-native';
import * as SQLite from 'expo-sqlite';
import type {InventoryItem} from './inventoryRepository';
import type {NativeUser, OverviewStats} from '../../api/client';
import {parseEquipment, parsePart, parseStore, type EquipmentRecord, type PartRecord, type StoreDestination} from '../../api/transferContract';
import type {QueuedStockAdjustment, StockQueueStore} from './offlineStockQueue';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
const webStorageKey = 'spares-tracker.stock-adjustments.v1';
const queueListeners = new Set<() => void>();

function notifyQueueChanged() {
  for (const listener of queueListeners) listener();
}

export type OfflineStockStorage = StockQueueStore & {
  saveInventorySnapshot(userId: number, items: InventoryItem[]): Promise<void>;
  loadInventorySnapshot(userId: number): Promise<InventoryItem[] | null>;
  saveStoreDirectory(userId: number, stores: StoreDestination[]): Promise<void>;
  loadStoreDirectory(userId: number): Promise<StoreDestination[] | null>;
  savePartCatalog(userId: number, parts: PartRecord[]): Promise<void>;
  loadPartCatalog(userId: number): Promise<PartRecord[] | null>;
  saveEquipmentDirectory(userId: number, equipment: EquipmentRecord[]): Promise<void>;
  loadEquipmentDirectory(userId: number): Promise<EquipmentRecord[] | null>;
  getDirectorySavedAt(userId: number, directory: 'parts' | 'stores' | 'equipment'): Promise<number | null>;
  saveOverviewStats(userId: number, stats: OverviewStats): Promise<number>;
  loadOverviewStats(userId: number): Promise<OverviewStats | null>;
  getOverviewStatsSavedAt(userId: number): Promise<number | null>;
  getInventorySnapshotSavedAt(userId: number): Promise<number | null>;
  subscribeQueueChanges(listener: () => void): () => void;
  saveProfile(profile: NativeUser): Promise<void>;
  loadProfile(userId: number): Promise<NativeUser | null>;
  getActiveUserId(): Promise<number | null>;
  setActiveUserId(userId: number | null): Promise<void>;
  getScanHapticsEnabled(userId: number): Promise<boolean>;
  setScanHapticsEnabled(userId: number, enabled: boolean): Promise<void>;
  getScanSoundsEnabled(userId: number): Promise<boolean>;
  setScanSoundsEnabled(userId: number, enabled: boolean): Promise<void>;
};

async function database() {
  databasePromise ??= SQLite.openDatabaseAsync('sparesflow-offline.db');
  const db = await databasePromise;
  await db.execAsync(`CREATE TABLE IF NOT EXISTS stock_adjustments (
    operation_id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    inventory_id INTEGER NOT NULL,
    expected_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT
  ); CREATE INDEX IF NOT EXISTS idx_stock_adjustments_user_order ON stock_adjustments(user_id, created_at);
  CREATE TABLE IF NOT EXISTS inventory_snapshot (
    user_id INTEGER NOT NULL, inventory_id INTEGER NOT NULL, item_json TEXT NOT NULL,
    PRIMARY KEY(user_id, inventory_id)
  );
  CREATE TABLE IF NOT EXISTS inventory_snapshot_state (user_id INTEGER PRIMARY KEY NOT NULL, saved_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS offline_profile (
    user_id INTEGER PRIMARY KEY NOT NULL, profile_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS offline_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT);`);
  return db;
}

function getWebEntries(): QueuedStockAdjustment[] {
  try {
    const raw = globalThis.localStorage?.getItem(webStorageKey);
    if (!raw) return [];
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.filter(isQueuedAdjustment);
  } catch {
    return [];
  }
}

function saveWebEntries(entries: QueuedStockAdjustment[]) {
  globalThis.localStorage?.setItem(webStorageKey, JSON.stringify(entries));
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

function parseCachedDirectory<T>(raw: string | null, parse: (item: unknown) => T): T[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.map(parse) : null;
  } catch { return null; }
}

function parsePartRecord(value: unknown): PartRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid saved part');
  const part = value as Record<string, unknown>;
  return parsePart({id: part.id, part_number: part.partNumber, description: part.description, category: part.category});
}

function parseEquipmentRecord(value: unknown): EquipmentRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid saved equipment');
  const equipment = value as Record<string, unknown>;
  return parseEquipment({
    id: equipment.id, equipment_name: equipment.name, make: equipment.make, model: equipment.model,
    serial_number: equipment.serialNumber, assigned_user_id: equipment.assignedUserId,
    assigned_user_name: equipment.assignedUserName, next_calibration_date: equipment.nextCalibrationDate,
    status: equipment.status,
  });
}

function parseOverviewStats(value: unknown): OverviewStats | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const stats = value as Record<string, unknown>;
  const keys = ['totalParts', 'activeStores', 'myEquipment', 'myParts'] as const;
  if (keys.some(key => typeof stats[key] !== 'number' || !Number.isSafeInteger(stats[key]) || (stats[key] as number) < 0)) return null;
  return {totalParts: stats.totalParts as number, activeStores: stats.activeStores as number,
    myEquipment: stats.myEquipment as number, myParts: stats.myParts as number};
}

export const offlineStockStore: OfflineStockStorage = {
  subscribeQueueChanges(listener) {
    queueListeners.add(listener);
    return () => queueListeners.delete(listener);
  },
  async saveInventorySnapshot(userId: number, items: InventoryItem[]) {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.inventory.v1.${userId}`, JSON.stringify(items));
      globalThis.localStorage?.setItem(`spares-tracker.inventory-saved-at.v1.${userId}`, String(Date.now()));
      return;
    }
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM inventory_snapshot WHERE user_id=?', userId);
      await db.runAsync('INSERT OR REPLACE INTO inventory_snapshot_state(user_id,saved_at) VALUES(?,?)', userId, Date.now());
      for (const item of items) {
        await db.runAsync('INSERT INTO inventory_snapshot(user_id,inventory_id,item_json) VALUES(?,?,?)',
          userId, item.id, JSON.stringify(item));
      }
    });
  },
  async loadInventorySnapshot(userId: number): Promise<InventoryItem[] | null> {
    if (Platform.OS === 'web') {
      try {
        const raw = globalThis.localStorage?.getItem(`spares-tracker.inventory.v1.${userId}`);
        const items: unknown = raw ? JSON.parse(raw) : null;
        return Array.isArray(items) ? items as InventoryItem[] : null;
      } catch { return null; }
    }
    const db = await database();
    const rows = await db.getAllAsync<{item_json: string}>(
      'SELECT item_json FROM inventory_snapshot WHERE user_id=? ORDER BY inventory_id', userId);
    const marker = await db.getFirstAsync<{saved_at: number}>(
      'SELECT saved_at FROM inventory_snapshot_state WHERE user_id=?', userId);
    if (!marker) return null;
    try { return rows.map(row => JSON.parse(row.item_json) as InventoryItem); }
    catch { return null; }
  },
  async saveStoreDirectory(userId: number, stores: StoreDestination[]) {
    const key = `store_directory.v1.${userId}`;
    const savedAtKey = `directory_saved_at.v1.stores.${userId}`;
    const savedAt = Date.now();
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.stores.v1.${userId}`, JSON.stringify(stores));
      globalThis.localStorage?.setItem(`spares-tracker.${savedAtKey}`, String(savedAt));
      return;
    }
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', key, JSON.stringify(stores));
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', savedAtKey, String(savedAt));
    });
  },
  async loadStoreDirectory(userId: number): Promise<StoreDestination[] | null> {
    let raw: string | null;
    if (Platform.OS === 'web') {
      raw = globalThis.localStorage?.getItem(`spares-tracker.stores.v1.${userId}`) ?? null;
    } else {
      const db = await database();
      const row = await db.getFirstAsync<{value: string}>(
        'SELECT value FROM offline_metadata WHERE key=?', `store_directory.v1.${userId}`);
      raw = row?.value ?? null;
    }
    if (!raw) return null;
    try {
      const stores: unknown = JSON.parse(raw);
      if (!Array.isArray(stores)) return null;
      return stores.map(parseStore);
    } catch { return null; }
  },
  async savePartCatalog(userId: number, parts: PartRecord[]) {
    const key = `parts_catalog.v1.${userId}`;
    const savedAtKey = `directory_saved_at.v1.parts.${userId}`;
    const savedAt = Date.now();
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.${key}`, JSON.stringify(parts));
      globalThis.localStorage?.setItem(`spares-tracker.${savedAtKey}`, String(savedAt));
      return;
    }
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', key, JSON.stringify(parts));
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', savedAtKey, String(savedAt));
    });
  },
  async loadPartCatalog(userId: number): Promise<PartRecord[] | null> {
    const key = `parts_catalog.v1.${userId}`;
    let raw: string | null;
    if (Platform.OS === 'web') raw = globalThis.localStorage?.getItem(`spares-tracker.${key}`) ?? null;
    else {
      const db = await database();
      raw = (await db.getFirstAsync<{value: string}>('SELECT value FROM offline_metadata WHERE key=?', key))?.value ?? null;
    }
    return parseCachedDirectory(raw, parsePartRecord);
  },
  async saveEquipmentDirectory(userId: number, equipment: EquipmentRecord[]) {
    const key = `equipment_directory.v1.${userId}`;
    const savedAtKey = `directory_saved_at.v1.equipment.${userId}`;
    const savedAt = Date.now();
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.${key}`, JSON.stringify(equipment));
      globalThis.localStorage?.setItem(`spares-tracker.${savedAtKey}`, String(savedAt));
      return;
    }
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', key, JSON.stringify(equipment));
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', savedAtKey, String(savedAt));
    });
  },
  async loadEquipmentDirectory(userId: number): Promise<EquipmentRecord[] | null> {
    const key = `equipment_directory.v1.${userId}`;
    let raw: string | null;
    if (Platform.OS === 'web') raw = globalThis.localStorage?.getItem(`spares-tracker.${key}`) ?? null;
    else {
      const db = await database();
      raw = (await db.getFirstAsync<{value: string}>('SELECT value FROM offline_metadata WHERE key=?', key))?.value ?? null;
    }
    return parseCachedDirectory(raw, parseEquipmentRecord);
  },
  async getDirectorySavedAt(userId: number, directory: 'parts' | 'stores' | 'equipment'): Promise<number | null> {
    const key = `directory_saved_at.v1.${directory}.${userId}`;
    let value: string | null;
    if (Platform.OS === 'web') value = globalThis.localStorage?.getItem(`spares-tracker.${key}`) ?? null;
    else {
      const db = await database();
      value = (await db.getFirstAsync<{value: string}>('SELECT value FROM offline_metadata WHERE key=?', key))?.value ?? null;
    }
    return value && /^\d+$/.test(value) ? Number(value) : null;
  },
  async saveOverviewStats(userId: number, stats: OverviewStats): Promise<number> {
    const key = `overview_stats.v1.${userId}`;
    const savedAtKey = `overview_stats_saved_at.v1.${userId}`;
    const savedAt = Date.now();
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.${key}`, JSON.stringify(stats));
      globalThis.localStorage?.setItem(`spares-tracker.${savedAtKey}`, String(savedAt));
      return savedAt;
    }
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', key, JSON.stringify(stats));
      await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', savedAtKey, String(savedAt));
    });
    return savedAt;
  },
  async loadOverviewStats(userId: number): Promise<OverviewStats | null> {
    const key = `overview_stats.v1.${userId}`;
    let raw: string | null;
    if (Platform.OS === 'web') raw = globalThis.localStorage?.getItem(`spares-tracker.${key}`) ?? null;
    else {
      const db = await database();
      raw = (await db.getFirstAsync<{value: string}>('SELECT value FROM offline_metadata WHERE key=?', key))?.value ?? null;
    }
    if (!raw) return null;
    try { return parseOverviewStats(JSON.parse(raw)); }
    catch { return null; }
  },
  async getOverviewStatsSavedAt(userId: number): Promise<number | null> {
    const key = `overview_stats_saved_at.v1.${userId}`;
    let value: string | null;
    if (Platform.OS === 'web') value = globalThis.localStorage?.getItem(`spares-tracker.${key}`) ?? null;
    else {
      const db = await database();
      value = (await db.getFirstAsync<{value: string}>('SELECT value FROM offline_metadata WHERE key=?', key))?.value ?? null;
    }
    return value && /^\d+$/.test(value) ? Number(value) : null;
  },
  async getInventorySnapshotSavedAt(userId: number): Promise<number | null> {
    if (Platform.OS === 'web') {
      const value = globalThis.localStorage?.getItem(`spares-tracker.inventory-saved-at.v1.${userId}`);
      return value && /^\d+$/.test(value) ? Number(value) : null;
    }
    const db = await database();
    const row = await db.getFirstAsync<{saved_at: number}>(
      'SELECT saved_at FROM inventory_snapshot_state WHERE user_id=?', userId);
    return row?.saved_at ?? null;
  },
  async saveProfile(profile: NativeUser) {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.profile.v1.${profile.id}`, JSON.stringify(profile));
      globalThis.localStorage?.setItem('spares-tracker.active-user.v1', String(profile.id));
      return;
    }
    const db = await database();
    await db.runAsync('INSERT OR REPLACE INTO offline_profile(user_id,profile_json) VALUES(?,?)',
      profile.id, JSON.stringify(profile));
    await db.runAsync("INSERT OR REPLACE INTO offline_metadata(key,value) VALUES('active_user_id',?)", String(profile.id));
  },
  async loadProfile(userId: number): Promise<NativeUser | null> {
    if (Platform.OS === 'web') {
      try {
        const raw = globalThis.localStorage?.getItem(`spares-tracker.profile.v1.${userId}`);
        return raw ? JSON.parse(raw) as NativeUser : null;
      } catch { return null; }
    }
    const db = await database();
    const row = await db.getFirstAsync<{profile_json: string}>(
      'SELECT profile_json FROM offline_profile WHERE user_id=?', userId);
    if (!row) return null;
    try { return JSON.parse(row.profile_json) as NativeUser; } catch { return null; }
  },
  async getActiveUserId() {
    if (Platform.OS === 'web') {
      const value = globalThis.localStorage?.getItem('spares-tracker.active-user.v1');
      return value && /^\d+$/.test(value) ? Number(value) : null;
    }
    const db = await database();
    const row = await db.getFirstAsync<{value: string}>(
      "SELECT value FROM offline_metadata WHERE key='active_user_id'");
    return row && /^\d+$/.test(row.value) ? Number(row.value) : null;
  },
  async setActiveUserId(userId) {
    if (Platform.OS === 'web') {
      if (userId === null) globalThis.localStorage?.removeItem('spares-tracker.active-user.v1');
      else globalThis.localStorage?.setItem('spares-tracker.active-user.v1', String(userId));
      return;
    }
    const db = await database();
    if (userId === null) await db.runAsync("DELETE FROM offline_metadata WHERE key='active_user_id'");
    else await db.runAsync("INSERT OR REPLACE INTO offline_metadata(key,value) VALUES('active_user_id',?)", String(userId));
  },
  async getScanHapticsEnabled(userId) {
    const key = `scan_haptics_enabled.${userId}`;
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(`spares-tracker.${key}`) !== 'false';
    const db = await database();
    const row = await db.getFirstAsync<{value: string}>(
      'SELECT value FROM offline_metadata WHERE key=?', key);
    return row?.value !== 'false';
  },
  async setScanHapticsEnabled(userId, enabled) {
    const key = `scan_haptics_enabled.${userId}`;
    const value = String(enabled);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.${key}`, value);
      return;
    }
    const db = await database();
    await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', key, value);
  },
  async getScanSoundsEnabled(userId) {
    const key = `scan_sounds_enabled.${userId}`;
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(`spares-tracker.${key}`) === 'true';
    const db = await database();
    const row = await db.getFirstAsync<{value: string}>(
      'SELECT value FROM offline_metadata WHERE key=?', key);
    return row?.value === 'true';
  },
  async setScanSoundsEnabled(userId, enabled) {
    const key = `scan_sounds_enabled.${userId}`;
    const value = String(enabled);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(`spares-tracker.${key}`, value);
      return;
    }
    const db = await database();
    await db.runAsync('INSERT OR REPLACE INTO offline_metadata(key,value) VALUES(?,?)', key, value);
  },
  async enqueue(adjustment) {
    if (Platform.OS === 'web') {
      const entries = getWebEntries();
      entries.push(adjustment);
      saveWebEntries(entries);
      notifyQueueChanged();
      return;
    }
    const db = await database();
    await db.runAsync(`INSERT INTO stock_adjustments
      (operation_id,user_id,inventory_id,expected_quantity,new_quantity,created_at,status,error)
      VALUES(?,?,?,?,?,?,?,?)`, adjustment.operationId, adjustment.userId, adjustment.inventoryId,
      adjustment.expectedQuantity, adjustment.newQuantity, adjustment.createdAt, adjustment.status, adjustment.error);
    notifyQueueChanged();
  },
  async replaceQueued(adjustment) {
    if (Platform.OS === 'web') {
      const entries = getWebEntries();
      const existing = entries.find(item => item.userId === adjustment.userId &&
        item.inventoryId === adjustment.inventoryId && item.status === 'queued');
      const replacement = existing
        ? {...adjustment, expectedQuantity: existing.expectedQuantity, operationId: existing.operationId, createdAt: existing.createdAt}
        : adjustment;
      saveWebEntries([...entries.filter(item => !(item.userId === adjustment.userId &&
        item.inventoryId === adjustment.inventoryId && item.status === 'queued')), replacement]);
      notifyQueueChanged();
      return;
    }
    const db = await database();
    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<{operation_id: string; expected_quantity: number; created_at: number}>(
        "SELECT operation_id,expected_quantity,created_at FROM stock_adjustments WHERE user_id=? AND inventory_id=? AND status='queued' ORDER BY created_at,rowid LIMIT 1",
        adjustment.userId, adjustment.inventoryId);
      if (existing) {
        await db.runAsync("DELETE FROM stock_adjustments WHERE user_id=? AND inventory_id=? AND status='queued'",
          adjustment.userId, adjustment.inventoryId);
      }
      await db.runAsync('INSERT INTO stock_adjustments (operation_id,user_id,inventory_id,expected_quantity,new_quantity,created_at,status,error) VALUES(?,?,?,?,?,?,?,?)',
        existing?.operation_id ?? adjustment.operationId, adjustment.userId, adjustment.inventoryId,
        existing?.expected_quantity ?? adjustment.expectedQuantity, adjustment.newQuantity,
        existing?.created_at ?? adjustment.createdAt, 'queued', null);
    });
    notifyQueueChanged();
  },
  async list(userId) {
    if (Platform.OS === 'web') {
      return getWebEntries().filter(item => item.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
    }
    const db = await database();
    const rows = await db.getAllAsync<{
      operation_id: string; user_id: number; inventory_id: number; expected_quantity: number;
      new_quantity: number; created_at: number; status: 'queued' | 'conflict'; error: string | null;
    }>('SELECT * FROM stock_adjustments WHERE user_id=? ORDER BY created_at, rowid', userId);
    return rows.map(row => ({operationId: row.operation_id, userId: row.user_id,
      inventoryId: row.inventory_id, expectedQuantity: row.expected_quantity,
      newQuantity: row.new_quantity, createdAt: row.created_at, status: row.status, error: row.error}));
  },
  async remove(operationId) {
    if (Platform.OS === 'web') {
      saveWebEntries(getWebEntries().filter(item => item.operationId !== operationId));
      notifyQueueChanged();
      return;
    }
    const db = await database();
    await db.runAsync('DELETE FROM stock_adjustments WHERE operation_id=?', operationId);
    notifyQueueChanged();
  },
  async markConflict(operationId, message) {
    if (Platform.OS === 'web') {
      saveWebEntries(getWebEntries().map(item => item.operationId === operationId
        ? {...item, status: 'conflict', error: message} : item));
      notifyQueueChanged();
      return;
    }
    const db = await database();
    await db.runAsync("UPDATE stock_adjustments SET status='conflict',error=? WHERE operation_id=?", message, operationId);
    notifyQueueChanged();
  },
};
