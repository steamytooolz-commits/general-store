import {
  api, esc, fmtMoney, fmtDate, fmtDay, me, logout, mountNav,
  statusBadge, toast, $, $$, show, hide,
} from './auth.js';

const state = { user: null, orders: [], next: new URLSearchParams(location.search).get('next') || '/account.html' };

async function init() {
  await mountNav('account');
  state.user = await me();
  if (state.user) renderDash();
  else renderAuth();
}

// ---- Auth views --------------------------------------------------------------

function renderAuth() {
  show($('#auth-view'));
  hide($('#dash-view'));
  renderAuthForm('login');

  $('#tab-login').addEventListener('click', () => {
    setAuthTab('login');
    renderAuthForm('login');
  });
  $('#tab-register').addEventListener('click', () => {
    setAuthTab('register');
    renderAuthForm('register');
  });
}

function setAuthTab(mode) {
  $('#tab-login').classList.toggle('active', mode === 'login');
  $('#tab-register').classList.toggle('active', mode === 'register');
}

function renderAuthForm(mode) {
  const box = $('#auth-form');
  const isLogin = mode === 'login';
  box.innerHTML = `
    ${isLogin ? '<h1>Welcome back</h1><p class="sub">Sign in to your account.</p>' : '<h1>Create your account</h1><p class="sub">Track orders and check out faster.</p>'}
    <form id="auth-form-el">
      ${isLogin ? '' : '<label class="field" style="margin-bottom:10px">Full name<input id="f-name" type="text" required /></label>'}
      <label class="field" style="margin-bottom:10px">Email<input id="f-email" type="email" required /></label>
      <label class="field" style="margin-bottom:14px">Password<input id="f-password" type="password" minlength="6" required /></label>
      <div id="auth-msg"></div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">${isLogin ? 'Sign in' : 'Create account'}</button>
    </form>
    <div class="demo-hint">
      <strong>Demo accounts</strong><br />
      Customer — <code>customer@store.com</code> / <code>customer123</code><br />
      Staff — <code>staff@store.com</code> / <code>staff123</code><br />
      Admin — <code>admin@store.com</code> / <code>admin123</code>
    </div>
  `;
  $('#auth-form-el').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#auth-msg');
    msg.innerHTML = '';
    const payload = isLogin
      ? { email: $('#f-email').value.trim(), password: $('#f-password').value }
      : {
          name: $('#f-name').value.trim(),
          email: $('#f-email').value.trim(),
          password: $('#f-password').value,
        };
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = isLogin ? 'Signing in…' : 'Creating account…';
    try {
      await api(`/api/auth/${isLogin ? 'login' : 'register'}`, { method: 'POST', body: payload });
      toast(isLogin ? 'Signed in!' : 'Account created — welcome!', 'success');
      location.href = state.next;
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = isLogin ? 'Sign in' : 'Create account';
    }
  });
}

// ---- Dashboard ---------------------------------------------------------------

async function renderDash() {
  hide($('#auth-view'));
  show($('#dash-view'));
  $('#dash-name').textContent = `Hello, ${state.user.name}`;
  $('#dash-sub').innerHTML = `${esc(state.user.email)} · <span class="role-badge role-${state.user.role}">${state.user.role}</span>`;
  $('#dash-actions').innerHTML = `<button class="btn" id="dash-logout">Sign out</button>`;
  $('#dash-logout').addEventListener('click', logout);
  renderProfileForm();
  await loadOrders();
}

