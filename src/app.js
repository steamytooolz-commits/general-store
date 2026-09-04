import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, seedIfEmpty } from './db.js';

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

class OrderError extends Error {}
class BodyError extends Error {}

/**
 * Build the HTTP server for the store. Uses only Node built-ins:
 * `node:http` for routing + static files, `node:sqlite` for storage.
 */
export function createApp({ db = openDb() } = {}) {
  seedIfEmpty(db);

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function handleApi(req, res, url) {
    const method = req.method;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return false;

    // GET /api/products
    if (method === 'GET' && parts[1] === 'products' && parts.length === 2) {
      const products = db.prepare('SELECT * FROM products ORDER BY id').all();
      sendJson(res, 200, products.map(toProductJson));
      return true;
    }

    // GET /api/products/:id
    if (method === 'GET' && parts[1] === 'products' && parts.length === 3) {
      const id = Number(parts[2]);
      const product = Number.isInteger(id)
        ? db.prepare('SELECT * FROM products WHERE id = ?').get(id)
        : undefined;
      if (!product) {
        sendJson(res, 404, { error: 'Product not found' });
        return true;
      }
      sendJson(res, 200, toProductJson(product));
      return true;
    }

    // POST /api/orders
    if (method === 'POST' && parts[1] === 'orders' && parts.length === 2) {
      const body = await readJsonBody(req);
      const { customer, items } = body ?? {};
      const name = customer?.name?.trim();
      const email = customer?.email?.trim();

      if (!name || !email) {
        sendJson(res, 400, { error: 'customer.name and customer.email are required' });
        return true;
      }
      if (!Array.isArray(items) || items.length === 0) {
        sendJson(res, 400, { error: 'items must be a non-empty array' });
        return true;
      }

      db.exec('BEGIN');
      try {
        const lines = [];
        let totalCents = 0;

        for (const item of items) {
          const productId = Number(item.productId);
          const quantity = Number(item.quantity);
          if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity <= 0) {
            throw new OrderError('Each item needs a positive integer productId and quantity');
          }
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
          if (!product) throw new OrderError(`Product ${productId} not found`);
          if (product.stock < quantity) {
            throw new OrderError(`Not enough stock for "${product.name}" (${product.stock} left)`);
          }
          lines.push({ product, quantity });
          totalCents += product.price_cents * quantity;
        }

        const info = db
          .prepare(`
            INSERT INTO orders (customer_name, customer_email, total_cents, status)
            VALUES (?, ?, ?, 'placed')
          `)
          .run(name, email, totalCents);
        const orderId = info.lastInsertRowid;

        const insertItem = db.prepare(`
          INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
          VALUES (?, ?, ?, ?)
        `);
        const decrement = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
        for (const { product, quantity } of lines) {
          insertItem.run(orderId, product.id, quantity, product.price_cents);
          decrement.run(quantity, product.id);
        }

        db.exec('COMMIT');
        sendJson(res, 201, getOrder(db, orderId));
      } catch (err) {
        db.exec('ROLLBACK');
        if (err instanceof OrderError) {
          sendJson(res, 400, { error: err.message });
          return true;
        }
        throw err;
      }
      return true;
    }

    // GET /api/orders/:id
    if (method === 'GET' && parts[1] === 'orders' && parts.length === 3) {
      const id = Number(parts[2]);
      const order = Number.isInteger(id) ? getOrder(db, id) : null;
      if (!order) {
        sendJson(res, 404, { error: 'Order not found' });
        return true;
      }
      sendJson(res, 200, order);
      return true;
    }

    return false;
  }

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
      const handled = await handleApi(req, res, url);
      if (handled) return;
      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      serveStatic(res, url);
    } catch (err) {
      if (err instanceof BodyError) {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });
}

// ---- Helpers --------------------------------------------------------------

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
        reject(new BodyError('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function toProductJson(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    stock: row.stock,
    createdAt: row.created_at,
  };
}

function getOrder(db, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;

  const items = db
    .prepare(`
      SELECT oi.*, p.name AS product_name
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
    `)
    .all(id);

  return {
    id: order.id,
    customer: { name: order.customer_name, email: order.customer_email },
    totalCents: order.total_cents,
    status: order.status,
    createdAt: order.created_at,
    items: items.map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
    })),
  };
}