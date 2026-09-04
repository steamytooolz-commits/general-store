import {
  api, esc, fmtMoney, fmtDate, guardPage, mountNav, statusBadge, NEXT_STATUSES,
  toast, $, $$, show, hide,
} from './auth.js';

const state = {
  user: null,
  orders: [],
  statusFilter: '',
  q: '',
  products: [],
  categories: [],
  tab: 'orders',
};

const STATUS_LABEL = {
  placed: 'Order placed', paid: 'Payment confirmed', shipped: 'Order shipped',
  delivered: 'Delivered', cancelled: 'Cancelled',
};

const NEXT_LABEL = {
  paid: 'Mark paid', shipped: 'Mark shipped', delivered: 'Mark delivered', cancelled: 'Cancel order',
};

async function init() {
  state.user = await guardPage(['staff', 'admin']);
  if (!state.user) return;
  await mountNav('staff');
  bindTabs();
  await refreshCategories();
  await showTab('orders');
}

function bindTabs() {
  $$('#side-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
}

async function showTab(tab) {
  state.tab = tab;
  $$('#side-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.dash-panel').forEach((p) => p.classList.remove('active'));
  $(`#panel-${tab}`).classList.add('active');
  if (tab === 'orders') await renderOrdersPanel();
  else await renderInventoryPanel();
}

// ================= Orders =====================================================

async function renderOrdersPanel() {
  const panel = $('#panel-orders');
  panel.innerHTML = `
    <div class="panel-card">
      <h2>Orders</h2>
      <p class="sub">Work through the queue and keep customers in the loop.</p>
      <div class="filter-row" id="status-filters">
        <button class="chip active" data-status="">All</button>
        ${['placed', 'paid', 'shipped', 'delivered', 'cancelled'].map((s) =>
          `<button class="chip" data-status="${s}">${STATUS_LABEL[s]}</button>`).join('')}
      </div>
      <div class="spread" style="margin-bottom:12px">
        <input id="orders-q" type="text" placeholder="Search by order #, name or email…" style="max-width:340px" value="${esc(state.q)}" />
        <button class="btn btn-sm" id="orders-refresh">↻ Refresh</button>
      </div>
      <div id="orders-table" class="table-wrap"></div>
    </div>`;

  $('#status-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.statusFilter = chip.dataset.status;
    $$('#status-filters .chip').forEach((c) => c.classList.toggle('active', c === chip));
    loadOrders();
  });
  $('#orders-refresh').addEventListener('click', loadOrders);
  $('#orders-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.q = e.target.value.trim();
      loadOrders();
    }
  });
  await loadOrders();
}

