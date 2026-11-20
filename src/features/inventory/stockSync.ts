import {api} from '../../api/runtime';
import {syncQueuedStock, type SyncResult} from './offlineStockQueue';
import {offlineStockStore} from './offlineStockStore';

/**
 * Sends this user's queued stock changes. Every screen should sync through
 * here so they share one in-flight run and the same 403 handling: /me is
 * checked before a 403 is treated as a per-item problem, and an auth failure
 * from /me is thrown with the queue left intact.
 */
export function syncStockChanges(userId: number): Promise<SyncResult> {
  return syncQueuedStock(offlineStockStore, userId, api.adjustStock, {
    confirmSession: () => api.getMe(),
  });
}
