import type {MobileApi, NativeLogin, NativeSession, NativeUser} from './client';
import type {InventoryItem} from '../features/inventory/inventoryRepository';
import type {QueuedStockAdjustment} from '../features/inventory/offlineStockQueue';
import type {PendingTransfer} from './transferContract';

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
  let pairingPolls = 0;
  const transfers: (PendingTransfer & {source: InventoryItem})[] = [];
  let nextTransferId = 1;
  const stores = [...new Map(previewInventory.map(row => [row.storeId, {id: row.storeId, name: row.storeName, type: row.storeType}])).values(), {id: 4, name: 'Empty destination store', type: 'central'}];
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
    async claimMobilePairing(qrData, deviceName) {
      if (!qrData.includes('token=preview-pairing-token')) {
        throw new Error('This QR code is invalid or has expired. Generate a new code from your desktop account.');
      }
      if (!deviceName.trim()) throw new Error('This device could not be identified. Try pairing again.');
      pairingPolls = 0;
      return {claimToken: 'preview-claim-token', expiresAt: new Date(Date.now() + 2 * 60_000).toISOString()};
    },
    async completeMobilePairing(claimToken) {
      if (claimToken !== 'preview-claim-token') throw new Error('This pairing request is invalid or has expired.');
      pairingPolls += 1;
      if (pairingPolls === 1) return {status: 'pending'};
      return {
        status: 'approved',
        session: {
          success: true,
          token_type: 'Bearer',
          access_token: 'preview-paired-access-token',
          refresh_token: 'preview-paired-refresh-token',
          expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
          user: {...previewUser},
        },
      };
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
    async adjustStock(adjustment: QueuedStockAdjustment) {
      const item = previewInventory.find(row => row.id === adjustment.inventoryId);
      if (!item) throw new Error('Inventory item not found.');
      if (item.isAllocated) throw Object.assign(new Error('Allocated stock cannot be adjusted here.'), {status: 409});
      if (item.quantity !== adjustment.expectedQuantity) {
        throw Object.assign(new Error('Stock changed since this count was recorded.'), {status: 409});
      }
      item.quantity = adjustment.newQuantity;
    },
    async getStores() {return stores.map(store => ({...store}));},
    async getPendingTransfers() {return transfers.map(({source: _source, ...transfer}) => ({...transfer}));},
    async dispatchStock(input) {
      const source = previewInventory.find(row => row.id === input.inventoryId);
      const target = stores.find(store => store.id === input.toStoreId);
      if (!source || !target || source.storeId === target.id || input.quantity < 1 || input.quantity > source.quantity) throw new Error('Check the transfer quantity and destination.');
      source.quantity -= input.quantity;
      transfers.push({id: nextTransferId++, quantity: input.quantity, partNumber: source.partNumber, description: source.description,
        fromStoreId: source.storeId, toStoreId: target.id, fromStoreName: source.storeName, toStoreName: target.name,
        createdAt: new Date().toISOString(), canReceive: true, canReturn: true, source: {...source}});
    },
    async completeTransfer(id, action) {
      const index = transfers.findIndex(transfer => transfer.id === id);
      const transfer = transfers[index];
      if (!transfer) throw new Error('Transfer is no longer pending.');
      const storeId = action === 'receive' ? transfer.toStoreId : transfer.fromStoreId;
      const target = stores.find(store => store.id === storeId)!;
      const stock = previewInventory.find(row => row.partId === transfer.source.partId && row.storeId === storeId && !row.isAllocated);
      if (stock) stock.quantity += transfer.quantity;
      else previewInventory.push({...transfer.source, id: Math.max(...previewInventory.map(row => row.id)) + 1, storeId, storeName: target.name, storeType: target.type, storeOwner: previewUser.id, quantity: transfer.quantity});
      transfers.splice(index, 1);
    },
    async receiveStock(input) {
      const item = previewInventory.find(row => row.partId === input.partId && row.storeId === input.storeId && !row.isAllocated);
      if (!item) throw new Error('Inventory item not found.');
      item.quantity += input.quantity;
    },
    async issueStock(input) {
      const item = previewInventory.find(row => row.id === input.inventoryId);
      if (!item || item.isAllocated || item.quantity < input.quantity || !input.workOrder.trim()) throw new Error('Check the stock quantity and work order.');
      item.quantity -= input.quantity;
    },
    async logout() {
      if (!session) throw new Error('Please sign in to continue.');
      session = null;
      return {success: true};
    },
  } as MobileApi;
}
