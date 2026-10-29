import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../src/api/client.ts';

function client(fetchImpl) {
  return createApiClient({baseUrl: 'https://inventory.example', fetchImpl,
    sessionStore: {
      async getSession() {return {access_token: 'access', refresh_token: 'refresh', expires_at: '2030-01-01T00:00:00Z'};},
      async setSession() {}, async clearSession() {},
    }});
}

test('receiving and issuing use the operational endpoints with bearer transport', async () => {
  const requests = [];
  const api = client(async (url, options) => {
    requests.push({url, options});
    return {ok: true, status: 200, async json() {return {success: true};}};
  });
  await api.receiveStock({partId: 2, storeId: 3, quantity: 4});
  await api.issueStock({inventoryId: 5, quantity: 2, workOrder: ' WO-1 ', notes: ' Checked '});
  assert.equal(requests[0].url, 'https://inventory.example/api/v1/inventory/add');
  assert.deepEqual(JSON.parse(requests[0].options.body), {part_id: 2, store_id: 3, quantity: 4});
  assert.equal(requests[1].url, 'https://inventory.example/api/v1/inventory/consume');
  assert.deepEqual(JSON.parse(requests[1].options.body), {inventory_id: 5, quantity: 2, work_order_number: 'WO-1', notes: 'Checked'});
  for (const {options} of requests) {
    assert.equal(options.headers.Authorization, 'Bearer access');
    assert.equal(options.credentials, 'omit');
  }
});

test('lost operational responses are not retried', async () => {
  let requests = 0;
  const api = client(async () => {requests++; throw new TypeError('Failed to fetch');});
  await assert.rejects(api.receiveStock({partId: 2, storeId: 3, quantity: 4}), TypeError);
  assert.equal(requests, 1);
});
