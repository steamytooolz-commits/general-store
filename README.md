# General Store

[![CI](https://github.com/steamytooolz-commits/general-store/actions/workflows/ci.yml/badge.svg)](https://github.com/steamytooolz-commits/general-store/actions/workflows/ci.yml)

A full-featured online store with role-based dashboards for **customers**, **staff**, and **admins** — built with **zero dependencies** on Node.js built-ins only (`node:http`, `node:sqlite`, `node:test`). Nothing to install, and the SQLite database is unlimited, free, and survives restarts.

## Pages

| Route          | Audience  | What you can do |
| -------------- | --------- | --------------- |
| `/`            | Everyone  | Browse by category, search, sort, product details, cart (persists in localStorage), guest or account checkout |
| `/account.html`| Customers | Sign in / register, order history with status timeline, cancel orders, edit profile & password |
| `/staff.html`  | Staff     | Order queue with status filters, advance orders through lifecycle (with customer-visible notes & audit history), inventory CRUD + restocking |
| `/admin.html`  | Admin     | Dashboard overview (revenue KPIs, 14-day revenue chart, orders by status, top products, low-stock alerts), all orders, products, categories, user & role management |

## Demo accounts

Seeded automatically on first boot (shown on the sign-in page too):

| Role     | Email              | Password      |
| -------- | ------------------ | ------------- |
| Admin    | `admin@store.com`  | `admin123`    |
| Staff    | `staff@store.com`  | `staff123`    |
| Customer | `customer@store.com` | `customer123` |

The database ships with 12 products across 5 categories and ~2 weeks of deterministic demo orders, so every dashboard is populated on first run.

## Run

Requires Node.js ≥ 22.5.

```bash
npm start          # or: node --experimental-sqlite src/server.js
```

Then open <http://localhost:3000>.

## Test

```bash
npm test           # or: node --experimental-sqlite --test
```

43 tests cover auth & sessions, role guards, the catalog, checkout & stock, the order lifecycle with audit history, admin stats/categories/users, and restart persistence.

## Features

- **Auth** — register/login/logout with `scrypt`-hashed passwords, httpOnly session cookies, role-based access control on every endpoint
- **Orders** — checkout with shipping details, per-line price snapshots, transactional stock decrement (rollback on failure), statuses `placed → paid → shipped → delivered` (+ `cancelled`), full audit history per order
- **Customer** — owns orders privately, can cancel while `placed`/`paid`, guest orders link to accounts on sign-in
- **Staff** — processes the queue, restricted to valid transitions, notes recorded per change
- **Admin** — catalog + category CRUD (products with order history are soft-deactivated, never destroyed), user roles/disable with last-admin protection, revenue analytics
- **Database** — versioned additive migrations upgrade older `data/store.db` files in place; `DB_PATH` env var relocates it

## API overview

| Method | Path | Access |
| ------ | ---- | ------ |
| GET/POST | `/api/products`, `/api/products/:id`, `/api/categories` | Public |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Public |
| GET | `/api/auth/me`, `/api/me`, `/api/me/orders` | Signed in |
| PATCH | `/api/me` | Signed in |
| POST | `/api/orders`, `/api/me/orders/:id/cancel` | Public / owner |
| GET | `/api/orders/:id` | Owner, staff, admin |
| GET/PATCH | `/api/manage/orders`, `/api/manage/orders/:id`, `/api/manage/orders/:id/status` | Staff, admin |
| CRUD | `/api/manage/products` | Staff, admin |
| GET | `/api/admin/stats` | Admin |
| CRUD | `/api/admin/categories` | Admin |
| GET/PATCH | `/api/admin/users` | Admin |

## Configuration

| Variable  | Default         | Description          |
| --------- | --------------- | -------------------- |
| `PORT`    | `3000`          | HTTP port            |
| `DB_PATH` | `data/store.db` | SQLite file location |
