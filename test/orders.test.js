import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, stopApp, raw, login, DEMO_ACCOUNTS, VALID_SHIPPING } from './helpers.js';

let app;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await stopApp(app);
});

async function productPrice(base, id) {
  return (await raw(base, 'GET', `/api/products/${id}`)).body.priceCents;
}

async function productStock(base, id) {
  return (await raw(base, 'GET', `/api/products/${id}`)).body.stock;
}

function orderPayload(overrides = {}) {
  return {
    customer: { ...VALID_SHIPPING },
    items: [{ productId: 1, quantity: 2 }],
    ...overrides,
  };
}

describe('checkout', () => {
  it('places a guest order, snapshots prices, and decrements stock', async () => {
    const before = await productStock(app.base, 1);
    const price = await productPrice(app.base, 1);
    const r = await raw(app.base, 'POST', '/api/orders', { body: orderPayload() });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'placed');
    assert.equal(r.body.totalCents, price * 2);
    assert.equal(r.body.items[0].productName, 'Ceramic Coffee Mug');
    assert.equal(r.body.items[0].unitPriceCents, price);
    assert.equal(r.body.history[0].status, 'placed');
    assert.equal(r.body.customer.name, VALID_SHIPPING.name);
    assert.equal(r.body.shipping.address, VALID_SHIPPING.address);
    assert.equal(await productStock(app.base, 1), before - 2);
  });

  it('links the order to a signed-in customer', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    const r = await raw(app.base, 'POST', '/api/orders', { cookie, body: orderPayload() });
    assert.equal(r.status, 201);
    const mine = await raw(app.base, 'GET', '/api/me/orders', { cookie });
    assert.ok(mine.body.some((o) => o.id === r.body.id));
  });

  it('requires shipping details and a valid items array', async () => {
    const noAddress = await raw(app.base, 'POST', '/api/orders', {
      body: orderPayload({ customer: { ...VALID_SHIPPING, address: '' } }),
    });
    assert.equal(noAddress.status, 400);

    const noItems = await raw(app.base, 'POST', '/api/orders', {
      body: { customer: { ...VALID_SHIPPING }, items: [] },
    });
    assert.equal(noItems.status, 400);

    const badEmail = await raw(app.base, 'POST', '/api/orders', {
      body: orderPayload({ customer: { ...VALID_SHIPPING, email: 'nope' } }),
    });
    assert.equal(badEmail.status, 400);
  });

  it('rejects insufficient stock and unknown products', async () => {
    const stock = await productStock(app.base, 1);
    const tooMany = await raw(app.base, 'POST', '/api/orders', {
      body: orderPayload({ items: [{ productId: 1, quantity: stock + 5 }] }),
    });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.body.error, /stock/i);

    const unknown = await raw(app.base, 'POST', '/api/orders', {
      body: orderPayload({ items: [{ productId: 4242, quantity: 1 }] }),
    });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.error, /not available/i);
  });

  it('does not let a failed order decrement stock (rollback)', async () => {
    const stock = await productStock(app.base, 1);
    // item 1 is fine, item 2 is not -> whole order must roll back
    const r = await raw(app.base, 'POST', '/api/orders', {
      body: orderPayload({ items: [{ productId: 1, quantity: 1 }, { productId: 4242, quantity: 1 }] }),
    });
    assert.equal(r.status, 400);
    assert.equal(await productStock(app.base, 1), stock);
  });
});

