import type {InventoryItem} from './inventoryRepository';

export type InventorySort = 'default' | 'partNumber' | 'lowestStock';

const partNumberCollator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

export function sortInventory<T extends InventoryItem>(rows: readonly T[], sort: InventorySort): T[] {
  if (sort === 'default') return [...rows];

  return rows
    .map((row, index) => ({row, index}))
    .sort((left, right) => {
      const comparison = sort === 'partNumber'
        ? partNumberCollator.compare(left.row.partNumber, right.row.partNumber)
        : left.row.quantity - right.row.quantity;
      return comparison || left.index - right.index;
    })
    .map(({row}) => row);
}
