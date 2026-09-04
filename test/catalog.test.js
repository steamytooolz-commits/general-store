import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stopApp, raw, login, DEMO_ACCOUNTS } from './helpers.js';

let app;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await stopApp(app);
});

describe('public catalog', () => {
  it('lists only active products with full shape', async () => {
    const r = await raw(app.base, 'GET', '/api/products');
    assert.equal(r.status, 200);
    assert.ok(r.body.length >= 12);
    for (const p of r.body) {
      assert.ok(Number.isInteger(p.id));
      assert.equal(typeof p.name, 'string');
      assert.ok(Number.isInteger(p.priceCents) && p.priceCents > 0);
      assert.equal(p.active, true);
    }
  });

  it('filters by category slug', async () => {
    const r = await raw(app.base, 'GET', '/api/products?category=electronics');
    assert.equal(r.status, 200);
    assert.ok(r.body.length >= 2);
    assert.ok(r.body.every((p) => p.categorySlug === 'electronics'));
  });

  it('searches by name and description', async () => {
    const byName = await raw(app.base, 'GET', '/api/products?q=mug');
    assert.ok(byName.body.some((p) => p.name.toLowerCase().includes('mug')));
    const byDesc = await raw(app.base, 'GET', '/api/products?q=insulated');
    assert.ok(byDesc.body.some((p) => p.name === 'Stainless Water Bottle'));
  });

  it('sorts by price', async () => {
    const r = await raw(app.base, 'GET', '/api/products?sort=price_asc');
    const prices = r.body.map((p) => p.priceCents);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  });

  it('returns 404 for unknown or inactive products', async () => {
    assert.equal((await raw(app.base, 'GET', '/api/products/9999')).status, 404);

    const staffCookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    const created = await raw(app.base, 'POST', '/api/manage/products', {
      cookie: staffCookie,
      body: { name: 'Secret Item', priceCents: 100, stock: 5, active: false },
    });
    assert.equal(created.status, 201);
    assert.equal((await raw(app.base, 'GET', `/api/products/${created.body.id}`)).status, 404);
  });

  it('lists categories with product counts', async () => {
    const r = await raw(app.base, 'GET', '/api/categories');
    assert.equal(r.status, 200);
    const electronics = r.body.find((c) => c.slug === 'electronics');
    assert.ok(electronics && electronics.productCount >= 2);
  });
});

describe('staff product management', () => {
  async function staff() {
    return login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
  }

  it('creates, updates, and lists products (including hidden ones)', async () => {
    const cookie = await staff();
    const created = await raw(app.base, 'POST', '/api/manage/products', {
      cookie,
      body: { name: 'Wooden Chess Set', description: 'Walnut and maple', priceCents: 4200, stock: 7, active: true },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Wooden Chess Set');

    const updated = await raw(app.base, 'PUT', `/api/manage/products/${created.body.id}`, {
      cookie,
      body: { priceCents: 3999, stock: 3, active: false },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.priceCents, 3999);
    assert.equal(updated.body.stock, 3);
    assert.equal(updated.body.active, false);

    const list = await raw(app.base, 'GET', '/api/manage/products', { cookie });
    assert.ok(list.body.some((p) => p.id === created.body.id && p.active === false));
    // hidden product is not on the public shelf
    assert.equal((await raw(app.base, 'GET', `/api/products/${created.body.id}`)).status, 404);
  });

  it('validates product fields', async () => {
    const cookie = await staff();
    const noName = await raw(app.base, 'POST', '/api/manage/products', {
      cookie,
      body: { priceCents: 100, stock: 1 },
    });
    assert.equal(noName.status, 400);
    const badPrice = await raw(app.base, 'POST', '/api/manage/products', {
      cookie,
      body: { name: 'X', priceCents: -5, stock: 1 },
    });
    assert.equal(badPrice.status, 400);
    const badCategory = await raw(app.base, 'POST', '/api/manage/products', {
      cookie,
      body: { name: 'X', priceCents: 100, stock: 1, categoryId: 999 },
    });
    assert.equal(badCategory.status, 400);
  });

  it('deletes products with no order history but deactivates referenced ones', async () => {
    const cookie = await staff();
    const fresh = await raw(app.base, 'POST', '/api/manage/products', {
      cookie,
      body: { name: 'Temporary', priceCents: 100, stock: 1 },
    });
    const del = await raw(app.base, 'DELETE', `/api/manage/products/${fresh.body.id}`, { cookie });
    assert.deepEqual(del.body, { ok: true, deleted: true });
    assert.equal((await raw(app.base, 'GET', `/api/manage/products/${fresh.body.id}`, { cookie })).status, 404);

    // Product 1 (mug) has demo order history -> soft-deactivate instead
    const soft = await raw(app.base, 'DELETE', '/api/manage/products/1', { cookie });
    assert.equal(soft.status, 200);
    assert.equal(soft.body.deleted, false);
    const listed = await raw(app.base, 'GET', '/api/manage/products', { cookie });
    const mug = listed.body.find((p) => p.id === 1);
    assert.equal(mug.active, false);
    // and it disappears from the public catalog
    assert.equal((await raw(app.base, 'GET', '/api/products/1')).status, 404);
  });
});