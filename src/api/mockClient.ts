import type {MobileApi, NativeLogin, NativeSession, NativeUser} from './client';
import type {InventoryItem} from '../features/inventory/inventoryRepository';

const previewUser: NativeUser = {
  id: 1,
  email: 'preview@sparestracker.example',
  name: 'Preview Engineer',
  role: 'engineer',
  territory: 'Preview workspace',
};

const previewInventory: InventoryItem[] = [
  {id: 1, partId: 101, storeId: 1, partNumber: '6190901970', description: 'THYRATRON CX1140LG', storeName: 'Nairobi Main Store', storeType: 'warehouse', storeOwner: null, quantity: 4, minThreshold: 2, isAllocated: false, workOrder: null},
  {id: 2, partId: 102, storeId: 1, partNumber: '110245012', description: 'PCB THYRATRON GRID CONTROL', storeName: 'Nairobi Main Store', storeType: 'warehouse', storeOwner: null, quantity: 1, minThreshold: 2, isAllocated: true, workOrder: 'WO-004537370'},
  {id: 3, partId: 103, storeId: 2, partNumber: 'D-008214', description: 'Cooling fan assembly', storeName: 'Coast General Hospital', storeType: 'customer_site', storeOwner: 2, quantity: 0, minThreshold: 1, isAllocated: false, workOrder: null},
  {id: 4, partId: 104, storeId: 3, partNumber: 'M-410720', description: 'Magnetron control cable', storeName: 'Field Kit · Allan', storeType: 'engineer', storeOwner: 1, quantity: 3, minThreshold: 1, isAllocated: false, workOrder: null},
];

export function createMockApiClient(): MobileApi {
  let session: NativeSession | null = null;
  return {
    async login({email, password}) {
      if (!email.trim() || !password) throw new Error('Enter your email and password to continue.');
      return {
        success: true,
        token_type: 'Bearer',
        access_token: 'preview-access-token',
        refresh_token: 'preview-refresh-token',
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        user: {...previewUser, email: email.trim()},
      } satisfies NativeLogin;
    },
    async refresh() {
      if (!session) throw new Error('Preview session expired. Please sign in again.');
      return session;
    },
    async getSession() { return session; },
    async saveSession(value) {
      session = {access_token: value.access_token, refresh_token: value.refresh_token, expires_at: value.expires_at};
    },
    async clearSession() { session = null; },
    async getMe() {
      if (!session) throw new Error('Please sign in to continue.');
      return {...previewUser};
    },
    async getInventory() { return previewInventory.map(row => ({...row})); },
    async logout() {
      if (!session) throw new Error('Please sign in to continue.');
      session = null;
      return {success: true};
    },
  } as MobileApi;
}
