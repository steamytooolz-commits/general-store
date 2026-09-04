# General Store

[![CI](https://github.com/steamytooolz-commits/general-store/actions/workflows/ci.yml/badge.svg)](https://github.com/steamytooolz-commits/general-store/actions/workflows/ci.yml)

A small, self-contained online store: a REST API plus a vanilla JS storefront, backed by a persistent SQLite database.

**Zero dependencies** — the app uses only Node.js built-ins (`node:http`, `node:sqlite`, `node:test`), so there is nothing to install.

- **Database**: SQLite via Node's built-in `node:sqlite` — unlimited, free, file-based, and survives restarts. Data lives in `data/store.db`.
- **API**: REST endpoints under `/api` for products and orders.
- **Storefront**: static HTML/CSS/JS served from `public/`.
- **Tests**: Node's built-in test runner, run automatically in CI via GitHub Actions.

## Requirements

Node.js ≥ 22.5 (for the built-in `node:sqlite` module).

## Run locally

```bash
npm start          # or: node --experimental-sqlite src/server.js
```

Then open <http://localhost:3000>.

## Test

```bash
npm test           # or: node --experimental-sqlite --test test/
```

## API

| Method | Path              | Description                                  |
| ------ | ----------------- | -------------------------------------------- |
| GET    | `/api/products`   | List all products                            |
| GET    | `/api/products/:id` | Get one product                            |
| POST   | `/api/orders`     | Place an order (validates stock, decrements) |
| GET    | `/api/orders/:id` | Get an order with its line items             |

### Place an order

```json
POST /api/orders
{
  "customer": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "items": [{ "productId": 1, "quantity": 2 }]
}
```

## Configuration

| Variable  | Default         | Description          |
| --------- | --------------- | -------------------- |
| `PORT`    | `3000`          | HTTP port            |
| `DB_PATH` | `data/store.db` | SQLite file location |