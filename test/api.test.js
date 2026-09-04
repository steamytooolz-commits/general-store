import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, SEED_PRODUCTS } from '../src/db.js';

function startServer(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function api(baseUrl, method, pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const validOrder = {
  customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
  items: [{ productId: 1, quantity: 2 }],
};

describe('products API', () => {
  let db;
  let server;
  let baseUrl;

  beforeEach(async () => {
    db = openDb(':memory:');
    server = createApp({ db });
    baseUrl = `http://127.0.0.1:${await startServer(server)}`;
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  it('lists the seeded products', async () => {
    const { status, body } = await api(baseUrl, 'GET', '/api/products');
    assert.equal(status, 200);
    assert.equal(body.length, SEED_PRODUCTS.length);
    assert.ok(Number.isInteger(body[0].id));
    assert.equal(typeof body[0].name, 'string');
    assert.equal(typeof body[0].priceCents, 'number');
    assert.equal(typeof body[0].stock, 'number');
  });

  it('returns a single product', async () => {
    const { status, body } = await api(baseUrl, 'GET', '/api/products/1');
    assert.equal(status, 200);
    assert.equal(body.id, 1);
    assert.equal(body.name, SEED_PRODUCTS[0].name);
  });

  it('returns 404 for an unknown product', async () => {
    const { status, body } = await api(baseUrl, 'GET', '/api/products/9999');
    assert.equal(status, 404);
    assert.ok(body.error);
  });
});

describe('orders API', () => {
  let db;
  let server;
  let baseUrl;

  beforeEach(async () => {
    db = openDb(':memory:');
    server = createApp({ db });
    baseUrl = `http://127.0.0.1:${await startServer(server)}`;
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  it('places an order, computes the total, and decrements stock', async () => {
    const { status, body } = await api(baseUrl, 'POST', '/api/orders', validOrder);
    assert.equal(status, 201);
    assert.equal(body.status, 'placed');
    assert.equal(body.totalCents, SEED_PRODUCTS[0].priceCents * 2);
    assert.equal(body.customer.name, 'Ada Lovelace');
    assert.equal(body.items.length, 1);
    assert.deepEqual(body.items[0], { productId: 1, productName: SEED_PRODUCTS[0].name, quantity: 2, unitPriceCents: SEED_PRODUCTS[0].priceCents });

    const product = await api(baseUrl, 'GET', '/api/products/1');
    assert.equal(product.body.stock, SEED_PRODUCTS[0].stock - 2);
  });

  it('rejects an order when stock is insufficient', async () => {
    const { status, body } = await api(baseUrl, 'POST', '/api/orders', {
      ...validOrder,
      items: [{ productId: 1, quantity: SEED_PRODUCTS[0].stock + 1 }],
    });
    assert.equal(status, 400);
    assert.match(body.error, /stock/i);
  });

  it('rejects an order for an unknown product', async () => {
    const { status, body } = await api(baseUrl, 'POST', '/api/orders', {
      ...validOrder,
      items: [{ productId: 4242, quantity: 1 }],
    });
    assert.equal(status, 400);
    assert.match(body.error, /not found/i);
  });

  it('rejects an order without a customer', async () => {
    const { status, body } = await api(baseUrl, 'POST', '/api/orders', {
      items: [{ productId: 1, quantity: 1 }],
    });
    assert.equal(status, 400);
    assert.match(body.error, /customer/i);
  });

  it('rejects an empty items array', async () => {
    const { status, body } = await api(baseUrl, 'POST', '/api/orders', {
      customer: { name: 'Ada', email: 'ada@example.com' },
      items: [],
    });
    assert.equal(status, 400);
    assert.match(body.error, /items/i);
  });

  it('fetches a placed order with its line items', async () => {
    const created = await api(baseUrl, 'POST', '/api/orders', {
      ...validOrder,
      items: [{ productId: 2, quantity: 1 }],
    });
    assert.equal(created.status, 201);

    const { status, body } = await api(baseUrl, 'GET', `/api/orders/${created.body.id}`);
    assert.equal(status, 200);
    assert.equal(body.customer.email, 'ada@example.com');
    assert.equal(body.totalCents, SEED_PRODUCTS[1].priceCents);
    assert.equal(body.items[0].productName, SEED_PRODUCTS[1].name);
  });

  it('returns 404 for an unknown order', async () => {
    const { status } = await api(baseUrl, 'GET', '/api/orders/9999');
    assert.equal(status, 404);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
  });
});

describe('persistence', () => {
  it('data survives closing and reopening the database (restarts)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
    const dbPath = path.join(dir, 'store.db');

    try {
      // First "boot": place an order through the API.
      const db1 = openDb(dbPath);
      const app1 = createApp({ db: db1 });
      const port1 = await startServer(app1);
      const created = await api(`http://127.0.0.1:${port1}`, 'POST', '/api/orders', {
        customer: { name: 'Grace Hopper', email: 'grace@example.com' },
        items: [{ productId: 3, quantity: 1 }],
      });
      assert.equal(created.status, 201);
      await stopServer(app1);
      db1.close();

      // Second "boot": the order and the reduced stock are still there.
      const db2 = openDb(dbPath);
      const app2 = createApp({ db: db2 });
      const port2 = await startServer(app2);
      const base = `http://127.0.0.1:${port2}`;

      const order = await api(base, 'GET', `/api/orders/${created.body.id}`);
      assert.equal(order.status, 200);
      assert.equal(order.body.customer.name, 'Grace Hopper');
      assert.equal(order.body.totalCents, SEED_PRODUCTS[2].priceCents);

      const product = await api(base, 'GET', '/api/products/3');
      assert.equal(product.body.stock, SEED_PRODUCTS[2].stock - 1);

      await stopServer(app2);
      db2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});