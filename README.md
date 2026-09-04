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

## Deploy: Oracle Cloud Always Free (durable, $0)

A free-tier PaaS can't keep a SQLite *file* alive across restarts — free web services run on ephemeral disks. Oracle's Always Free VM is the route that keeps your data durable for $0: a real machine with a persistent disk. Since this app has zero dependencies, deployment is just Node + the repo.

### 1. Create the VM (web console)

1. Sign in at [cloud.oracle.com](https://cloud.oracle.com) → *Compute → Instances → Create instance*.
2. Image: **Ubuntu 24.04** (or 22.04). Shape: **Ampere A1 / ARM** (Always Free allotment: 4 OCPU + 24 GB RAM).
3. Add your SSH public key, then **Create**. Note the instance's public IP.
4. Boot volume: keep the default size (~47 GB) — it sits inside the Always Free 200 GB block-storage allotment and is persistent.

### 2. SSH in and install

```bash
ssh ubuntu@<public-ip>
sudo -i
apt-get update && apt-get install -y git
cd /opt
git clone https://github.com/steamytooolz-commits/general-store.git
cd /opt/general-store
./deploy/oracle/setup-oracle.sh
```

The script installs Node 22, creates a `store` user, and registers a systemd service that **starts on boot and restarts on crash** (your `data` never lives in the repo — it's written to `/var/lib/general-store/store.db`).

### 3. Open the port

Oracle Cloud console → *Networking → Virtual Cloud Networks → your VCN → Security Lists → Default Security List* → **Add Ingress Rule**: source `0.0.0.0/0`, destination port `3000`, TCP. Then open `http://<public-ip>:3000`.

### 4. Daily ops

```bash
sudo systemctl status general-store     # health
sudo journalctl -u general-store -f     # live logs
sudo systemctl restart general-store    # after config changes
cd /opt/general-store && sudo git pull && sudo chown -R store:store /opt/general-store   # update app
```

### Optional: HTTPS with a domain (Caddy auto-TLS)

```bash
sudo apt-get install -y caddy
# /etc/caddy/Caddyfile:
#   store.example.com {
#       reverse_proxy 127.0.0.1:3000
#   }
sudo systemctl reload caddy
```

Point your domain's A record at the VM, allow TCP 80/443 in the Security List, and Caddy fetches a free TLS certificate automatically. *(Older guide step: if you previously cloned under `~/`, move it to `/opt` so the service user can read it.)*

## Deploy: Serv00 (free forever, no credit card)

Serv00.com is a genuinely free host — no card, no ads, no expiry, no spin-down — with persistent SSD (daily backups), SSH, and Node 22. Great fit when Oracle's signup friction isn't worth it. Limits: 512 MB RAM, 3 GB disk, EU servers, 3 TCP ports.

1. Register at [serv00.com](https://www.serv00.com) and wait for activation (a few minutes to a day).
2. SSH in with the host/port from your DevilWEB panel (if `bash` isn't your shell, switch to it in the panel). Confirm Node 22: `node22 -v`.
3. In DevilWEB, **allocate a free TCP port** and note it (plus the public hostname it shows).
4. Clone and run the bootstrap:

```bash
git clone https://github.com/steamytooolz-commits/general-store.git ~/apps/general-store
cd ~/apps/general-store
PORT=<allocated-port> bash deploy/serv00/setup-serv00.sh
```

The script picks the Node 22 binary, writes the DB to `~/apps/general-store/data/store.db`, starts the store with `nohup`, and registers a **`@reboot` cron entry** so it comes back after server restarts.

5. Visit the public address your panel shows for the port (e.g. `http://<user>.serv00.net:<port>`). Optionally map a free subdomain + Let's Encrypt cert in DevilWEB for a clean `https://` URL.

```bash
tail -f ~/apps/general-store/logs/store.log   # logs
~/apps/general-store/start.sh                  # restart
cd ~/apps/general-store && git pull && ./start.sh   # update app
```

**Choosing between the two free paths:** Serv00 wins on speed and zero friction (no card at all, live in minutes); Oracle Always Free wins on horsepower (4 OCPU/24 GB vs 512 MB) if you need headroom or expect real traffic.

## Configuration

| Variable  | Default         | Description          |
| --------- | --------------- | -------------------- |
| `PORT`    | `3000`          | HTTP port            |
| `DB_PATH` | `data/store.db` | SQLite file location |
