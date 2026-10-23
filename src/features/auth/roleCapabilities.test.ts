import {canAdjustStock, canInviteAdmin, canManageCompany} from './roleCapabilities';
import type {InventoryItem} from '../inventory/inventoryRepository';

const row = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 1,
  partId: 10,
  storeId: 20,
  partNumber: 'A-100',
  description: 'Part',
  storeName: 'Store',
  storeType: 'engineer',
  storeOwner: 5,
  quantity: 4,
  minThreshold: 1,
  isAllocated: false,
  workOrder: null,
  ...overrides,
});

describe('role capability hints', () => {
  it('limits company management to owner and admin, and admin invitation to owner', () => {
    expect(canManageCompany('owner')).toBe(true);
    expect(canManageCompany('admin')).toBe(true);
    expect(canManageCompany('manager')).toBe(false);
    expect(canManageCompany('platform_admin')).toBe(false);
    expect(canInviteAdmin('owner')).toBe(true);
    expect(canInviteAdmin('admin')).toBe(false);
  });

  it('allows owner and admin to adjust unallocated stock in any store', () => {
    expect(canAdjustStock({id: 1, role: 'owner'}, row())).toBe(true);
    expect(canAdjustStock({id: 1, role: 'admin'}, row())).toBe(true);
  });

  it('allows manager and engineer to adjust central or personally assigned stock only', () => {
    expect(canAdjustStock({id: 5, role: 'engineer'}, row())).toBe(true);
    expect(canAdjustStock({id: 6, role: 'manager'}, row({storeType: 'central', storeOwner: null}))).toBe(true);
    expect(canAdjustStock({id: 6, role: 'engineer'}, row())).toBe(false);
    expect(canAdjustStock({id: 5, role: 'unknown'}, row())).toBe(false);
    expect(canAdjustStock({id: 1, role: 'platform_admin'}, row())).toBe(false);
  });

  it('never offers adjustment for allocated stock', () => {
    expect(canAdjustStock({id: 1, role: 'admin'}, row({isAllocated: true}))).toBe(false);
    expect(canAdjustStock({id: 5, role: 'engineer'}, row({isAllocated: true}))).toBe(false);
  });
});