async function loadOrders() {
  const box = $('#orders-table');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  const params = new URLSearchParams();
  if (state.statusFilter) params.set('status', state.statusFilter);
  if (state.q) params.set('q', state.q);
  try {
    state.orders = await api(`/api/manage/orders?${params}`);
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  const label = state.statusFilter ? STATUS_LABEL[state.statusFilter] : 'All';
  $('#page-sub').textContent = `${label} — ${state.orders.length} order${state.orders.length === 1 ? '' : 's'}.`;
  if (state.orders.length === 0) {
    box.innerHTML = '<div class="empty-state" style="padding:26px"><p>No orders match this view.</p></div>';
    return;
  }
  box.innerHTML = `
    <table class="tbl">
      <thead><tr><th>#</th><th>Placed</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>
        ${state.orders.map((o) => `
          <tr class="clickable" data-id="${o.id}">
            <td class="mono">#${o.id}</td>
            <td>${esc(fmtDate(o.createdAt))}</td>
            <td>${esc(o.customerName)}<div class="small muted">${esc(o.customerEmail)}</div></td>
            <td>${o.itemCount}</td>
            <td class="num mono">${fmtMoney(o.totalCents)}</td>
            <td>${statusBadge(o.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  $$('tr[data-id]', box).forEach((tr) => {
    tr.addEventListener('click', () => openOrderDetail(Number(tr.dataset.id)));
  });
}

async function openOrderDetail(id) {
  const modal = $('#order-modal');
  $('#order-detail').innerHTML = '<div class="skeleton"></div>';
  show(modal);
  let order;
  try {
    order = await api(`/api/manage/orders/${id}`);
  } catch (err) {
    $('#order-detail').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  renderOrderDetail(order);
}

function renderOrderDetail(order) {
  const next = NEXT_STATUSES[order.status] ?? [];
  const timeline = order.history.map((h, i) => `
    <li class="${h.status === 'cancelled' ? 'cancelled-step' : 'done'}">
      <div class="t-status">${esc(STATUS_LABEL[h.status] ?? h.status)}</div>
      ${h.note ? `<div class="t-note">${esc(h.note)}</div>` : ''}
      <div class="t-meta">${esc(fmtDate(h.createdAt))}${h.changedBy ? ` · by ${esc(h.changedBy)}` : ''}</div>
    </li>`).join('');

  $('#order-detail').innerHTML = `
    <button class="modal-close" id="od-close">✕</button>
    <div class="spread"><div>
      <h2 style="margin:0">Order #${order.id}</h2>
      <p class="muted small" style="margin:2px 0 0">Placed ${esc(fmtDate(order.createdAt))}</p>
    </div>${statusBadge(order.status)}</div>

    <div class="order-detail-grid" style="margin-top:16px">
      <div>
        <p class="section-label">Items</p>
        <ul class="item-list">
          ${order.items.map((i) => `
            <li><span>${esc(i.productName)} <span class="muted">× ${i.quantity}</span></span>
            <span class="mono">${fmtMoney(i.lineTotalCents)}</span></li>`).join('')}
          <li style="font-weight:800"><span>Total</span><span class="mono">${fmtMoney(order.totalCents)}</span></li>
        </ul>
        ${order.note ? `<p class="small muted" style="margin-top:10px"><strong>Customer note:</strong> ${esc(order.note)}</p>` : ''}
        <p class="section-label" style="margin-top:18px">Timeline</p>
        <ul class="timeline">${timeline}</ul>
      </div>
      <div>
        <p class="section-label">Customer & shipping</p>
        <div class="address-box">
          <div class="name">${esc(order.customer.name)}</div>
          <div>${esc(order.shipping.address)}</div>
          <div>${esc(order.shipping.city)}${order.shipping.postalCode ? `, ${esc(order.shipping.postalCode)}` : ''}</div>
          ${order.shipping.country ? `<div>${esc(order.shipping.country)}</div>` : ''}
          ${order.customer.phone ? `<div class="small muted">${esc(order.customer.phone)}</div>` : ''}
          <div class="small muted">${esc(order.customer.email)}</div>
        </div>
        <div style="margin-top:16px">
          <p class="section-label">Update status</p>
          ${next.length
            ? `<div id="advance-btns" style="display:flex;flex-direction:column;gap:8px">
                ${next.map((s) => `<button class="btn ${s === 'cancelled' ? 'btn-danger' : 'btn-primary'}" data-next="${s}" style="justify-content:center">${NEXT_LABEL[s] ?? s}</button>`).join('')}
              </div>
              <label class="field small" style="margin-top:10px">Note (visible to customer)
                <input id="advance-note" type="text" placeholder="e.g. Shipped via USPS, tracking 9400…" />
              </label>`
            : `<p class="small muted">This order is in its final state.</p>`}
          <div id="advance-msg"></div>
        </div>
      </div>
    </div>`;

  $('#od-close').addEventListener('click', () => hide($('#order-modal')));
  $('#order-modal').addEventListener('click', (e) => {
    if (e.target.id === 'order-modal') hide($('#order-modal'));
  });
  const msg = $('#advance-msg');
  $$('#advance-btns [data-next]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.next;
      if (status === 'cancelled' && !confirm(`Cancel order #${order.id}? This cannot be undone.`)) return;
      btn.disabled = true;
      msg.innerHTML = '';
      try {
        const updated = await api(`/api/manage/orders/${order.id}/status`, {
          method: 'PATCH',
          body: { status, note: $('#advance-note').value.trim() },
        });
        toast(`Order #${order.id} → ${STATUS_LABEL[status]}`, 'success');
        renderOrderDetail(updated);
        await loadOrders();
      } catch (err) {
        msg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    });
  });
}

// ================= Inventory ====================================================

async function refreshCategories() {
  try {
    state.categories = await api('/api/categories');
  } catch {
    state.categories = [];
  }
}

async function renderInventoryPanel() {
  const panel = $('#panel-inventory');
  panel.innerHTML = `
    <div class="panel-card">
      <h2>Inventory</h2>
      <p class="sub">Add products, adjust stock, and manage availability.</p>
      <div class="spread" style="margin-bottom:12px">
        <input id="inv-q" type="text" placeholder="Search products…" style="max-width:300px" />
        <button class="btn btn-primary" id="inv-new">+ New product</button>
      </div>
      <div id="inv-table" class="table-wrap"></div>
    </div>`;
  $('#inv-new').addEventListener('click', () => openProductEditor(null));
  $('#inv-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadProducts(e.target.value.trim());
  });
  await loadProducts('');
}

async function loadProducts(q = '') {
  const box = $('#inv-table');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  const params = q ? `?q=${encodeURIComponent(q)}` : '';
  try {
    state.products = await api(`/api/manage/products${params}`);
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  const lowCount = state.products.filter((p) => p.stock <= 5 && p.active).length;
  $('#page-sub').textContent = `${state.products.length} products · ${lowCount} low-stock alerts.`;

  box.innerHTML = `
    <table class="tbl">
      <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th class="actions"></th></tr></thead>
      <tbody>
        ${state.products.map((p) => {
          const stockPill = p.stock === 0
            ? '<span class="pill out">Out</span>'
            : p.stock <= 5
              ? `<span class="pill lowstock">${p.stock} left</span>`
              : `<span class="mono">${p.stock}</span>`;
          return `
          <tr data-id="${p.id}">
            <td>${esc(p.name)}<div class="small muted" style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.description)}</div></td>
            <td>${esc(p.categoryName ?? '—')}</td>
            <td class="num mono">${fmtMoney(p.priceCents)}</td>
            <td>${stockPill}</td>
            <td>${p.active ? '<span class="badge-status placed">Active</span>' : '<span class="pill inactive">Hidden</span>'}</td>
            <td class="actions"><button class="btn btn-sm" data-edit="${p.id}">Edit</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  if (state.products.length === 0) {
    box.innerHTML = '<div class="empty-state" style="padding:24px"><p>No products found.</p></div>';
  }
  $$('[data-edit]', box).forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = state.products.find((x) => x.id === Number(btn.dataset.edit));
      openProductEditor(p);
    });
  });
}

