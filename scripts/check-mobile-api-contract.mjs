import {pathToFileURL} from 'node:url';

const requiredRoutes = [
  ['GET', '/api/v1/csrf-token', false],
  ['POST', '/api/v1/auth/native/login', false],
  ['POST', '/api/v1/auth/native/refresh', false],
  ['POST', '/api/v1/auth/mobile-pairing/claim', false],
  ['POST', '/api/v1/auth/mobile-pairing/complete', false],
  ['GET', '/api/v1/me', true],
  ['GET', '/api/v1/inventory', true],
  ['GET', '/api/v1/parts', true],
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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function checkMobileApiContract({baseUrl, fetchImpl = fetch}) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  if (!base) throw new Error('Set SAAS_API_BASE_URL to the HTTPS base URL for a SaaS/PostgreSQL environment.');

  let parsedBase;
  try {
    parsedBase = new URL(base);
  } catch {
    throw new Error('SAAS_API_BASE_URL must be a valid HTTPS URL.');
  }
  if (parsedBase.protocol !== 'https:') throw new Error('SAAS_API_BASE_URL must use HTTPS.');
  if (parsedBase.username || parsedBase.password) throw new Error('SAAS_API_BASE_URL must not contain credentials.');

  const openApiUrl = `${base}/api/v1/openapi.json`;
  const response = await fetchImpl(openApiUrl, {
    method: 'GET',
    headers: {Accept: 'application/json'},
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Could not read generated OpenAPI document (HTTP ${response.status}).`);

  let contract;
  try {
    contract = await response.json();
  } catch {
    throw new Error('The generated OpenAPI document is not valid JSON.');
  }
  if (!isRecord(contract) || !isRecord(contract.paths)) {
    throw new Error('The generated OpenAPI document has no paths object.');
  }

  const missingRoutes = requiredRoutes.filter(([method, path]) => {
    const operations = contract.paths[path];
    return !isRecord(operations) || !isRecord(operations[method.toLowerCase()]);
  });
  if (missingRoutes.length) {
    throw new Error(`The generated contract is missing mobile routes: ${missingRoutes.map(([method, path]) => `${method} ${path}`).join(', ')}.`);
  }

  const bearerScheme = contract.components?.securitySchemes?.BearerAuth;
  if (!isRecord(bearerScheme) || bearerScheme.type !== 'http' || bearerScheme.scheme !== 'bearer') {
    throw new Error('The generated contract is missing the BearerAuth HTTP bearer security scheme.');
  }

  const incorrectSecurity = requiredRoutes.filter(([method, path, requiresBearer]) => {
    const operation = contract.paths[path][method.toLowerCase()];
    const security = operation.security;
    if (!requiresBearer) return !Array.isArray(security) || security.length !== 0;
    return !Array.isArray(security) || !security.some(requirement =>
      isRecord(requirement) && Array.isArray(requirement.BearerAuth),
    );
  });
  if (incorrectSecurity.length) {
    throw new Error(`The generated contract has incorrect bearer-auth declarations for: ${incorrectSecurity.map(([method, path]) => `${method} ${path}`).join(', ')}.`);
  }

  return {openApiUrl, checkedRoutes: requiredRoutes.length};
}

async function main() {
  try {
    const result = await checkMobileApiContract({baseUrl: process.env.SAAS_API_BASE_URL ?? process.argv[2]});
    console.log(`Verified ${result.checkedRoutes} mobile routes and bearer-auth declarations from ${result.openApiUrl}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not verify the mobile API contract.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
