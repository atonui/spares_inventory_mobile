import {test} from 'node:test';
import assert from 'node:assert/strict';

const checkerModule = await import('../scripts/check-mobile-api-contract.mjs').catch(() => null);

// [method, path, requiresBearer] — mirrors scripts/check-mobile-api-contract.mjs.
const requiredRoutes = [
  ['GET', '/api/v1/csrf-token', false],
  ['POST', '/api/v1/auth/native/login', false],
  ['POST', '/api/v1/auth/native/refresh', false],
  ['POST', '/api/v1/auth/mobile-pairing/claim', false],
  ['POST', '/api/v1/auth/mobile-pairing/complete', false],
  ['GET', '/api/v1/me', true],
  ['GET', '/api/v1/inventory', true],
  ['GET', '/api/v1/parts', true],
  ['GET', '/api/v1/overview', true],
  ['GET', '/api/v1/equipment', true],
  ['GET', '/api/v1/inventory/movements', true],
  ['GET', '/api/v1/stores', true],
  ['GET', '/api/v1/inventory/transfers', true],
  ['POST', '/api/v1/inventory/adjustments', true],
  ['POST', '/api/v1/inventory/add', true],
  ['POST', '/api/v1/inventory/consume', true],
  ['POST', '/api/v1/inventory/transfer', true],
  ['POST', '/api/v1/inventory/transfers/{transfer_id}/receive', true],
  ['POST', '/api/v1/inventory/transfers/{transfer_id}/return', true],
  ['POST', '/api/v1/auth/logout', true],
  ['POST', '/api/v1/auth/email-change/confirm', false],
];

function contractFor(routes) {
  const paths = {};
  for (const [method, path, requiresBearer] of routes) {
    const operation = {security: requiresBearer ? [{BearerAuth: []}] : []};
    if (method === 'GET' && path === '/api/v1/inventory') {
      operation.parameters = [{name: 'search', in: 'query'}, {name: 'store_id', in: 'query'}];
    }
    paths[path] = {...paths[path], [method.toLowerCase()]: operation};
  }
  return {
    openapi: '3.1.0',
    paths,
    components: {securitySchemes: {BearerAuth: {type: 'http', scheme: 'bearer'}}},
  };
}

test('checks every required mobile route using the generated OpenAPI document only', async () => {
  assert.ok(checkerModule, 'the mobile API contract checker should be available');
  let request;
  const result = await checkerModule.checkMobileApiContract({
    baseUrl: 'https://saas.example/',
    fetchImpl: async (url, options) => {
      request = {url, options};
      return {ok: true, status: 200, json: async () => contractFor(requiredRoutes)};
    },
  });

  assert.equal(request.url, 'https://saas.example/api/v1/openapi.json');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.headers.Accept, 'application/json');
  assert.equal('Authorization' in request.options.headers, false);
  assert.equal(result.checkedRoutes, requiredRoutes.length);
});

test('reports missing mobile route methods in the generated contract', async () => {
  assert.ok(checkerModule, 'the mobile API contract checker should be available');
  const incompleteRoutes = requiredRoutes.filter(([method, path]) => !(method === 'GET' && path === '/api/v1/me'));

  await assert.rejects(checkerModule.checkMobileApiContract({
    baseUrl: 'https://saas.example',
    fetchImpl: async () => ({ok: true, status: 200, json: async () => contractFor(incompleteRoutes)}),
  }), /GET \/api\/v1\/me/);
});

test('refuses a non-HTTPS base URL before making a request', async () => {
  assert.ok(checkerModule, 'the mobile API contract checker should be available');
  let requested = false;

  await assert.rejects(checkerModule.checkMobileApiContract({
    baseUrl: 'http://saas.example',
    fetchImpl: async () => { requested = true; return {ok: true, status: 200, json: async () => contractFor(requiredRoutes)}; },
  }), /HTTPS/);
  assert.equal(requested, false);
});

test('refuses credentials embedded in the base URL', async () => {
  assert.ok(checkerModule, 'the mobile API contract checker should be available');
  let requested = false;

  await assert.rejects(checkerModule.checkMobileApiContract({
    baseUrl: 'https://user:secret@saas.example',
    fetchImpl: async () => { requested = true; return {ok: true, status: 200, json: async () => contractFor(requiredRoutes)}; },
  }), /must not contain credentials/);
  assert.equal(requested, false);
});
