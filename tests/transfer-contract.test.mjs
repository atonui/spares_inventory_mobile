import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStore, parseTransfer, readNativePages} from '../src/api/transferContract.ts';
import {createApiClient} from '../src/api/client.ts';

const row = {id: 1, quantity: 2, part_number: 'PART', description: 'Part', from_store_id: 1, to_store_id: 2,
  from_store_name: 'Source', to_store_name: 'Destination', created_at: '2026-10-30T00:00:00Z', status: 'in_transit', can_receive: true, can_return: false};

test('pending transfers require explicit boolean permissions and zoned timestamps', () => {
  assert.equal(parseTransfer(row).canReturn, false);
  assert.throws(() => parseTransfer({...row, can_receive: 'true'}));
  assert.throws(() => parseTransfer({...row, created_at: '2026-10-30T00:00:00'}));
  assert.throws(() => parseTransfer({...row, status: 'received'}));
});

test('store reads include empty stores and follow opaque continuation cursors', async () => {
  const cursors = [];
  const stores = await readNativePages(async cursor => {
    cursors.push(cursor);
    return {items: [{id: cursor ? 2 : 1, name: cursor ? 'Empty' : 'Source', type: 'central'}], page: {next_cursor: cursor ? null : 'opaque'}};
  }, parseStore);
  assert.deepEqual(cursors, [null, 'opaque']);
  assert.equal(stores[1].name, 'Empty');
});

test('repeated continuation cursors stop the read', async () => {
  await assert.rejects(readNativePages(async () => ({items: [], page: {next_cursor: 'same'}}), parseStore), /pagination/);
});

test('transfer actions use bearer-only operational endpoints and are not retried on lost response', async () => {
  const calls = [];
  const client = createApiClient({baseUrl: 'https://inventory.example', sessionStore: {
    async getSession() {return {access_token: 'access', refresh_token: 'refresh', expires_at: '2030-01-01T00:00:00Z'};},
    async setSession() {}, async clearSession() {},
  }, fetchImpl: async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('/return')) throw new TypeError('lost response');
    return {ok: true, status: 200, async json() {return {success: true};}};
  }});
  await client.dispatchStock({inventoryId: 1, toStoreId: 2, quantity: 3});
  await client.completeTransfer(12, 'receive');
  await assert.rejects(client.completeTransfer(13, 'return'), TypeError);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[0].options.body), {inventory_id: 1, to_store_id: 2, quantity: 3});
  assert.equal(calls[1].url, 'https://inventory.example/api/v1/inventory/transfers/12/receive');
  assert.deepEqual(JSON.parse(calls[1].options.body), {confirmed: true});
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access');
});
