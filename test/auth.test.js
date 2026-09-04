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

describe('registration', () => {
  it('registers a customer and starts a session', async () => {
    const r = await raw(app.base, 'POST', '/api/auth/register', {
      body: { name: 'New Person', email: 'NEW@Example.com', password: 'secret1' },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.email, 'new@example.com');
    assert.equal(r.body.user.role, 'customer');
    assert.ok(r.setCookie.includes('sid='));

    const me = await raw(app.base, 'GET', '/api/auth/me', { cookie: r.setCookie.split(';')[0] });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.name, 'New Person');
  });

  it('rejects duplicate emails with 409', async () => {
    const r = await raw(app.base, 'POST', '/api/auth/register', {
      body: { name: 'X', email: 'dupe@example.com', password: 'secret1' },
    });
    assert.equal(r.status, 201);
    const again = await raw(app.base, 'POST', '/api/auth/register', {
      body: { name: 'Y', email: 'dupe@example.com', password: 'secret1' },
    });
    assert.equal(again.status, 409);
  });

  it('validates email format and password length', async () => {
    const badEmail = await raw(app.base, 'POST', '/api/auth/register', {
      body: { name: 'X', email: 'not-an-email', password: 'secret1' },
    });
    assert.equal(badEmail.status, 400);

    const shortPw = await raw(app.base, 'POST', '/api/auth/register', {
      body: { name: 'X', email: 'x@example.com', password: '123' },
    });
    assert.equal(shortPw.status, 400);
  });
});

describe('login & sessions', () => {
  it('logs in seeded accounts with the right roles', async () => {
    for (const [role, acc] of Object.entries(DEMO_ACCOUNTS)) {
      const cookie = await login(app.base, acc.email, acc.password);
      assert.ok(cookie, `login failed for ${role}`);
      const me = await raw(app.base, 'GET', '/api/auth/me', { cookie });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.role, role);
    }
  });

  it('rejects a wrong password', async () => {
    const r = await raw(app.base, 'POST', '/api/auth/login', {
      body: { email: DEMO_ACCOUNTS.customer.email, password: 'wrong-password' },
    });
    assert.equal(r.status, 401);
  });

  it('logout invalidates the session', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    assert.equal((await raw(app.base, 'GET', '/api/auth/me', { cookie })).status, 200);
    await raw(app.base, 'POST', '/api/auth/logout', { cookie });
    const after = await raw(app.base, 'GET', '/api/auth/me', { cookie });
    assert.equal(after.status, 401);
  });
});

describe('profile updates', () => {
  it('updates name and email', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    const r = await raw(app.base, 'PATCH', '/api/me', {
      cookie,
      body: { name: 'Ada Updated', email: 'ada.new@example.com' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.name, 'Ada Updated');
    assert.equal(r.body.user.email, 'ada.new@example.com');
  });

  it('changes password only with the current one', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    const wrong = await raw(app.base, 'PATCH', '/api/me', {
      cookie,
      body: { currentPassword: 'nope', newPassword: 'brandnew1' },
    });
    assert.equal(wrong.status, 400);

    const ok = await raw(app.base, 'PATCH', '/api/me', {
      cookie,
      body: { currentPassword: DEMO_ACCOUNTS.customer.password, newPassword: 'brandnew1' },
    });
    assert.equal(ok.status, 200);

    // old password no longer works, new one does
    assert.equal(await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password), null);
    assert.ok(await login(app.base, DEMO_ACCOUNTS.customer.email, 'brandnew1'));
  });
});

describe('role guards', () => {
  it('requires authentication for account endpoints', async () => {
    assert.equal((await raw(app.base, 'GET', '/api/me/orders')).status, 401);
    assert.equal((await raw(app.base, 'GET', '/api/auth/me')).status, 401);
  });

  it('keeps customers out of staff and admin endpoints', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);
    assert.equal((await raw(app.base, 'GET', '/api/manage/orders', { cookie })).status, 403);
    assert.equal((await raw(app.base, 'GET', '/api/admin/users', { cookie })).status, 403);
    assert.equal((await raw(app.base, 'GET', '/api/admin/stats', { cookie })).status, 403);
  });

  it('keeps staff out of admin-only endpoints but allows staff desks', async () => {
    const cookie = await login(app.base, DEMO_ACCOUNTS.staff.email, DEMO_ACCOUNTS.staff.password);
    assert.equal((await raw(app.base, 'GET', '/api/admin/users', { cookie })).status, 403);
    assert.equal((await raw(app.base, 'GET', '/api/admin/stats', { cookie })).status, 403);
    assert.equal((await raw(app.base, 'GET', '/api/admin/categories', { cookie })).status, 403);
    assert.equal((await raw(app.base, 'GET', '/api/manage/orders', { cookie })).status, 200);
    assert.equal((await raw(app.base, 'GET', '/api/manage/products', { cookie })).status, 200);
  });
});