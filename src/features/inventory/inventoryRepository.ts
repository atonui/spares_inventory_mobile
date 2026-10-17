export type InventoryItem = {
  id: number;
  partId: number;
  storeId: number;
  partNumber: string;
  description: string;
  storeName: string;
  storeType: string;
  storeOwner: number | null;
  quantity: number;
  minThreshold: number;
  isAllocated: boolean;
  workOrder: string | null;
};

export type InventoryPage = {
  items: InventoryItem[];
  nextCursor: string | null;
};

export type InventoryPageSource = {
  fetchPage(args: { limit: number; cursor: string | null }): Promise<InventoryPage>;
};

export async function fetchAllInventory(
  source: InventoryPageSource,
  limit = 50,
): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;

  do {
    if (pages >= 1000) throw new Error('Inventory page limit exceeded');
    const result = await source.fetchPage({ limit, cursor });
    if (!result || !Array.isArray(result.items) ||
        !(result.nextCursor === null || typeof result.nextCursor === 'string')) {
      throw new Error('Invalid inventory page response');
    }
    items.push(...result.items);
    cursor = result.nextCursor;
    pages += 1;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) throw new Error('Inventory cursor repeated');
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  return items;
}

export function parseInventoryItem(value: unknown): InventoryItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid inventory item');
  }
  const item = value as Record<string, unknown>;
  const numberField = (key: string): number => {
    const field = item[key];
    if (typeof field !== 'number' || !Number.isInteger(field)) throw new Error('Invalid inventory item');
    return field;
  };
  const stringField = (key: string): string => {
    const field = item[key];
    if (typeof field !== 'string') throw new Error('Invalid inventory item');
    return field;
  };
  if (typeof item.is_allocated !== 'boolean' ||
      !(item.store_owner === null || typeof item.store_owner === 'number') ||
      !(item.work_order === null || typeof item.work_order === 'string')) {
    throw new Error('Invalid inventory item');
  }
  return {
    id: numberField('id'),
    partId: numberField('part_id'),
    storeId: numberField('store_id'),
    partNumber: stringField('part_number'),
    description: stringField('description'),
    storeName: stringField('store_name'),
    storeType: stringField('store_type'),
    storeOwner: item.store_owner as number | null,
    quantity: numberField('quantity'),
    minThreshold: numberField('min_threshold'),
    isAllocated: item.is_allocated,
    workOrder: item.work_order as string | null,
  };
}

export function parseInventoryPage(value: unknown): InventoryPage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid inventory page response');
  }
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items) || typeof page.page !== 'object' || page.page === null || Array.isArray(page.page)) {
    throw new Error('Invalid inventory page response');
  }
  const pageInfo = page.page as Record<string, unknown>;
  const nextCursor = pageInfo.next_cursor;
  if (!(nextCursor === null || typeof nextCursor === 'string')) {
    throw new Error('Invalid inventory page response');
  }
  return { items: page.items.map(parseInventoryItem), nextCursor };
}
