import { fetchAllInventory, type InventoryPage, type InventoryPageSource } from './inventoryRepository';

const page = (nextCursor: string | null, partNumber: string): InventoryPage => ({
  items: [{
    id: partNumber === 'A-100' ? 10 : 20,
    partId: 1,
    storeId: 2,
    partNumber,
    description: `Part ${partNumber}`,
    storeName: 'Main Store',
    storeType: 'warehouse',
    storeOwner: null,
    quantity: 4,
    minThreshold: 1,
    isAllocated: false,
    workOrder: null,
  }],
  nextCursor,
});

describe('fetchAllInventory', () => {
  it('accumulates every page and passes each opaque cursor', async () => {
    const calls: { limit: number; cursor: string | null }[] = [];
    const source: InventoryPageSource = {
      fetchPage: async (args) => {
        calls.push(args);
        return args.cursor === null ? page('cursor/one + two', 'A-100') : page(null, 'B-200');
      },
    };

    await expect(fetchAllInventory(source)).resolves.toEqual([
      page('ignored', 'A-100').items[0],
      page(null, 'B-200').items[0],
    ]);
    expect(calls).toEqual([
      { limit: 50, cursor: null },
      { limit: 50, cursor: 'cursor/one + two' },
    ]);
  });

  it('rejects a repeated non-null cursor instead of looping forever', async () => {
    const source: InventoryPageSource = {
      fetchPage: async () => page('same-cursor', 'A-100'),
    };

    await expect(fetchAllInventory(source)).rejects.toThrow('Inventory cursor repeated');
  });
});
