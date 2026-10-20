import {test} from 'node:test';
import assert from 'node:assert/strict';

const checkerModule = await import('../scripts/check-mobile-api-contract.mjs').catch(() => null);

const requiredRoutes = [
  ['GET', '/api/v1/csrf-token'],
  ['POST', '/api/v1/auth/native/login'],
  ['POST', '/api/v1/auth/native/refresh'],
  ['GET', '/api/v1/me'],
  ['GET', '/api/v1/inventory'],
  ['POST', '/api/v1/auth/logout'],
];

function contractFor(routes) {
  return {
    openapi: '3.1.0',
    paths: Object.fromEntries(routes.map(([method, path]) => [path, {[method.toLowerCase()]: {}}])),
  };
}

test('checks all six mobile routes using the generated OpenAPI document only', async () => {
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
  assert.equal(result.checkedRoutes, 6);
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