async function loadOrders() {
  const wrap = $('#orders-list');
  wrap.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    state.orders = await api('/api/me/orders');
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  if (state.orders.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state" style="padding:30px">
        <div class="big">📦</div>
        <p>You haven’t placed any orders yet.</p>
        <a class="btn btn-primary" href="/">Start shopping</a>
      </div>`;
    return;
  }
  const activeCount = state.orders.filter((o) => ['placed', 'paid', 'shipped'].includes(o.status)).length;
  $('#dash-sub').innerHTML += ` · <span class="muted">${state.orders.length} orders, ${activeCount} active</span>`;

  wrap.innerHTML = `
    <table class="tbl">
      <thead><tr><th>Order</th><th>Placed</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${state.orders.map((o) => `
          <tr data-order="${o.id}">
            <td class="mono">#${o.id}</td>
            <td>${esc(fmtDay(o.createdAt))}</td>
            <td>${o.itemCount}</td>
            <td class="num mono">${fmtMoney(o.totalCents)}</td>
            <td>${statusBadge(o.status)}</td>
            <td class="actions"><button class="btn btn-sm btn-ghost">View</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  $$('tr[data-order]', wrap).forEach((tr) => {
    tr.addEventListener('click', () => openOrderDetail(Number(tr.dataset.order)));
  });
}

async function openOrderDetail(id) {
  const modal = $('#order-modal');
  $('#order-detail').innerHTML = '<div class="skeleton"></div>';
  show(modal);
  let order;
  try {
    order = await api(`/api/orders/${id}`);
  } catch (err) {
    $('#order-detail').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  const cancellable = ['placed', 'paid'].includes(order.status);
  const timeline = order.history.map((h, i) => {
    const cls = h.status === 'cancelled' ? 'cancelled-step' : i === order.history.length - 1 ? 'done' : 'done';
    return `
      <li class="${cls}">
        <div class="t-status">${esc(STATUS_LABEL[h.status] ?? h.status)}</div>
        ${h.note ? `<div class="t-note">${esc(h.note)}</div>` : ''}
        <div class="t-meta">${esc(fmtDate(h.createdAt))}${h.changedBy ? ` · by ${esc(h.changedBy)}` : ''}</div>
      </li>`;
  }).join('');

  $('#order-detail').innerHTML = `
    <button class="modal-close" id="od-close">✕</button>
    <div class="spread"><div>
      <h2 style="margin:0">Order #${order.id}</h2>
      <p class="muted small" style="margin:2px 0 0">Placed ${esc(fmtDate(order.createdAt))}${order.updatedAt !== order.createdAt ? ` · updated ${esc(fmtDate(order.updatedAt))}` : ''}</p>
    </div>${statusBadge(order.status)}</div>

    <div class="order-detail-grid" style="margin-top:16px">
      <div>
        <p class="section-label">Items</p>
        <ul class="item-list">
          ${order.items.map((i) => `
            <li>
              <span>${esc(i.productName)} <span class="muted">× ${i.quantity}</span></span>
              <span class="mono">${fmtMoney(i.lineTotalCents)}</span>
            </li>`).join('')}
          <li style="font-weight:800"><span>Total</span><span class="mono">${fmtMoney(order.totalCents)}</span></li>
        </ul>
        ${order.note ? `<p class="small muted" style="margin:10px 2px 0"><strong>Note:</strong> ${esc(order.note)}</p>` : ''}
        <p class="section-label" style="margin-top:18px">Timeline</p>
        <ul class="timeline">${timeline}</ul>
      </div>
      <div>
        <p class="section-label">Shipping</p>
        <div class="address-box">
          <div class="name">${esc(order.customer.name)}</div>
          <div>${esc(order.shipping.address)}</div>
          <div>${esc(order.shipping.city)}${order.shipping.postalCode ? `, ${esc(order.shipping.postalCode)}` : ''}</div>
          ${order.shipping.country ? `<div>${esc(order.shipping.country)}</div>` : ''}
          ${order.customer.phone ? `<div class="small muted">${esc(order.customer.phone)}</div>` : ''}
          <div class="small muted">${esc(order.customer.email)}</div>
        </div>
        <div style="margin-top:18px">
          ${cancellable
            ? `<button class="btn btn-danger" id="od-cancel" style="width:100%">Cancel this order</button>
               <p class="small muted" style="margin:8px 0 0">Only ${order.status} orders can be cancelled.</p>`
            : `<p class="small muted">This order can no longer be cancelled online. Contact support if you need help.</p>`}
        </div>
      </div>
    </div>
  `;
  const close = () => hide(modal);
  $('#od-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'order-modal') close();
  });
  const cancelBtn = $('#od-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!confirm(`Cancel order #${order.id}? This cannot be undone.`)) return;
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelling…';
      try {
        await api(`/api/me/orders/${order.id}/cancel`, { method: 'POST' });
        toast(`Order #${order.id} cancelled`, 'success');
        close();
        await loadOrders();
      } catch (err) {
        toast(err.message, 'error');
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel this order';
      }
    });
  }
}

const STATUS_LABEL = {
  placed: 'Order placed', paid: 'Payment confirmed', shipped: 'Order shipped',
  delivered: 'Delivered', cancelled: 'Cancelled',
};

// ---- Profile ------------------------------------------------------------------

function renderProfileForm() {
  const box = $('#profile-form');
  box.innerHTML = `
    <form id="pf-el" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <label class="field">Name<input id="pf-name" type="text" value="${esc(state.user.name)}" required /></label>
      <label class="field">Email<input id="pf-email" type="email" value="${esc(state.user.email)}" required /></label>
      <div class="full" style="grid-column:1/-1;display:flex;justify-content:flex-end">
        <button type="submit" class="btn btn-primary">Save profile</button>
      </div>
      <hr class="divider full" style="grid-column:1/-1" />
      <label class="field">Current password<input id="pf-current" type="password" autocomplete="current-password" /></label>
      <label class="field">New password<input id="pf-new" type="password" minlength="6" autocomplete="new-password" placeholder="At least 6 characters" /></label>
      <div class="full" style="grid-column:1/-1;display:flex;justify-content:flex-end">
        <button type="submit" class="btn" id="pf-change-pw">Change password</button>
      </div>
      <div id="pf-msg" class="full" style="grid-column:1/-1"></div>
    </form>
  `;
  const msg = $('#pf-msg');
  $('#pf-el').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.innerHTML = '';
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const data = await api('/api/me', {
        method: 'PATCH',
        body: { name: $('#pf-name').value.trim(), email: $('#pf-email').value.trim() },
      });
      state.user = data.user;
      toast('Profile updated', 'success');
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
  $('#pf-change-pw').addEventListener('click', async (e) => {
    e.preventDefault();
    msg.innerHTML = '';
    const current = $('#pf-current').value;
    const next = $('#pf-new').value;
    if (!current || !next) {
      msg.innerHTML = '<div class="alert alert-error">Fill in both password fields.</div>';
      return;
    }
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Changing…';
    try {
      await api('/api/me', { method: 'PATCH', body: { currentPassword: current, newPassword: next } });
      $('#pf-current').value = '';
      $('#pf-new').value = '';
      toast('Password changed', 'success');
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Change password';
    }
  });
}

init();