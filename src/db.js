import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default location of the SQLite data file (override with DB_PATH). */
export const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'store.db');

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
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      image_url   TEXT NOT NULL DEFAULT '',
      stock       INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name  TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      total_cents    INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'placed',
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id         INTEGER NOT NULL REFERENCES orders(id),
      product_id       INTEGER NOT NULL REFERENCES products(id),
      quantity         INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL
    );
  `);
}

export const SEED_PRODUCTS = [
  {
    name: 'Ceramic Coffee Mug',
    description: 'Hand-glazed 350ml mug. Dishwasher safe, personality included.',
    priceCents: 1499,
    imageUrl: 'https://picsum.photos/seed/mug/480/360',
    stock: 25,
  },
  {
    name: 'Canvas Tote Bag',
    description: 'Sturdy natural canvas tote that fits a laptop and a lunch.',
    priceCents: 1999,
    imageUrl: 'https://picsum.photos/seed/tote/480/360',
    stock: 40,
  },
  {
    name: 'Stainless Water Bottle',
    description: '750ml insulated bottle. Keeps drinks cold for 24 hours.',
    priceCents: 2499,
    imageUrl: 'https://picsum.photos/seed/bottle/480/360',
    stock: 30,
  },
  {
    name: 'Desk Plant — Pothos',
    description: 'Low-maintenance pothos in a terracotta pot. Hard to kill, easy to love.',
    priceCents: 1799,
    imageUrl: 'https://picsum.photos/seed/plant/480/360',
    stock: 12,
  },
  {
    name: 'Wireless Mouse',
    description: 'Silent-click ergonomic mouse with an 18-month battery life.',
    priceCents: 2999,
    imageUrl: 'https://picsum.photos/seed/mouse/480/360',
    stock: 20,
  },
  {
    name: 'A5 Linen Notebook',
    description: '192 pages of dot-grid paper with a linen cover and lay-flat spine.',
    priceCents: 1299,
    imageUrl: 'https://picsum.photos/seed/notebook/480/360',
    stock: 50,
  },
];

/** Seed the catalog if the products table is empty. */
export function seedIfEmpty(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO products (name, description, price_cents, image_url, stock)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const p of SEED_PRODUCTS) {
      insert.run(p.name, p.description, p.priceCents, p.imageUrl, p.stock);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}