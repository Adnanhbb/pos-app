#!/usr/bin/env node

/*
 * Backend API smoke/integration test runner.
 *
 * Windows PowerShell:
 *   $env:API_BASE_URL="http://localhost/api"; npm run test:api
 *
 * The script uses Node.js built-in fetch. It expects the PHP API to be running
 * and a MySQL/MariaDB database to already have api/sql/schema.sql imported.
 */

const API_BASE_URL = (process.env.API_BASE_URL || 'http://localhost/api').replace(/\/+$/, '');
const runId = `api-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let passed = 0;
let failed = 0;

function endpoint(file) {
  return `${API_BASE_URL}/${file}.php`;
}

async function request(file, options = {}) {
  const { method = 'GET', body, rawBody, query = '', headers = {} } = options;
  const response = await fetch(`${endpoint(file)}${query}`, {
    method,
    headers: {
      ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

  const text = await response.text();
  let data = null;

  if (text.trim() !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    body: data,
  };
}

function pass(name, response) {
  passed += 1;
  console.log(`PASS ${name} [${response?.status ?? 'n/a'}]`);
}

function fail(name, response, message) {
  failed += 1;
  console.error(`FAIL ${name} [${response?.status ?? 'n/a'}] ${message}`);

  if (response !== undefined) {
    console.error(JSON.stringify(response.body, null, 2));
  }
}

function check(name, response, predicate, message) {
  if (predicate(response)) {
    pass(name, response);
    return true;
  }

  fail(name, response, message);
  return false;
}

function isSuccess(response) {
  return response.ok && response.body?.success === true;
}

function responseData(response) {
  return response.body?.data;
}

function getServerId(response) {
  const data = responseData(response);
  return data?.serverId ?? data?.id ?? null;
}

function hasForbiddenPasswordKey(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasForbiddenPasswordKey);
  }

  return Object.entries(value).some(([key, child]) => {
    if (key === 'password' || key === 'Password' || key === 'password_hash') {
      return true;
    }

    return hasForbiddenPasswordKey(child);
  });
}

async function testMalformedJson(file) {
  const response = await request(file, {
    method: 'POST',
    rawBody: '{"broken":',
  });

  check(
    `${file}: malformed JSON returns 400`,
    response,
    (res) => res.status === 400 && res.body?.success === false,
    'expected HTTP 400 malformed JSON error',
  );
}

async function testCrudEndpoint(config) {
  const { file, create, update, deleteSupported = true, getByClientId = false } = config;

  await testMalformedJson(file);

  const createResponse = await request(file, {
    method: 'POST',
    body: create,
  });
  const created = check(
    `${file}: create`,
    createResponse,
    isSuccess,
    'expected success response for create',
  );

  const duplicateResponse = await request(file, {
    method: 'POST',
    body: create,
  });
  check(
    `${file}: duplicate client_id returns 409`,
    duplicateResponse,
    (res) => res.status === 409 && res.body?.success === false,
    'expected HTTP 409 duplicate client_id',
  );

  const listResponse = await request(file);
  check(
    `${file}: list`,
    listResponse,
    (res) => isSuccess(res) && Array.isArray(responseData(res)),
    'expected success response with data array',
  );

  const lookupId = getByClientId ? create.localId : getServerId(createResponse);

  if (created && lookupId !== null) {
    const getResponse = await request(file, {
      query: `?id=${encodeURIComponent(String(lookupId))}`,
    });
    check(
      `${file}: get by id`,
      getResponse,
      isSuccess,
      'expected success response for get by id',
    );

    const updateResponse = await request(file, {
      method: 'PATCH',
      query: `?id=${encodeURIComponent(String(lookupId))}`,
      body: update,
    });
    check(
      `${file}: update`,
      updateResponse,
      isSuccess,
      'expected success response for update',
    );

    if (deleteSupported) {
      const deleteResponse = await request(file, {
        method: 'DELETE',
        query: `?id=${encodeURIComponent(String(lookupId))}`,
      });
      check(
        `${file}: delete`,
        deleteResponse,
        isSuccess,
        'expected success response for delete',
      );
    }
  } else {
    fail(`${file}: dependent get/update/delete`, createResponse, 'skipped because create did not return an id');
  }
}

async function testHealth() {
  const response = await request('health');
  check(
    'health: db connected',
    response,
    (res) => isSuccess(res) && responseData(res)?.status === 'ok',
    'expected health success with status ok',
  );
}

async function testUsers() {
  const file = 'users';
  const localId = `${runId}-user`;
  const username = `${runId}-admin`;

  await testMalformedJson(file);

  const createBody = {
    localId,
    Username: username,
    Name: 'API Test Admin',
    Mobile: '03000000000',
    Role: 'admin',
    Password: 'secret123',
  };
  const createResponse = await request(file, { method: 'POST', body: createBody });
  check(`${file}: create`, createResponse, isSuccess, 'expected user create success');
  check(
    `${file}: create response hides password fields`,
    createResponse,
    (res) => !hasForbiddenPasswordKey(res.body),
    'response included password, Password, or password_hash',
  );

  const duplicateResponse = await request(file, { method: 'POST', body: createBody });
  check(
    `${file}: duplicate user identifier returns 409`,
    duplicateResponse,
    (res) => res.status === 409 && res.body?.success === false,
    'expected HTTP 409 duplicate user identifier',
  );

  const id = getServerId(createResponse);
  const listResponse = await request(file);
  check(`${file}: list`, listResponse, (res) => isSuccess(res) && Array.isArray(responseData(res)), 'expected list array');
  check(
    `${file}: list response hides password fields`,
    listResponse,
    (res) => !hasForbiddenPasswordKey(res.body),
    'response included password, Password, or password_hash',
  );

  if (id !== null) {
    const getResponse = await request(file, { query: `?id=${encodeURIComponent(String(id))}` });
    check(`${file}: get by id`, getResponse, isSuccess, 'expected get by id success');
    check(
      `${file}: get response hides password fields`,
      getResponse,
      (res) => !hasForbiddenPasswordKey(res.body),
      'response included password, Password, or password_hash',
    );

    const updateResponse = await request(file, {
      method: 'PATCH',
      query: `?id=${encodeURIComponent(String(id))}`,
      body: { Name: 'API Test Admin Updated', Mobile: '03111111111' },
    });
    check(`${file}: update`, updateResponse, isSuccess, 'expected update success');
    check(
      `${file}: update response hides password fields`,
      updateResponse,
      (res) => !hasForbiddenPasswordKey(res.body),
      'response included password, Password, or password_hash',
    );

    const deleteResponse = await request(file, {
      method: 'DELETE',
      query: `?id=${encodeURIComponent(String(id))}`,
    });
    check(`${file}: delete`, deleteResponse, isSuccess, 'expected delete success');
  }
}

async function testSettings() {
  const file = 'settings';
  const localId = `${runId}-settings`;

  await testMalformedJson(file);

  const createBody = {
    localId,
    businessName: 'API Test POS',
    currency: 'PKR',
  };
  const createResponse = await request(file, { method: 'POST', body: createBody });
  check(`${file}: create`, createResponse, isSuccess, 'expected settings create success');

  const duplicateResponse = await request(file, { method: 'POST', body: createBody });
  check(
    `${file}: duplicate client_id returns 409`,
    duplicateResponse,
    (res) => res.status === 409 && res.body?.success === false,
    'expected HTTP 409 duplicate client_id',
  );

  const getResponse = await request(file, {
    query: `?id=${encodeURIComponent(localId)}`,
  });
  check(`${file}: get by client id`, getResponse, isSuccess, 'expected settings get success');

  const updateResponse = await request(file, {
    method: 'PATCH',
    query: `?id=${encodeURIComponent(localId)}`,
    body: { businessName: 'API Test POS Updated', currency: 'PKR' },
  });
  check(`${file}: update`, updateResponse, isSuccess, 'expected settings update success');

  const deleteResponse = await request(file, {
    method: 'DELETE',
    query: `?id=${encodeURIComponent(localId)}`,
  });
  check(
    `${file}: delete unsupported returns 405`,
    deleteResponse,
    (res) => res.status === 405 && res.body?.success === false,
    'expected HTTP 405 because settings delete is unsupported',
  );
}

async function testHeld() {
  const file = 'held';
  const localId = `${runId}-held`;

  await testMalformedJson(file);

  const createBody = {
    held: {
      localId,
      customerName: 'API Test Customer',
      transactionType: 'Sale',
      total: 500,
    },
    items: [
      {
        itemId: 1,
        name: 'API Test Item',
        qty: 2,
        price: 250,
      },
    ],
  };
  const createResponse = await request(file, { method: 'POST', body: createBody });
  check(`${file}: create bundled held cart`, createResponse, isSuccess, 'expected held create success');
  check(
    `${file}: create returns bundled items array`,
    createResponse,
    (res) => Array.isArray(responseData(res)?.items) && responseData(res).items.length === 1,
    'expected returned held payload to include one item',
  );

  const duplicateResponse = await request(file, { method: 'POST', body: createBody });
  check(
    `${file}: duplicate client_id returns 409`,
    duplicateResponse,
    (res) => res.status === 409 && res.body?.success === false,
    'expected HTTP 409 duplicate client_id',
  );

  const id = getServerId(createResponse);
  const listResponse = await request(file);
  check(`${file}: list`, listResponse, (res) => isSuccess(res) && Array.isArray(responseData(res)), 'expected list array');

  if (id !== null) {
    const getResponse = await request(file, { query: `?id=${encodeURIComponent(String(id))}` });
    check(`${file}: get by id`, getResponse, isSuccess, 'expected get by id success');
    check(
      `${file}: get returns bundled items array`,
      getResponse,
      (res) => Array.isArray(responseData(res)?.items) && responseData(res).items.length === 1,
      'expected get response to include bundled items',
    );

    const deleteResponse = await request(file, {
      method: 'DELETE',
      query: `?id=${encodeURIComponent(String(id))}`,
    });
    check(`${file}: delete`, deleteResponse, isSuccess, 'expected delete success');
  }
}

async function testItems() {
  const file = 'items';
  const localId = `${runId}-item`;
  const createBody = {
    localId,
    name: 'API Test Item',
    barcode: `${Date.now()}`,
    description: 'Created by automated API test',
    purchasePrice: 100,
    retailPrice: 125,
    discountPrice: 120,
    wholesalePrice: 110,
    availableStock: 50,
    category: 'API Category',
    brand: 'API Brand',
    minunit: 'pcs',
    maxunit: 'box',
    ConvQty: 12,
  };

  await testMalformedJson(file);

  const createResponse = await request(file, { method: 'POST', body: createBody });
  check(`${file}: create full item`, createResponse, isSuccess, 'expected item create success');

  const duplicateResponse = await request(file, { method: 'POST', body: createBody });
  check(
    `${file}: duplicate client_id returns 409`,
    duplicateResponse,
    (res) => res.status === 409 && res.body?.success === false,
    'expected HTTP 409 duplicate client_id',
  );

  const id = getServerId(createResponse);
  const listResponse = await request(file);
  check(`${file}: list`, listResponse, (res) => isSuccess(res) && Array.isArray(responseData(res)), 'expected list array');

  if (id !== null) {
    const getResponse = await request(file, { query: `?id=${encodeURIComponent(String(id))}` });
    check(`${file}: get by id`, getResponse, isSuccess, 'expected get by id success');

    const safeUpdateResponse = await request(file, {
      method: 'PATCH',
      query: `?id=${encodeURIComponent(String(id))}`,
      body: {
        name: 'API Test Item Updated',
        retailPrice: 130,
        discountPrice: 124,
      },
    });
    check(`${file}: safe profile update`, safeUpdateResponse, isSuccess, 'expected safe item update success');

    const unsafeStockResponse = await request(file, {
      method: 'PATCH',
      query: `?id=${encodeURIComponent(String(id))}`,
      body: { availableStock: 999 },
    });
    check(
      `${file}: unsafe stock update returns 400`,
      unsafeStockResponse,
      (res) => res.status === 400 && res.body?.success === false,
      'expected HTTP 400 for unsafe availableStock update',
    );

    const unsafeCategoryResponse = await request(file, {
      method: 'PATCH',
      query: `?id=${encodeURIComponent(String(id))}`,
      body: { category: 'Unsafe Category' },
    });
    check(
      `${file}: unsafe category update returns 400`,
      unsafeCategoryResponse,
      (res) => res.status === 400 && res.body?.success === false,
      'expected HTTP 400 for unsafe category update',
    );

    const deleteResponse = await request(file, {
      method: 'DELETE',
      query: `?id=${encodeURIComponent(String(id))}`,
    });
    check(`${file}: delete`, deleteResponse, isSuccess, 'expected delete success');
  }
}

async function testTransactions() {
  const file = 'transactions';
  const clientTransactionId = `${runId}-tx`;
  const transactionPayload = {
    clientTransactionId,
    transactionType: 'sale',
    createdAt: Date.now(),
    payload: {
      sale: {
        invoiceNo: `${runId}-INV`,
        total: 500,
      },
      items: [
        {
          itemId: 1,
          qty: 2,
          price: 250,
        },
      ],
    },
  };

  await testMalformedJson(file);

  const createResponse = await request(file, {
    method: 'POST',
    body: transactionPayload,
  });
  check(
    `${file}: store transaction`,
    createResponse,
    (res) => isSuccess(res) && responseData(res)?.storedOnly === true,
    'expected storedOnly transaction success',
  );

  const sameResponse = await request(file, {
    method: 'POST',
    body: transactionPayload,
  });
  check(
    `${file}: same id + same payload returns saved response`,
    sameResponse,
    (res) => isSuccess(res) && responseData(res)?.clientTransactionId === clientTransactionId,
    'expected idempotent saved response',
  );

  const changedResponse = await request(file, {
    method: 'POST',
    body: {
      ...transactionPayload,
      payload: {
        sale: {
          invoiceNo: `${runId}-INV-CHANGED`,
          total: 999,
        },
      },
    },
  });
  check(
    `${file}: same id + changed payload returns 409`,
    changedResponse,
    (res) => res.status === 409 && res.body?.success === false,
    'expected HTTP 409 for changed idempotency payload',
  );
}

async function main() {
  console.log(`Testing API: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);

  await testHealth();

  await testCrudEndpoint({
    file: 'units',
    create: { localId: `${runId}-unit`, name: 'API Test Unit', shortName: 'atu', itemCount: 0 },
    update: { name: 'API Test Unit Updated', shortName: 'atu2', itemCount: 1 },
  });

  await testCrudEndpoint({
    file: 'taxes',
    create: { localId: `${runId}-tax`, name: 'API Test Tax', value: 5, type: 'percent' },
    update: { value: 7, type: 'percent' },
  });

  await testCrudEndpoint({
    file: 'discounts',
    create: { localId: `${runId}-discount`, name: 'API Test Discount', value: 10, type: 'percent' },
    update: { value: 12, type: 'fixed' },
  });

  await testCrudEndpoint({
    file: 'brands',
    create: { localId: `${runId}-brand`, name: 'API Test Brand', itemCount: 0 },
    update: { name: 'API Test Brand Updated', itemCount: 2 },
  });

  await testCrudEndpoint({
    file: 'categories',
    create: { localId: `${runId}-category`, name: 'API Test Category', itemCount: 0 },
    update: { name: 'API Test Category Updated', itemCount: 3 },
  });

  await testCrudEndpoint({
    file: 'customers',
    create: {
      localId: `${runId}-customer`,
      name: 'API Test Customer',
      mobile: '03000000001',
      cnic: '12345-0000000-1',
      address: 'API Test Address',
      invoices: 0,
      payable: 0,
      paid: 0,
      balance: 0,
    },
    update: { name: 'API Test Customer Updated', mobile: '03000000002' },
  });

  await testCrudEndpoint({
    file: 'suppliers',
    create: {
      localId: `${runId}-supplier`,
      name: 'API Test Supplier',
      mobile: '03000000003',
      cnic: '12345-0000000-2',
      address: 'API Supplier Address',
      invoices: 0,
      payable: 0,
      paid: 0,
      balance: 0,
    },
    update: { name: 'API Test Supplier Updated', mobile: '03000000004' },
  });

  await testCrudEndpoint({
    file: 'expenses',
    create: {
      localId: `${runId}-expense`,
      date: '2026-05-18',
      category: 'API Test Expense',
      amount: 1000,
      description: 'Created by automated API test',
    },
    update: { amount: 1250, description: 'Updated by automated API test' },
  });

  await testSettings();
  await testUsers();
  await testHeld();
  await testItems();
  await testTransactions();

  console.log('');
  console.log(`Summary: ${passed} passed, ${failed} failed`);

  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  failed += 1;
  console.error('FAIL test runner crashed [n/a]');
  console.error(error);
  console.log('');
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});