function openProductEditor(product) {
  const modal = $('#product-modal');
  const isNew = !product;
  const p = product ?? { name: '', description: '', priceCents: 999, stock: 0, imageUrl: '', categoryId: '', active: true };
  $('#product-editor').innerHTML = `
    <button class="modal-close" id="pe-close">✕</button>
    <h2>${isNew ? 'New product' : `Edit “${esc(p.name)}”`}</h2>
    <form id="pe-form" class="form-grid">
      <label class="field full">Name<input name="name" type="text" required maxlength="120" value="${esc(p.name)}" /></label>
      <label class="field full">Description<textarea name="description" maxlength="2000">${esc(p.description)}</textarea></label>
      <label class="field">Price (USD)<input name="price" type="number" min="0.01" step="0.01" required value="${(p.priceCents / 100).toFixed(2)}" /></label>
      <label class="field">Stock<input name="stock" type="number" min="0" step="1" required value="${p.stock}" /></label>
      <label class="field">Category
        <select name="categoryId">
          <option value="">Uncategorized</option>
          ${state.categories.map((c) => `<option value="${c.id}" ${String(c.id) === String(p.categoryId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label class="field">Status
        <select name="active">
          <option value="1" ${p.active ? 'selected' : ''}>Active (visible in store)</option>
          <option value="0" ${!p.active ? 'selected' : ''}>Hidden</option>
        </select>
      </label>
      <label class="field full">Image URL<input name="imageUrl" type="url" value="${esc(p.imageUrl)}" placeholder="https://…" /></label>
      <div id="pe-msg" class="full"></div>
      <div class="full spread">
        <div>
          ${isNew ? '' : `<button type="button" class="btn btn-danger" id="pe-delete">Delete</button>`}
        </div>
        <div class="spread" style="gap:10px">
          <button type="button" class="btn" id="pe-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">${isNew ? 'Create product' : 'Save changes'}</button>
        </div>
      </div>
    </form>`;

  const close = () => hide(modal);
  $('#pe-close').addEventListener('click', close);
  $('#pe-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'product-modal') close();
  });

  const form = $('#pe-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#pe-msg');
    msg.innerHTML = '';
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name').trim(),
      description: fd.get('description').trim(),
      priceCents: Math.round(Number(fd.get('price')) * 100),
      stock: Number(fd.get('stock')),
      imageUrl: fd.get('imageUrl').trim(),
      categoryId: fd.get('categoryId') ? Number(fd.get('categoryId')) : null,
      active: fd.get('active') === '1',
    };
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (isNew) {
        await api('/api/manage/products', { method: 'POST', body: payload });
        toast('Product created', 'success');
      } else {
        await api(`/api/manage/products/${p.id}`, { method: 'PUT', body: payload });
        toast('Product saved', 'success');
      }
      close();
      await loadProducts($('#inv-q').value.trim());
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      submitBtn.disabled = false;
    }
  });

  const del = $('#pe-delete');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm(`Delete “${p.name}”? Orders keep their snapshot of it.`)) return;
      try {
        const result = await api(`/api/manage/products/${p.id}`, { method: 'DELETE' });
        toast(result.message || 'Product deleted', result.deleted ? 'success' : 'info');
        close();
        await loadProducts($('#inv-q').value.trim());
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

init();