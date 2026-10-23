import type {NativeUser} from '../../api/client';
import type {InventoryItem} from '../inventory/inventoryRepository';

export function canManageCompany(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

export function canInviteAdmin(role: string): boolean {
  return role === 'owner';
}

/**
 * Client-side visibility hint matching backend/services/stock_access.py.
 * The mobile API still enforces this rule when an adjustment is submitted.
 */
export function canAdjustStock(
  user: Pick<NativeUser, 'id' | 'role'>,
  item: Pick<InventoryItem, 'storeType' | 'storeOwner' | 'isAllocated'>,
): boolean {
  if (item.isAllocated) return false;
  if (canManageCompany(user.role)) return true;
  if (user.role !== 'manager' && user.role !== 'engineer') return false;
  return item.storeType === 'central' || item.storeOwner === user.id;
}
