import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, seedIfEmpty, ORDER_STATUSES, ROLES, slugify } from './db.js';
import {
  parseCookies,
  sessionCookieHeader,
  clearCookieHeader,
  createSession,
  destroySession,
  userFromSession,
  hashPassword,
  verifyPassword,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Allowed order status transitions for staff updates. */
export const ALLOWED_TRANSITIONS = {
  placed: ['paid', 'shipped', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Thrown by handlers; converted to a JSON error response by the server. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class BodyError extends HttpError {}

function matchRoute(segs, parts) {
  if (segs.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.startsWith(':')) {
      try {
        params[seg.slice(1)] = decodeURIComponent(parts[i]);
      } catch {
        params[seg.slice(1)] = parts[i];
      }
    } else if (seg !== parts[i]) {
      return null;
    }
  }
  return params;
}

export function createApp({ db = openDb() } = {}) {
  seedIfEmpty(db);

  const routes = [];
  /** Register a route. roles === null means public; otherwise an allow-list. */
  const route = (method, pathname, roles, handler) => {
    routes.push({ method, segs: pathname.split('/').filter(Boolean), roles, handler });
  };

  // ---- Helpers -------------------------------------------------------------

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        if (data.trim() === '') {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new BodyError(400, 'Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  function userJson(row) {
    return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
  }

  function requireFields(body, fields) {
    for (const f of fields) {
      const v = body?.[f];
      if (v === undefined || v === null || String(v).trim() === '') {
        throw new HttpError(400, `${f} is required`);
      }
    }
  }

  function productSelect(extra) {
    return `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${extra ?? ''}
    `;
  }

  function toProductJson(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      priceCents: row.price_cents,
      imageUrl: row.image_url,
      stock: row.stock,
      active: row.active === 1,
      categoryId: row.category_id ?? null,
      categoryName: row.category_name ?? null,
      categorySlug: row.category_slug ?? null,
      createdAt: row.created_at,
    };
  }

  function orderLight(row) {
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      totalCents: row.total_cents,
      status: row.status,
      itemCount: row.item_count,
    };
  }

  function orderFull(id) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) return null;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
    const history = db
      .prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC, id ASC')
      .all(id);
    return {
      id: order.id,
      customer: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.phone || null,
      },
      shipping: {
        address: order.address,
        city: order.city,
        postalCode: order.postal_code || null,
        country: order.country || null,
      },
      totalCents: order.total_cents,
      status: order.status,
      note: order.note || null,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: items.map((i) => ({
        productId: i.product_id,
        productName: i.product_name,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        lineTotalCents: i.unit_price_cents * i.quantity,
      })),
      history: history.map((h) => ({
        status: h.status,
        note: h.note || null,
        changedBy: h.changed_by || null,
        createdAt: h.created_at,
      })),
    };
  }

  function listOrders({ status = null, q = null, userId = null }) {
    const where = [];
    const args = [];
    if (status) {
      where.push('status = ?');
      args.push(status);
    }
    if (userId !== null) {
      where.push('user_id = ?');
      args.push(userId);
    }
    if (q) {
      where.push('(customer_name LIKE ? OR customer_email LIKE ? OR CAST(id AS TEXT) = ?)');
      const like = `%${q}%`;
      args.push(like, like, q);
    }
    const sql = `
      SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY o.id DESC
      LIMIT 200
    `;
    return db.prepare(sql).all(...args).map(orderLight);
  }

  function insertHistory(orderId, status, note, changedBy) {
    db.prepare(`
      INSERT INTO order_status_history (order_id, status, note, changed_by)
      VALUES (?, ?, ?, ?)
    `).run(orderId, status, note ?? '', changedBy ?? '');
  }

  function setOrderStatus(orderId, status, note, changedBy) {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw new HttpError(400, `Cannot change an order from "${order.status}" to "${status}"`);
    }
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, orderId);
    insertHistory(orderId, status, note, changedBy);
    return orderFull(orderId);
  }

  // ---- Public: catalog ------------------------------------------------------

  route('GET', '/api/products', null, async (req, res, params, user, sp) => {
    const where = ['p.active = 1'];
    const args = [];
    const category = sp.get('category');
    if (category) {
      where.push('c.slug = ?');
      args.push(category);
    }
    const q = sp.get('q')?.trim();
    if (q) {
      where.push('(p.name LIKE ? OR p.description LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const sortBy = {
      newest: 'p.id DESC',
      name: 'p.name COLLATE NOCASE ASC',
      price_asc: 'p.price_cents ASC',
      price_desc: 'p.price_cents DESC',
    }[sp.get('sort')] ?? 'p.id DESC';
    const rows = db
      .prepare(productSelect(`WHERE ${where.join(' AND ')} ORDER BY ${sortBy}`))
      .all(...args);
    sendJson(res, 200, rows.map(toProductJson));
  });

  route('GET', '/api/products/:id', null, async (req, res, params) => {
    const id = Number(params.id);
    const row = Number.isInteger(id)
      ? db.prepare(productSelect('WHERE p.id = ? AND p.active = 1')).get(id)
      : undefined;
    if (!row) throw new HttpError(404, 'Product not found');
    sendJson(res, 200, toProductJson(row));
  });

  route('GET', '/api/categories', null, async (req, res) => {
    const rows = db
      .prepare(`
        SELECT c.*, COUNT(p.id) AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE ASC
      `)
      .all();
    sendJson(res, 200, rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, productCount: r.product_count })));
  });

  // ---- Public: auth ---------------------------------------------------------

  route('POST', '/api/auth/register', null, async (req, res) => {
    const body = await readJsonBody(req);
    const name = body?.name?.trim();
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;
    requireFields({ name, email, password }, ['name', 'email', 'password']);
    if (name.length > 120) throw new HttpError(400, 'Name is too long');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
    if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'An account with that email already exists');
    }
    const info = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, hashPassword(password), 'customer');
    const token = createSession(db, info.lastInsertRowid);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.setHeader('Set-Cookie', sessionCookieHeader(token));
    sendJson(res, 201, { user: userJson(user) });
  });

  route('POST', '/api/auth/login', null, async (req, res) => {
    const body = await readJsonBody(req);
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;
    requireFields({ email, password }, ['email', 'password']);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    if (user.active !== 1) throw new HttpError(403, 'This account has been disabled');
    const token = createSession(db, user.id);
    res.setHeader('Set-Cookie', sessionCookieHeader(token));
    sendJson(res, 200, { user: userJson(user) });
  });

  route('POST', '/api/auth/logout', null, async (req, res) => {
    const cookies = parseCookies(req);
    destroySession(db, cookies.sid);
    res.setHeader('Set-Cookie', clearCookieHeader());
    sendJson(res, 200, { ok: true });
  });

  const AUTH_ROLES = ['customer', 'staff', 'admin'];

  route('GET', '/api/auth/me', AUTH_ROLES, async (req, res, params, user) => {
    sendJson(res, 200, { user: userJson(user) });
  });

  // ---- Customer: account + orders ------------------------------------------

  route('GET', '/api/me', AUTH_ROLES, async (req, res, params, user) => {
    sendJson(res, 200, { user: userJson(user) });
  });

  route('PATCH', '/api/me', AUTH_ROLES, async (req, res, params, user) => {
    const body = await readJsonBody(req);
    const updates = [];
    const args = [];
    const name = body?.name?.trim();
    if (name !== undefined) {
      if (!name) throw new HttpError(400, 'Name cannot be empty');
      if (name.length > 120) throw new HttpError(400, 'Name is too long');
      updates.push('name = ?');
      args.push(name);
    }
    const email = body?.email?.trim().toLowerCase();
    if (email !== undefined) {
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
      const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, user.id);
      if (clash) throw new HttpError(409, 'That email is already in use');
      updates.push('email = ?');
      args.push(email);
    }
    const newPassword = body?.newPassword;
    if (newPassword !== undefined) {
      if (String(newPassword).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
      const current = body?.currentPassword;
      if (!current || !verifyPassword(current, user.password_hash)) {
        throw new HttpError(400, 'Current password is incorrect');
      }
      updates.push('password_hash = ?');
      args.push(hashPassword(newPassword));
    }
    if (updates.length === 0) throw new HttpError(400, 'Nothing to update');
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...args, user.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    sendJson(res, 200, { user: userJson(fresh) });
  });

  route('GET', '/api/me/orders', AUTH_ROLES, async (req, res, params, user) => {
    sendJson(res, 200, listOrders({ userId: user.id }));
  });

  route('POST', '/api/me/orders/:id/cancel', AUTH_ROLES, async (req, res, params, user) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.user_id !== user.id) throw new HttpError(403, 'That order does not belong to you');
    if (!['placed', 'paid'].includes(order.status)) {
      throw new HttpError(400, `Order "${order.status}" can no longer be cancelled`);
    }
    const updated = setOrderStatus(order.id, 'cancelled', 'Cancelled by customer', user.name);
    sendJson(res, 200, updated);
  });

  // ---- Checkout (public, but links to account when signed in) ---------------

  route('POST', '/api/orders', null, async (req, res, params, user) => {
    const body = await readJsonBody(req);
    const customer = body?.customer ?? {};
    const name = customer.name?.trim();
    const email = customer.email?.trim().toLowerCase();
    requireFields(customer, ['name', 'email', 'address', 'city']);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
    const phone = String(customer.phone ?? '').trim();
    const postalCode = String(customer.postalCode ?? '').trim();
    const country = String(customer.country ?? '').trim();
    const note = String(body?.note ?? '').trim().slice(0, 500);

    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, 'items must be a non-empty array');
    }

    const createOrder = () => {
      const lines = [];
      let totalCents = 0;
      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);
        if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
          throw new HttpError(400, 'Each item needs a positive integer productId and quantity');
        }
        const product = db
          .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
          .get(productId);
        if (!product) throw new HttpError(400, `Product ${productId} is not available`);
        if (product.stock < quantity) {
          throw new HttpError(400, `Not enough stock for "${product.name}" (${product.stock} left)`);
        }
        lines.push({ product, quantity });
        totalCents += product.price_cents * quantity;
      }

      const info = db
        .prepare(`
          INSERT INTO orders (user_id, customer_name, customer_email, phone, address, city, postal_code, country,
                              total_cents, status, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'placed', ?, datetime('now'), datetime('now'))
        `)
        .run(user?.id ?? null, name, email, phone, customer.address.trim(), customer.city.trim(), postalCode, country, totalCents, note);
      const orderId = info.lastInsertRowid;

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents)
        VALUES (?, ?, ?, ?, ?)
      `);
      const decrement = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
      for (const { product, quantity } of lines) {
        insertItem.run(orderId, product.id, product.name, quantity, product.price_cents);
        decrement.run(quantity, product.id);
      }
      insertHistory(orderId, 'placed', 'Order placed', user?.name ?? name);
      return orderFull(orderId);
    };

    let order;
    db.exec('BEGIN');
    try {
      order = createOrder();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    sendJson(res, 201, order);
  });

  route('GET', '/api/orders/:id', AUTH_ROLES, async (req, res, params, user) => {
    const order = orderFull(Number(params.id));
    if (!order) throw new HttpError(404, 'Order not found');
    const isStaff = user.role === 'staff' || user.role === 'admin';
    const owner = db.prepare('SELECT user_id FROM orders WHERE id = ?').get(order.id)?.user_id;
    if (!isStaff && owner !== user.id) throw new HttpError(403, 'You do not have permission to view that order');
    sendJson(res, 200, order);
  });

  // ---- Staff/Admin: order management ----------------------------------------

  const STAFF_ROLES = ['staff', 'admin'];

  route('GET', '/api/manage/orders', STAFF_ROLES, async (req, res, params, user, sp) => {
    const status = sp.get('status') ?? null;
    if (status && !ORDER_STATUSES.includes(status)) {
      throw new HttpError(400, `Unknown status "${status}"`);
    }
    sendJson(res, 200, listOrders({ status, q: sp.get('q')?.trim() || null }));
  });

  route('GET', '/api/manage/orders/:id', STAFF_ROLES, async (req, res, params) => {
    const order = orderFull(Number(params.id));
    if (!order) throw new HttpError(404, 'Order not found');
    sendJson(res, 200, order);
  });

  route('PATCH', '/api/manage/orders/:id/status', STAFF_ROLES, async (req, res, params, user) => {
    const body = await readJsonBody(req);
    const status = body?.status;
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, `Unknown status "${status}"`);
    const note = String(body?.note ?? '').trim().slice(0, 500);
    const order = setOrderStatus(Number(params.id), status, note || null, user.name);
    sendJson(res, 200, order);
  });

  // ---- Staff/Admin: product management --------------------------------------

  route('GET', '/api/manage/products', STAFF_ROLES, async (req, res, params, user, sp) => {
    const where = [];
    const args = [];
    const q = sp.get('q')?.trim();
    if (q) {
      where.push('(p.name LIKE ? OR p.description LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const sql = productSelect(where.length ? `WHERE ${where.join(' AND ')} ORDER BY p.id DESC` : 'ORDER BY p.id DESC');
    const rows = db.prepare(sql).all(...args);
    sendJson(res, 200, rows.map(toProductJson));
  });

  function parseProductFields(body, { partial }) {
    const out = {};
    const name = body?.name?.trim();
    if (name !== undefined || !partial) {
      if (!name) throw new HttpError(400, 'name is required');
      if (name.length > 120) throw new HttpError(400, 'Name is too long');
      out.name = name;
    }
    const description = body?.description?.trim();
    if (description !== undefined || !partial) {
      if (String(description).length > 2000) throw new HttpError(400, 'Description is too long');
      out.description = description ?? '';
    }
    const priceCents = body?.priceCents;
    if (priceCents !== undefined || !partial) {
      if (!Number.isInteger(priceCents) || priceCents <= 0) throw new HttpError(400, 'priceCents must be a positive integer');
      out.priceCents = priceCents;
    }
    const stock = body?.stock;
    if (stock !== undefined || !partial) {
      if (!Number.isInteger(stock) || stock < 0) throw new HttpError(400, 'stock must be a non-negative integer');
      out.stock = stock;
    }
    const imageUrl = body?.imageUrl;
    if (imageUrl !== undefined || !partial) {
      if (String(imageUrl).length > 1000) throw new HttpError(400, 'imageUrl is too long');
      out.imageUrl = imageUrl ?? '';
    }
    if ('categoryId' in body || !partial) {
      const categoryId = body?.categoryId;
      if (categoryId === null || categoryId === '' || categoryId === undefined) {
        out.categoryId = null;
      } else if (Number.isInteger(categoryId)) {
        if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) {
          throw new HttpError(400, 'That category does not exist');
        }
        out.categoryId = categoryId;
      } else {
        throw new HttpError(400, 'categoryId must be an integer or null');
      }
    }
    if ('active' in body || !partial) {
      out.active = body?.active === undefined ? 1 : body.active ? 1 : 0;
    }
    return out;
  }

  route('POST', '/api/manage/products', STAFF_ROLES, async (req, res) => {
    const body = await readJsonBody(req);
    const fields = parseProductFields(body, { partial: false });
    const info = db
      .prepare(`
        INSERT INTO products (name, description, price_cents, image_url, stock, category_id, active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(fields.name, fields.description, fields.priceCents, fields.imageUrl, fields.stock, fields.categoryId, fields.active);
    const row = db.prepare(productSelect('WHERE p.id = ?')).get(info.lastInsertRowid);
    sendJson(res, 201, toProductJson(row));
  });

  route('PUT', '/api/manage/products/:id', STAFF_ROLES, async (req, res, params) => {
    const id = Number(params.id);
    const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Product not found');
    const body = await readJsonBody(req);
    const fields = parseProductFields(body, { partial: true });
    const sets = [];
    const args = [];
    for (const [key, col] of [
      ['name', 'name'],
      ['description', 'description'],
      ['priceCents', 'price_cents'],
      ['stock', 'stock'],
      ['imageUrl', 'image_url'],
      ['categoryId', 'category_id'],
      ['active', 'active'],
    ]) {
      if (fields[key] !== undefined) {
        sets.push(`${col} = ?`);
        args.push(fields[key]);
      }
    }
    if (sets.length === 0) throw new HttpError(400, 'Nothing to update');
    db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const row = db.prepare(productSelect('WHERE p.id = ?')).get(id);
    sendJson(res, 200, toProductJson(row));
  });

  route('DELETE', '/api/manage/products/:id', STAFF_ROLES, async (req, res, params) => {
    const id = Number(params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Product not found');
    const refs = db.prepare('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?').get(id).count;
    if (refs > 0) {
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      sendJson(res, 200, { ok: true, deleted: false, message: 'Product has past orders, so it was deactivated instead of deleted' });
    } else {
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
      sendJson(res, 200, { ok: true, deleted: true });
    }
  });

  // ---- Admin: categories -----------------------------------------------------

  const ADMIN_ROLES = ['admin'];

  route('GET', '/api/admin/categories', ADMIN_ROLES, async (req, res) => {
    const rows = db
      .prepare(`
        SELECT c.*, COUNT(p.id) AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE ASC
      `)
      .all();
    sendJson(res, 200, rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, productCount: r.product_count })));
  });

  async function readCategoryName(req) {
    const body = await readJsonBody(req);
    const name = body?.name?.trim();
    if (!name) throw new HttpError(400, 'name is required');
    if (name.length > 80) throw new HttpError(400, 'Name is too long');
    return name;
  }

  route('POST', '/api/admin/categories', ADMIN_ROLES, async (req, res) => {
    const name = await readCategoryName(req);
    const slug = slugify(name);
    if (db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug)) {
      throw new HttpError(409, 'A category with that name already exists');
    }
    const info = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, slug);
    sendJson(res, 201, { id: info.lastInsertRowid, name, slug, productCount: 0 });
  });

  route('PUT', '/api/admin/categories/:id', ADMIN_ROLES, async (req, res, params) => {
    const id = Number(params.id);
    if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(id)) {
      throw new HttpError(404, 'Category not found');
    }
    const name = await readCategoryName(req);
    const slug = slugify(name);
    const clash = db.prepare('SELECT id FROM categories WHERE slug = ? AND id != ?').get(slug, id);
    if (clash) throw new HttpError(409, 'A category with that name already exists');
    db.prepare('UPDATE categories SET name = ?, slug = ? WHERE id = ?').run(name, slug, id);
    sendJson(res, 200, { id, name, slug });
  });

  route('DELETE', '/api/admin/categories/:id', ADMIN_ROLES, async (req, res, params) => {
    const id = Number(params.id);
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Category not found');
    db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    sendJson(res, 200, { ok: true });
  });

  // ---- Admin: users ----------------------------------------------------------

  route('GET', '/api/admin/users', ADMIN_ROLES, async (req, res) => {
    const rows = db
      .prepare(`
        SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
        FROM users u
        ORDER BY u.id ASC
      `)
      .all();
    sendJson(res, 200, rows.map((r) => ({ ...userJson(r), active: r.active === 1, orderCount: r.order_count })));
  });

  route('PATCH', '/api/admin/users/:id', ADMIN_ROLES, async (req, res, params, user) => {
    const id = Number(params.id);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw new HttpError(404, 'User not found');
    const body = await readJsonBody(req);
    if (id === user.id && ('role' in body || 'active' in body)) {
      throw new HttpError(400, 'You cannot change your own role or status');
    }
    const sets = [];
    const args = [];
    if ('role' in body) {
      if (!ROLES.includes(body.role)) throw new HttpError(400, `role must be one of ${ROLES.join(', ')}`);
      sets.push('role = ?');
      args.push(body.role);
    }
    if ('active' in body) {
      if (typeof body.active !== 'boolean') throw new HttpError(400, 'active must be a boolean');
      sets.push('active = ?');
      args.push(body.active ? 1 : 0);
    }
    const isAdminNow = target.role === 'admin' && target.active === 1;
    const willLoseAdmin = isAdminNow && (('role' in body && body.role !== 'admin') || ('active' in body && !body.active));
    if (willLoseAdmin) {
      const otherAdmins = db
        .prepare('SELECT COUNT(*) AS count FROM users WHERE role = ? AND active = 1 AND id != ?')
        .get('admin', id).count;
      if (otherAdmins === 0) throw new HttpError(400, 'Cannot remove the last active admin');
    }
    if (sets.length === 0) throw new HttpError(400, 'Nothing to update');
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    sendJson(res, 200, { ...userJson(fresh), active: fresh.active === 1 });
  });

  // ---- Admin: dashboard stats ------------------------------------------------

  route('GET', '/api/admin/stats', ADMIN_ROLES, async (req, res) => {
    const totals = {
      revenueCents: db.prepare("SELECT COALESCE(SUM(total_cents), 0) AS s FROM orders WHERE status != 'cancelled'").get().s,
      revenue30dCents: db
        .prepare("SELECT COALESCE(SUM(total_cents), 0) AS s FROM orders WHERE status != 'cancelled' AND created_at >= datetime('now', '-30 days')")
        .get().s,
      orders: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
      ordersToday: db.prepare("SELECT COUNT(*) AS c FROM orders WHERE created_at >= datetime('now', 'start of day')").get().c,
      customers: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'customer' AND active = 1").get().c,
      activeProducts: db.prepare('SELECT COUNT(*) AS c FROM products WHERE active = 1').get().c,
      lowStock: db.prepare('SELECT COUNT(*) AS c FROM products WHERE active = 1 AND stock <= 5').get().c,
    };

    const byStatus = {};
    for (const status of ORDER_STATUSES) {
      byStatus[status] = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE status = ?').get(status).c;
    }

    const days = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const dayRows = db
      .prepare(`
        SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(total_cents), 0) AS cents
        FROM orders
        WHERE status != 'cancelled' AND created_at >= datetime('now', '-13 days')
        GROUP BY day
      `)
      .all();
    const dayMap = new Map(dayRows.map((r) => [r.day, r.cents]));
    const revenueByDay = days.map((day) => ({ day, cents: dayMap.get(day) ?? 0 }));

    const topProducts = db
      .prepare(`
        SELECT p.name, SUM(oi.quantity) AS units, SUM(oi.unit_price_cents * oi.quantity) AS revenueCents
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.status != 'cancelled'
        GROUP BY p.id
        ORDER BY revenueCents DESC
        LIMIT 5
      `)
      .all();

    const lowStockProducts = db
      .prepare('SELECT id, name, stock FROM products WHERE active = 1 AND stock <= 5 ORDER BY stock ASC')
      .all();

    sendJson(res, 200, {
      totals,
      ordersByStatus: byStatus,
      revenueByDay,
      topProducts,
      lowStockProducts,
      recentOrders: listOrders({}).slice(0, 6),
    });
  });

  // ---- Static files + fallbacks ----------------------------------------------

  function serveStatic(res, url) {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
      res.end(data);
    });
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const cookies = parseCookies(req);
      const user = cookies.sid ? userFromSession(db, cookies.sid) : null;

      for (const r of routes) {
        if (req.method !== r.method) continue;
        const params = matchRoute(r.segs, parts);
        if (!params) continue;
        if (r.roles) {
          if (!user) throw new HttpError(401, 'Authentication required');
          if (!r.roles.includes(user.role)) {
            throw new HttpError(403, 'You do not have permission to do that');
          }
        }
        await r.handler(req, res, params, user, url.searchParams);
        return;
      }

      if (parts[0] === 'api') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      serveStatic(res, url);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}