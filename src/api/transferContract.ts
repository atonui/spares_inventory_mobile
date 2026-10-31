export type StoreDestination = {id: number; name: string; type: string; location?: string | null; assignedUserId?: number | null};
export type PendingTransfer = {
  id: number; quantity: number; partNumber: string; description: string;
  fromStoreId: number; toStoreId: number; fromStoreName: string; toStoreName: string;
  createdAt: string; canReceive: boolean; canReturn: boolean;
};
export type PartRecord = {id: number; partNumber: string; description: string; category: string};
export type EquipmentRecord = {
  id: number; name: string; make: string; model: string; serialNumber: string;
  assignedUserId: number | null; assignedUserName: string | null;
  nextCalibrationDate: string | null; status: string;
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid server response');
  return value as Record<string, unknown>;
}
function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Invalid server identifier');
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid server label');
  return value;
}
export function parseStore(value: unknown): StoreDestination {
  const row = record(value);
  if (!(row.location === undefined || row.location === null || typeof row.location === 'string') ||
      !(row.assigned_user_id === undefined || row.assigned_user_id === null || (typeof row.assigned_user_id === 'number' && Number.isSafeInteger(row.assigned_user_id) && row.assigned_user_id > 0))) throw new Error('Invalid server response');
  return {id: id(row.id), name: label(row.name), type: label(row.type), location: typeof row.location === 'string' ? row.location : null,
    assignedUserId: typeof row.assigned_user_id === 'number' ? row.assigned_user_id : null};
}
export function parsePart(value: unknown): PartRecord {
  const row = record(value);
  if (typeof row.description !== 'string' || typeof row.category !== 'string') throw new Error('Invalid server response');
  return {id: id(row.id), partNumber: label(row.part_number), description: row.description, category: row.category};
}
export function parseEquipment(value: unknown): EquipmentRecord {
  const row = record(value);
  const text = (key: string): string => {
    if (typeof row[key] !== 'string') throw new Error('Invalid server response');
    return row[key] as string;
  };
  const optionalString = (key: string): string | null => {
    const value = row[key];
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new Error('Invalid server response');
    return value;
  };
  return {
    id: id(row.id), name: label(row.equipment_name), make: text('make'), model: text('model'),
    serialNumber: text('serial_number'),
    assignedUserId: row.assigned_user_id === null || row.assigned_user_id === undefined ? null : id(row.assigned_user_id),
    assignedUserName: optionalString('assigned_user_name'),
    nextCalibrationDate: optionalString('next_calibration_date'), status: label(row.status),
  };
}
export function parseTransfer(value: unknown): PendingTransfer {
  const row = record(value);
  if (row.status !== 'in_transit' || typeof row.can_receive !== 'boolean' || typeof row.can_return !== 'boolean' ||
    typeof row.description !== 'string' || typeof row.created_at !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(row.created_at) || Number.isNaN(Date.parse(row.created_at))) throw new Error('Invalid pending transfer');
  return {id: id(row.id), quantity: id(row.quantity), partNumber: label(row.part_number), description: row.description,
    fromStoreId: id(row.from_store_id), toStoreId: id(row.to_store_id), fromStoreName: label(row.from_store_name), toStoreName: label(row.to_store_name),
    createdAt: row.created_at, canReceive: row.can_receive, canReturn: row.can_return};
}
export async function readNativePages<T>(fetchPage: (cursor: string | null) => Promise<unknown>, parse: (row: unknown) => T): Promise<T[]> {
  const results: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const payload = record(await fetchPage(cursor));
    const page = record(payload.page);
    if (!Array.isArray(payload.items) || !(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor.length > 0))) throw new Error('Invalid server page');
    results.push(...payload.items.map(parse));
    cursor = page.next_cursor as string | null;
    if (cursor !== null) {
      if (seen.has(cursor) || seen.size >= 999) throw new Error('Invalid server pagination');
      seen.add(cursor);
    }
  } while (cursor !== null);
  return results;
}
