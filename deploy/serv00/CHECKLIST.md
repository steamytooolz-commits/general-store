# Deploy on Serv00 — end-to-end checklist

Free forever · no credit card · no ads · no expiry · persistent SSD with daily backups.
Limits: 512 MB RAM, 3 GB disk, EU servers, 3 TCP ports, forum-only support.

---

## Phase 0 — Account (5 minutes)

- [ ] Go to <https://www.serv00.com> → **Register account** (email + password).
- [ ] Wait for **activation** — usually minutes, can take up to a day. Watch your inbox and spam folder.
- [ ] Log into the **DevilWEB panel** (link sent by email). Bookmark it.

## Phase 1 — SSH access (2 minutes)

- [ ] In DevilWEB, open the section that shows your **SSH access** (host, port, username).
      Typical form: `ssh <username>@<host>.serv00.net -p <ssh-port>`.
- [ ] From a terminal:
      ```bash
      ssh <username>@<host>.serv00.net -p <ssh-port>
      ```
      (Windows: use PowerShell's built-in OpenSSH, or PuTTY.)
- [ ] Set your shell to **bash** if it isn't already (DevilWEB → account settings → shell), or
      just always invoke scripts with `bash` as shown below.
- [ ] Sanity check:
      ```bash
      node22 -v    # want v22.5+ — this app needs node:sqlite
      devil port list   # optional; the setup script uses this to auto-pick a port
      ```

## Phase 2 — One-command deploy (2 minutes)

```bash
cd ~
git clone https://github.com/steamytooolz-commits/general-store.git apps/general-store
cd ~/apps/general-store
bash deploy/serv00/setup-serv00.sh
```

The script does everything automatically:

1. Finds Node 22 (`node22`) — installs one in `~/.node22` only if none exists;
   verifies `node:sqlite` is available.
2. Picks a **free TCP port** from your account's allocations (override:
   `PORT=12345 bash deploy/serv00/setup-serv00.sh`).
3. Stores the database on persistent SSD at `~/apps/general-store/data/store.db`.
4. Starts the store (`nohup`) and writes logs to `~/apps/general-store/logs/store.log`.
5. Registers a **`@reboot` cron entry** (`start.sh`) so the store returns after server restarts.

## Phase 3 — Verify it's live (2 minutes)

- [ ] Local check:
      ```bash
      curl -s http://127.0.0.1:<port>/api/products | head -c 200
      ```
- [ ] Public check: find the **public hostname for your port** in DevilWEB
      (Serv00 maps allocated ports to a URL like `http://<user>.serv00.net:<port>`),
      open it in your browser, and sign in:
      - Admin → `admin@store.com` / `admin123`
      - Staff → `staff@store.com` / `staff123`
      - Customer → `customer@store.com` / `customer123`

Optional polish: in DevilWEB, map a free subdomain with a Let's Encrypt cert so you get
`https://yourstore.serv00.net` with no port in the URL.

---

## Day-to-day ops

| Task | Command |
| ---- | ------- |
| Live logs | `tail -f ~/apps/general-store/logs/store.log` |
| Restart store | `~/apps/general-store/start.sh` |
| Check it's up | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/` |
| Update app | `cd ~/apps/general-store && git pull && ./start.sh` |
| Confirm auto-restart | `crontab -l \| grep general-store` |
| Reset to demo data | `rm ~/apps/general-store/data/store.db* && ./start.sh` (re-seeds on next boot) |

Backups: Serv00 snapshots your account daily and keeps 7 days — `store.db` is included.
The SQLite file lives outside the repo, so `git pull` never touches your data.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Activation never arrives | Check spam; ask on the [Serv00 forum](https://forum.serv00.com). |
| `node22: command not found` | The script installs its own copy to `~/.node22` automatically. |
| "this Node build lacks node:sqlite" | You're on Node < 22.5 — delete `~/.node22` and rerun, or use `node22`. |
| Process dies shortly after start | `tail -n 30 logs/store.log`; if it's an EADDRINUSE error, rerun with `PORT=<another>` — free ports are limited per account. |
| Nothing on the public URL | The panel hostname for the port differs per account — copy it from DevilWEB, don't guess. |
| Site back after reboot? | `crontab -l` must show `@reboot .../start.sh`; if missing, rerun the setup script. |
| Slow first load | First request after a cold start pays a compile/connect penalty — normal on shared hosting. |
| RAM pressure (512 MB) | This app uses ~40 MB. If you add heavy traffic, keep `Restart`/`start.sh` handy and watch `logs/store.log`. |

## The whole flow in one block

```bash
# on Serv00 (after registration + SSH):
git clone https://github.com/steamytooolz-commits/general-store.git ~/apps/general-store
cd ~/apps/general-store
bash deploy/serv00/setup-serv00.sh
```