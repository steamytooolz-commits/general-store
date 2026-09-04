// ---- Formatting & escaping -------------------------------------------------

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtMoney = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

/** SQLite stores UTC "YYYY-MM-DD HH:MM:SS" — render it in the local timezone. */
export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function fmtDay(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- Status metadata --------------------------------------------------------

export const STATUS_META = {
  placed: { label: 'Placed', cls: 'placed' },
  paid: { label: 'Paid', cls: 'paid' },
  shipped: { label: 'Shipped', cls: 'shipped' },
  delivered: { label: 'Delivered', cls: 'delivered' },
  cancelled: { label: 'Cancelled', cls: 'cancelled' },
};

/** Mirror of the backend's allowed transitions: status -> next statuses. */
export const NEXT_STATUSES = {
  placed: ['paid', 'shipped', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const statusBadge = (status) => {
  const m = STATUS_META[status] ?? { label: status, cls: 'placed' };
  return `<span class="badge-status ${m.cls}">${m.label}</span>`;
};

export const roleBadge = (role) => `<span class="role-badge role-${role}">${role}</span>`;

// ---- API client -------------------------------------------------------------

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** fetch helper; same-origin cookies are sent automatically. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data;
}

export async function me() {
  try {
    const data = await api('/api/auth/me');
    return data.user;
  } catch {
    return null;
  }
}

export async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  location.href = '/account.html';
}

/** Redirect to sign-in unless the current user holds one of the allowed roles. */
export async function guardPage(allowedRoles) {
  const user = await me();
  if (!user) {
    location.href = `/account.html?next=${encodeURIComponent(location.pathname)}`;
    return null;
  }
  if (!allowedRoles.includes(user.role)) {
    toast(`You need ${allowedRoles.join(' or ')} access to view this page`, 'error');
    location.href = '/';
    return null;
  }
  return user;
}

// ---- Toast -------------------------------------------------------------------

export function toast(message, type = 'info', timeout = 3500) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}

// ---- Shared header nav --------------------------------------------------------

export async function mountNav(activePage) {
  const slot = document.getElementById('site-nav');
  if (!slot) return;
  const user = await me();
  const links = [
    { href: '/', label: 'Store', key: 'store' },
    { href: '/account.html', label: 'My Account', key: 'account' },
  ];
  if (user && (user.role === 'staff' || user.role === 'admin')) {
    links.push({ href: '/staff.html', label: 'Staff Desk', key: 'staff' });
  }
  if (user && user.role === 'admin') {
    links.push({ href: '/admin.html', label: 'Admin', key: 'admin' });
  }

  let html = '<nav class="nav-links">';
  for (const l of links) {
    html += `<a href="${l.href}" class="${l.key === activePage ? 'active' : ''}">${l.label}</a>`;
  }
  html += '</nav>';
  if (user) {
    html += `<span class="user-name">${esc(user.name)}</span>`;
    html += `<button class="btn btn-sm" id="logout-btn">Sign out</button>`;
  } else {
    html += `<a class="btn btn-sm" href="/account.html">Sign in</a>`;
  }
  slot.innerHTML = html;
  const out = slot.querySelector('#logout-btn');
  if (out) out.addEventListener('click', logout);
  return user;
}

// ---- Small DOM helpers ---------------------------------------------------------

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function show(el) {
  el.classList.remove('hidden');
}

export function hide(el) {
  el.classList.add('hidden');
}

/** Fill a <select> with options; returns the previous value. */
export function setOptions(select, items, { valueKey = 'id', labelKey = 'name', placeholder = null } = {}) {
  const prev = select.value;
  let html = '';
  if (placeholder !== null) html += `<option value="">${esc(placeholder)}</option>`;
  html += items.map((it) => `<option value="${esc(it[valueKey])}">${esc(it[labelKey])}</option>`).join('');
  select.innerHTML = html;
  return prev;
}