describe('customer order access', () => {
  it('keeps orders private to their owner and staff', async () => {
    const cookieA = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    const created = await raw(app.base, 'POST', '/api/orders', {
      cookie: cookieA,
      body: orderPayload({ customer: { ...VALID_SHIPPING, email: DEMO_ACCOUNTS.customer.email } }),
    });
    assert.equal(created.status, 201);

    // another customer cannot view it
    const other = await raw(app.base, 'POST', '/api/auth/register', {
      body: { name: 'Other', email: 'other@example.com', password: 'secret1' },
    });
    const otherCookie = other.setCookie.split(';')[0];
    const denied = await raw(app.base, 'GET', `/api/orders/${created.body.id}`, { cookie: otherCookie });
    assert.equal(denied.status, 403);

    // owner and staff can
    assert.equal((await raw(app.base, 'GET', `/api/orders/${created.body.id}`, { cookie: cookieA })).status, 200);
    const staffCookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    assert.equal((await raw(app.base, 'GET', `/api/orders/${created.body.id}`, { cookie: staffCookie })).status, 200);
  });

  it('lets a customer cancel an order that is still placed or paid', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    const created = await raw(app.base, 'POST', '/api/orders', {
      cookie,
      body: orderPayload({ customer: { ...VALID_SHIPPING, email: DEMO_ACCOUNTS.customer.email } }),
    });
    const cancelled = await raw(app.base, 'POST', `/api/me/orders/${created.body.id}/cancel`, { cookie });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, 'cancelled');
    assert.ok(cancelled.body.history.some((h) => h.status === 'cancelled' && /customer/i.test(h.note)));
  });

  it('forbids cancelling orders that already shipped', async () => {
    const customerCookie = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    const created = await raw(app.base, 'POST', '/api/orders', {
      cookie: customerCookie,
      body: orderPayload({ customer: { ...VALID_SHIPPING, email: DEMO_ACCOUNTS.customer.email } }),
    });
    const staffCookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    await raw(app.base, 'PATCH', `/api/manage/orders/${created.body.id}/status`, {
      cookie: staffCookie,
      body: { status: 'shipped', note: 'On the truck' },
    });
    const denied = await raw(app.base, 'POST', `/api/me/orders/${created.body.id}/cancel`, { cookie: customerCookie });
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /no longer be cancelled/i);
  });
});

describe('staff order management', () => {
  it('filters the queue by status and searches', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    const placed = await raw(app.base, 'GET', '/api/manage/orders?status=placed', { cookie });
    assert.equal(placed.status, 200);
    assert.ok(placed.body.length >= 1);
    assert.ok(placed.body.every((o) => o.status === 'placed'));

    const byId = await raw(app.base, 'GET', `/api/manage/orders?q=${placed.body[0].id}`, { cookie });
    assert.ok(byId.body.some((o) => o.id === placed.body[0].id));

    const bad = await raw(app.base, 'GET', '/api/manage/orders?status=nonsense', { cookie });
    assert.equal(bad.status, 400);
  });

  it('walks an order through its lifecycle with audit history', async () => {
    const staffCookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    const created = await raw(app.base, 'POST', '/api/orders', { body: orderPayload() });
    const id = created.body.id;

    const paid = await raw(app.base, 'PATCH', `/api/manage/orders/${id}/status`, {
      cookie: staffCookie,
      body: { status: 'paid', note: 'Payment via card' },
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'paid');

    await raw(app.base, 'PATCH', `/api/manage/orders/${id}/status`, {
      cookie: staffCookie,
      body: { status: 'shipped' },
    });
    const delivered = await raw(app.base, 'PATCH', `/api/manage/orders/${id}/status`, {
      cookie: staffCookie,
      body: { status: 'delivered' },
    });
    assert.equal(delivered.status, 200);
    assert.equal(delivered.body.history.map((h) => h.status).join(','), 'placed,paid,shipped,delivered');
    assert.equal(delivered.body.history[1].note, 'Payment via card');
    assert.equal(delivered.body.history[2].changedBy, 'Maria Staff');
  });

  it('enforces the status transition rules', async () => {
    const staffCookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    const created = await raw(app.base, 'POST', '/api/orders', { body: orderPayload() });
    const skip = await raw(app.base, 'PATCH', `/api/manage/orders/${created.body.id}/status`, {
      cookie: staffCookie,
      body: { status: 'delivered' },
    });
    assert.equal(skip.status, 400);
    assert.match(skip.body.error, /cannot change/i);
  });

  it('sees full order detail with items and shipping', async () => {
    const staffCookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    const created = await raw(app.base, 'POST', '/api/orders', { body: orderPayload() });
    const detail = await raw(app.base, 'GET', `/api/manage/orders/${created.body.id}`, { cookie: staffCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.items.length, 1);
    assert.equal(detail.body.shipping.city, VALID_SHIPPING.city);
    assert.equal(detail.body.history[0].changedBy, VALID_SHIPPING.name);
  });
});