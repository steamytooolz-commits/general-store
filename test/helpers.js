import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';

/** Boot a fresh in-memory app on an ephemeral port. */
export async function startApp() {
  const db = openDb(':memory:');
  const server = createApp({ db });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base };
}

export async function stopApp(app) {
  await new Promise((resolve) => app.server.close(resolve));
  app.db.close();
}

/** fetch helper that can pass a raw Cookie header and returns set-cookie. */
export async function raw(base, method, pathname, { body, cookie } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, body: data, setCookie: res.headers.get('set-cookie') };
}

/** Log in and return the session cookie for authenticated requests. */
export async function login(base, email, password) {
  const r = await raw(base, 'POST', '/api/auth/login', { body: { email, password } });
  return r.setCookie ? r.setCookie.split(';')[0] : null;
}

export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@store.com', password: 'admin123' },
  staff: { email: 'staff@store.com', password: 'staff123' },
  customer: { email: 'customer@store.com', password: 'customer123' },
};

export const VALID_SHIPPING = {
  name: 'Grace Hopper',
  email: 'grace@example.com',
  address: '1 Admiral Road',
  city: 'Arlington',
  postalCode: '22201',
  country: 'US',
  phone: '555-0102',
};