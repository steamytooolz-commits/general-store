import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { raw, login, DEMO_ACCOUNTS, VALID_SHIPPING } from './helpers.js';

function boot(dbPath) {
  const db = openDb(dbPath);
  const server = createApp({ db });
  const listen = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { db, server, listen };
}

async function baseOf(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function shutdown(instance) {
  return new Promise((resolve) => {
    instance.server.close(() => {
      instance.db.close();
      resolve();
    });
  });
}

describe('persistence across restarts', () => {
  it('keeps orders, sessions, and stock after closing and reopening the database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-restart-'));
    const dbPath = path.join(dir, 'store.db');
    try {
      // ---- First boot -----------------------------------------------------
      const first = boot(dbPath);
      await first.listen;
      const base1 = await baseOf(first.server);

      const cookie = await login(base1, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
      assert.ok(cookie);
      const before = (await raw(base1, 'GET', '/api/products/3')).body.stock;
      const placed = await raw(base1, 'POST', '/api/orders', {
        cookie,
        body: {
          customer: { ...VALID_SHIPPING, email: DEMO_ACCOUNTS.customer.email },
          items: [{ productId: 3, quantity: 1 }],
        },
      });
      assert.equal(placed.status, 201);
      const orderId = placed.body.id;
      await shutdown(first);

      // ---- Second boot: everything should still be there -----------------
      const second = boot(dbPath);
      await second.listen;
      const base2 = await baseOf(second.server);

      // the session survived too (tokens are stored in the database)
      const me = await raw(base2, 'GET', '/api/auth/me', { cookie });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.email, DEMO_ACCOUNTS.customer.email);

      // the order and its reduced stock survived
      const order = await raw(base2, 'GET', `/api/orders/${orderId}`, { cookie });
      assert.equal(order.status, 200);
      assert.equal(order.body.status, 'placed');
      const after = (await raw(base2, 'GET', '/api/products/3')).body.stock;
      assert.equal(after, before - 1);

      // ordering again keeps incrementing ids instead of reusing them
      const secondOrder = await raw(base2, 'POST', '/api/orders', {
        cookie,
        body: {
          customer: { ...VALID_SHIPPING, email: DEMO_ACCOUNTS.customer.email },
          items: [{ productId: 5, quantity: 1 }],
        },
      });
      assert.equal(secondOrder.status, 201);
      assert.ok(secondOrder.body.id > orderId);
      await shutdown(second);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds catalog data only once across boots', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-seed-'));
    const dbPath = path.join(dir, 'store.db');
    try {
      const first = boot(dbPath);
      await first.listen;
      const base1 = await baseOf(first.server);
      const count1 = (await raw(base1, 'GET', '/api/products')).body.length;
      await shutdown(first);

      const second = boot(dbPath);
      await second.listen;
      const base2 = await baseOf(second.server);
      const count2 = (await raw(base2, 'GET', '/api/products')).body.length;
      assert.equal(count2, count1, 'products must not be double-seeded');
      await shutdown(second);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});