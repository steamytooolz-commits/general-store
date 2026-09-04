import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default location of the SQLite data file (override with DB_PATH). */
export const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'store.db');

/** Order statuses used across the app. */
export const ORDER_STATUSES = ['placed', 'paid', 'shipped', 'delivered', 'cancelled'];

/** Roles used across the app. */
export const ROLES = ['customer', 'staff', 'admin'];

/**
 * Open (and if needed create) the SQLite database and run migrations.
 * Pass ':memory:' for tests. Data is stored on disk, so it survives restarts.
 */
export function openDb(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedIfEmpty(db);
  return db;
}

function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

/**
 * Versioned-ish, additive migration: creates missing tables and adds missing
 * columns, so databases created by earlier versions upgrade in place.
 */
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      slug       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      image_url   TEXT NOT NULL DEFAULT '',
      stock       INTEGER NOT NULL DEFAULT 0,
      category_id INTEGER,
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER,
      customer_name  TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      phone          TEXT NOT NULL DEFAULT '',
      address        TEXT NOT NULL DEFAULT '',
      city           TEXT NOT NULL DEFAULT '',
      postal_code    TEXT NOT NULL DEFAULT '',
      country        TEXT NOT NULL DEFAULT '',
      total_cents    INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'placed',
      note           TEXT NOT NULL DEFAULT '',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id         INTEGER NOT NULL REFERENCES orders(id),
      product_id       INTEGER NOT NULL REFERENCES products(id),
      product_name     TEXT NOT NULL DEFAULT '',
      quantity         INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES orders(id),
      status     TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      changed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // --- Additive upgrades for databases created by v1 ---------------------
  if (!hasColumn(db, 'products', 'category_id')) {
    db.exec('ALTER TABLE products ADD COLUMN category_id INTEGER');
  }
  if (!hasColumn(db, 'products', 'active')) {
    db.exec("ALTER TABLE products ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }
  if (!hasColumn(db, 'orders', 'user_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN user_id INTEGER');
  }
  for (const col of ['phone', 'address', 'city', 'postal_code', 'country', 'note']) {
    if (!hasColumn(db, 'orders', col)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
  }
  if (!hasColumn(db, 'orders', 'updated_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN updated_at TEXT');
    db.exec('UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL');
  }
  if (!hasColumn(db, 'order_items', 'product_name')) {
    db.exec("ALTER TABLE order_items ADD COLUMN product_name TEXT NOT NULL DEFAULT ''");
    db.exec(`
      UPDATE order_items
      SET product_name = (SELECT p.name FROM products p WHERE p.id = order_items.product_id)
      WHERE product_name = ''
    `);
  }
}

// ---- Seed data ------------------------------------------------------------

export const SEED_USERS = [
  { name: 'Store Admin', email: 'admin@store.com', password: 'admin123', role: 'admin' },
  { name: 'Maria Staff', email: 'staff@store.com', password: 'staff123', role: 'staff' },
  { name: 'Demo Customer', email: 'customer@store.com', password: 'customer123', role: 'customer' },
  { name: 'Sam Shopper', email: 'sam@example.com', password: 'customer123', role: 'customer' },
  { name: 'Jordan Buyer', email: 'jordan@example.com', password: 'customer123', role: 'customer' },
];

export const SEED_CATEGORIES = ['Home & Kitchen', 'Accessories', 'Electronics', 'Stationery', 'Plants'];

export const SEED_PRODUCTS = [
  { name: 'Ceramic Coffee Mug', category: 'Home & Kitchen', description: 'Hand-glazed 350ml mug. Dishwasher safe, personality included.', priceCents: 1499, imageUrl: 'https://picsum.photos/seed/mug/480/360', stock: 25 },
  { name: 'Canvas Tote Bag', category: 'Accessories', description: 'Sturdy natural canvas tote that fits a laptop and a lunch.', priceCents: 1999, imageUrl: 'https://picsum.photos/seed/tote/480/360', stock: 40 },
  { name: 'Stainless Water Bottle', category: 'Home & Kitchen', description: '750ml insulated bottle. Keeps drinks cold for 24 hours.', priceCents: 2499, imageUrl: 'https://picsum.photos/seed/bottle/480/360', stock: 30 },
  { name: 'Desk Plant — Pothos', category: 'Plants', description: 'Low-maintenance pothos in a terracotta pot. Hard to kill, easy to love.', priceCents: 1799, imageUrl: 'https://picsum.photos/seed/plant/480/360', stock: 12 },
  { name: 'Wireless Mouse', category: 'Electronics', description: 'Silent-click ergonomic mouse with an 18-month battery life.', priceCents: 2999, imageUrl: 'https://picsum.photos/seed/mouse/480/360', stock: 20 },
  { name: 'A5 Linen Notebook', category: 'Stationery', description: '192 pages of dot-grid paper with a linen cover and lay-flat spine.', priceCents: 1299, imageUrl: 'https://picsum.photos/seed/notebook/480/360', stock: 50 },
  { name: 'Scented Soy Candle', category: 'Home & Kitchen', description: '40h burn time, cedar & amber. Hand-poured soy wax in a glass jar.', priceCents: 1699, imageUrl: 'https://picsum.photos/seed/candle/480/360', stock: 6 },
  { name: 'Canvas Sneakers', category: 'Accessories', description: 'Low-top sneakers with cushioned insole. Runs true to size.', priceCents: 5499, imageUrl: 'https://picsum.photos/seed/sneakers/480/360', stock: 10 },
  { name: 'Bluetooth Speaker', category: 'Electronics', description: 'Waterproof 10W speaker with 12h playtime and rich bass.', priceCents: 3999, imageUrl: 'https://picsum.photos/seed/speaker/480/360', stock: 15 },
  { name: 'Brass Pen', category: 'Stationery', description: 'Machined brass rollerball with refillable ink cartridge.', priceCents: 899, imageUrl: 'https://picsum.photos/seed/pen/480/360', stock: 60 },
  { name: 'Ceramic Planter Set', category: 'Plants', description: 'Set of two matte ceramic planters with drainage trays.', priceCents: 2299, imageUrl: 'https://picsum.photos/seed/planter/480/360', stock: 6 },
  { name: 'Linen Throw Pillow', category: 'Home & Kitchen', description: 'Stonewashed linen cushion cover with feather insert, 45cm.', priceCents: 3299, imageUrl: 'https://picsum.photos/seed/pillow/480/360', stock: 14 },
];

/**
 * A deterministic demo order history so dashboards have realistic data on a
 * fresh database. Each entry references a seed user by email and products by
 * name; `h` is the number of hours before "now" the order was created.
 */
const DEMO_ORDERS = [
  { email: 'customer@store.com', h: 2, status: 'placed', items: [['Ceramic Coffee Mug', 2], ['A5 Linen Notebook', 1]] },
  { email: 'customer@store.com', h: 20, status: 'paid', items: [['Canvas Tote Bag', 1], ['Bluetooth Speaker', 1]] },
  { email: 'sam@example.com', h: 26, status: 'paid', items: [['Stainless Water Bottle', 2]] },
  { email: 'jordan@example.com', h: 30, status: 'shipped', items: [['Wireless Mouse', 1], ['Brass Pen', 3]] },
  { email: 'customer@store.com', h: 30, status: 'shipped', items: [['Desk Plant — Pothos', 1], ['Ceramic Planter Set', 1]] },
  { email: 'sam@example.com', h: 160, status: 'delivered', items: [['Scented Soy Candle', 2]] },
  { email: 'jordan@example.com', h: 210, status: 'delivered', items: [['Canvas Sneakers', 1], ['Linen Throw Pillow', 2]] },
  { email: 'customer@store.com', h: 290, status: 'delivered', items: [['Stainless Water Bottle', 1], ['A5 Linen Notebook', 2]] },
  { email: 'sam@example.com', h: 120, status: 'delivered', items: [['Desk Plant — Pothos', 2]] },
  { email: 'customer@store.com', h: 45, status: 'cancelled', items: [['Wireless Mouse', 1]], cancelNote: 'Customer requested cancellation' },
  { email: 'jordan@example.com', h: 80, status: 'cancelled', items: [['Canvas Tote Bag', 1]], cancelNote: 'Payment declined by gateway' },
];

const SEED_ADDRESSES = [
  { address: '123 Main Street', city: 'Springfield', postalCode: '12345', country: 'US', phone: '555-0100' },
  { address: '45 Oak Avenue', city: 'Rivertown', postalCode: '67890', country: 'US', phone: '555-0134' },
  { address: '8 Maple Court', city: 'Lakeside', postalCode: '11223', country: 'CA', phone: '555-0177' },
  { address: '7 Sunset Boulevard', city: 'Hillcrest', postalCode: '44556', country: 'US', phone: '555-0122' },
];

const STAGE_PLAN = {
  placed: [{ status: 'placed', off: 0, by: 'Store Admin', note: 'Order placed by customer' }],
  paid: [
    { status: 'placed', off: 0, by: 'Store Admin', note: 'Order placed by customer' },
    { status: 'paid', off: 5, by: 'Store Admin', note: 'Payment confirmed' },
  ],
  shipped: [
    { status: 'placed', off: 0, by: 'Store Admin', note: 'Order placed by customer' },
    { status: 'paid', off: 5, by: 'Store Admin', note: 'Payment confirmed' },
    { status: 'shipped', off: 10, by: 'Maria Staff', note: 'Handed to carrier' },
  ],
  delivered: [
    { status: 'placed', off: 0, by: 'Store Admin', note: 'Order placed by customer' },
    { status: 'paid', off: 5, by: 'Store Admin', note: 'Payment confirmed' },
    { status: 'shipped', off: 10, by: 'Maria Staff', note: 'Handed to carrier' },
    { status: 'delivered', off: 15, by: 'Maria Staff', note: 'Order delivered' },
  ],
  cancelled: [
    { status: 'placed', off: 0, by: 'Store Admin', note: 'Order placed by customer' },
  ],
};

export function seedIfEmpty(db) {
  seedUsers(db);
  seedCategories(db);
  seedProducts(db);
  seedDemoOrders(db);
}

function withTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seedUsers(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  withTransaction(db, () => {
    for (const u of SEED_USERS) {
      insert.run(u.name, u.email, hashPassword(u.password), u.role);
    }
  });
}

function seedCategories(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM categories').get();
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)');
  withTransaction(db, () => {
    for (const name of SEED_CATEGORIES) {
      insert.run(name, slugify(name));
    }
  });
}

function seedProducts(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count > 0) return;
  const catId = db.prepare('SELECT id FROM categories WHERE name = ?');
  const insert = db.prepare(`
    INSERT INTO products (name, description, price_cents, image_url, stock, category_id, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  withTransaction(db, () => {
    for (const p of SEED_PRODUCTS) {
      const cat = catId.get(p.category);
      insert.run(p.name, p.description, p.priceCents, p.imageUrl, p.stock, cat ? cat.id : null);
    }
  });
}

function seedDemoOrders(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM orders').get();
  if (count > 0) return;

  const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const productByName = db.prepare('SELECT * FROM products WHERE name = ?');
  const insertOrder = db.prepare(`
    INSERT INTO orders (user_id, customer_name, customer_email, phone, address, city, postal_code, country,
                        total_cents, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertHistory = db.prepare(`
    INSERT INTO order_status_history (order_id, status, note, changed_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = () => withTransaction(db, () => {
    DEMO_ORDERS.forEach((def, idx) => {
      const user = userByEmail.get(def.email);
      if (!user) throw new Error(`Seed user missing: ${def.email}`);
      const lines = def.items.map(([name, qty]) => {
        const p = productByName.get(name);
        if (!p) throw new Error(`Seed product missing: ${name}`);
        return { product: p, qty };
      });
      const totalCents = lines.reduce((sum, { product, qty }) => sum + product.price_cents * qty, 0);
      const addr = SEED_ADDRESSES[idx % SEED_ADDRESSES.length];

      const stages = STAGE_PLAN[def.status].map((s, i) =>
        def.status === 'cancelled' && i === 1
          ? { status: 'cancelled', off: Math.floor(def.h * 0.7), by: 'Maria Staff', note: def.cancelNote }
          : s
      );
      // Timestamps must stay strictly increasing and never in the future.
      let prevOff = -1;
      const cleanStages = stages.filter((s) => {
        const ok = s.off < def.h && s.off > prevOff;
        if (ok) prevOff = s.off;
        return ok;
      });
      const lastOff = cleanStages.length ? cleanStages[cleanStages.length - 1].off : 0;
      const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

      const info = insertOrder.run(
        user.id,
        user.name,
        user.email,
        addr.phone,
        addr.address,
        addr.city,
        addr.postalCode,
        addr.country,
        totalCents,
        def.status,
        hoursAgo(def.h),
        hoursAgo(def.h - lastOff)
      );
      const orderId = info.lastInsertRowid;

      for (const { product, qty } of lines) {
        insertItem.run(orderId, product.id, product.name, qty, product.price_cents);
        if (def.status !== 'cancelled') {
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, product.id);
        }
      }
      for (const stage of cleanStages) {
        insertHistory.run(orderId, stage.status, stage.note, stage.by, hoursAgo(def.h - stage.off));
      }
    });
  });
  tx();
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}