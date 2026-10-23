import * as SQLite from 'expo-sqlite';
import type {InventoryItem} from './inventoryRepository';
import type {NativeUser} from '../../api/client';
import type {StockQueueStore} from './offlineStockQueue';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export type OfflineStockStorage = StockQueueStore & {
  saveInventorySnapshot(userId: number, items: InventoryItem[]): Promise<void>;
  loadInventorySnapshot(userId: number): Promise<InventoryItem[] | null>;
  saveProfile(profile: NativeUser): Promise<void>;
  loadProfile(userId: number): Promise<NativeUser | null>;
  getActiveUserId(): Promise<number | null>;
  setActiveUserId(userId: number | null): Promise<void>;
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

export const offlineStockStore: OfflineStockStorage = {
  async saveInventorySnapshot(userId: number, items: InventoryItem[]) {
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
    const db = await database();
    const rows = await db.getAllAsync<{item_json: string}>(
      'SELECT item_json FROM inventory_snapshot WHERE user_id=? ORDER BY inventory_id', userId);
    const marker = await db.getFirstAsync<{saved_at: number}>(
      'SELECT saved_at FROM inventory_snapshot_state WHERE user_id=?', userId);
    if (!marker) return null;
    try { return rows.map(row => JSON.parse(row.item_json) as InventoryItem); }
    catch { return null; }
  },
  async saveProfile(profile: NativeUser) {
    const db = await database();
    await db.runAsync('INSERT OR REPLACE INTO offline_profile(user_id,profile_json) VALUES(?,?)',
      profile.id, JSON.stringify(profile));
    await db.runAsync("INSERT OR REPLACE INTO offline_metadata(key,value) VALUES('active_user_id',?)", String(profile.id));
  },
  async loadProfile(userId: number): Promise<NativeUser | null> {
    const db = await database();
    const row = await db.getFirstAsync<{profile_json: string}>(
      'SELECT profile_json FROM offline_profile WHERE user_id=?', userId);
    if (!row) return null;
    try { return JSON.parse(row.profile_json) as NativeUser; } catch { return null; }
  },
  async getActiveUserId() {
    const db = await database();
    const row = await db.getFirstAsync<{value: string}>(
      "SELECT value FROM offline_metadata WHERE key='active_user_id'");
    return row && /^\d+$/.test(row.value) ? Number(row.value) : null;
  },
  async setActiveUserId(userId) {
    const db = await database();
    if (userId === null) await db.runAsync("DELETE FROM offline_metadata WHERE key='active_user_id'");
    else await db.runAsync("INSERT OR REPLACE INTO offline_metadata(key,value) VALUES('active_user_id',?)", String(userId));
  },
  async enqueue(adjustment) {
    const db = await database();
    await db.runAsync(`INSERT INTO stock_adjustments
      (operation_id,user_id,inventory_id,expected_quantity,new_quantity,created_at,status,error)
      VALUES(?,?,?,?,?,?,?,?)`, adjustment.operationId, adjustment.userId, adjustment.inventoryId,
      adjustment.expectedQuantity, adjustment.newQuantity, adjustment.createdAt, adjustment.status, adjustment.error);
  },
  async list(userId) {
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
    const db = await database();
    await db.runAsync('DELETE FROM stock_adjustments WHERE operation_id=?', operationId);
  },
  async markConflict(operationId, message) {
    const db = await database();
    await db.runAsync("UPDATE stock_adjustments SET status='conflict',error=? WHERE operation_id=?", message, operationId);
  },
};
