import {
  api, esc, fmtMoney, fmtDate, fmtDay, guardPage, mountNav, statusBadge,
  roleBadge, toast, $, $$, show, hide,
} from './auth.js';

const state = {
  user: null,
  stats: null,
  statusFilter: '',
  orders: [],
  products: [],
  categories: [],
  users: [],
  tab: 'overview',
};

const STATUS_LABEL = {
  placed: 'Placed', paid: 'Paid', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};

async function init() {
  state.user = await guardPage(['admin']);
  if (!state.user) return;
  await mountNav('admin');
  $$('#side-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  await showTab('overview');
}

async function showTab(tab) {
  state.tab = tab;
  $$('#side-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.dash-panel').forEach((p) => p.classList.remove('active'));
  $(`#panel-${tab}`).classList.add('active');
  const fn = {
    overview: renderOverview,
    orders: renderOrdersPanel,
    products: renderProductsPanel,
    categories: renderCategoriesPanel,
    users: renderUsersPanel,
  }[tab];
  if (fn) await fn();
}

// ================= Overview ====================================================

async function renderOverview() {
  const panel = $('#panel-overview');
  panel.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    state.stats = await api('/api/admin/stats');
  } catch (err) {
    panel.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  const t = state.stats.totals;
  const maxDay = Math.max(1, ...state.stats.revenueByDay.map((d) => d.cents));
  const maxTop = Math.max(1, ...state.stats.topProducts.map((p) => p.revenueCents));

  panel.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi accent"><div class="k-label">Revenue · 30 days</div><div class="k-value">${fmtMoney(t.revenue30dCents)}</div><div class="k-sub">${fmtMoney(t.revenueCents)} all time</div></div>
      <div class="kpi blue"><div class="k-label">Orders</div><div class="k-value">${t.orders}</div><div class="k-sub">${t.ordersToday} today</div></div>
      <div class="kpi green"><div class="k-label">Customers</div><div class="k-value">${t.customers}</div><div class="k-sub">active accounts</div></div>
      <div class="kpi purple"><div class="k-label">Products</div><div class="k-value">${t.activeProducts}</div><div class="k-sub">active listings</div></div>
      <div class="kpi red"><div class="k-label">Low stock</div><div class="k-value">${t.lowStock}</div><div class="k-sub">≤ 5 units</div></div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:1.4fr 1fr">
      <div class="panel-card" style="margin:0">
        <div class="spread"><div><h2>Revenue · last 14 days</h2><p class="sub">Non-cancelled orders.</p></div>
          <span class="muted small mono">${fmtMoney(state.stats.revenueByDay.reduce((s, d) => s + d.cents, 0))}</span></div>
        <div class="chart-row" id="rev-chart">
          ${state.stats.revenueByDay.map((d) => `
            <div class="chart-col">
              <div class="chart-bar" title="${d.day} · ${fmtMoney(d.cents)}" style="height:${Math.max(3, Math.round((d.cents / maxDay) * 100))}%"></div>
              <span class="chart-label">${fmtDay(d.day + ' 00:00:00')}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="panel-card" style="margin:0">
        <h2>Orders by status</h2>
        <p class="sub">Click a status to open the queue.</p>
        <div id="status-chips" style="display:flex;flex-direction:column;gap:8px">
          ${Object.entries(state.stats.ordersByStatus).map(([s, n]) => `
            <button class="chip" data-s="${s}" style="justify-content:space-between;display:flex;width:100%">
              <span>${STATUS_LABEL[s] ?? s}</span><span class="n">${n}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:16px">
      <div class="panel-card" style="margin:0">
        <h3>Top products</h3>
        <ul class="mini-list">
          ${state.stats.topProducts.map((p) => `
            <li>
              <span class="ml-name">${esc(p.name)}</span>
              <span class="muted small">${p.units} sold · ${fmtMoney(p.revenueCents)}</span>
            </li>
            <li style="padding:0"><div class="meter" style="width:100%"><div style="width:${Math.max(4, Math.round((p.revenueCents / maxTop) * 100))}%"></div></div></li>
          `).join('')}
        </ul>
      </div>
      <div class="panel-card" style="margin:0">
        <h3>Low stock alerts</h3>
        ${state.stats.lowStockProducts.length
          ? `<ul class="mini-list">
              ${state.stats.lowStockProducts.map((p) => `
                <li><span class="ml-name">${esc(p.name)}</span>
                <span class="${p.stock === 0 ? 'pill out' : 'pill lowstock'}">${p.stock === 0 ? 'Out' : `${p.stock} left`}</span></li>`).join('')}
            </ul>`
          : '<p class="small muted">All products are well stocked. 🎉</p>'}
        <button class="btn btn-sm" id="ov-products" style="margin-top:12px">Open inventory</button>
      </div>
      <div class="panel-card" style="margin:0">
        <h3>Recent orders</h3>
        <ul class="mini-list">
          ${state.stats.recentOrders.map((o) => `
            <li>
              <span class="ml-name">#${o.id} · ${esc(o.customerName)}</span>
              <span class="muted small">${fmtMoney(o.totalCents)}</span>
            </li>`).join('')}
        </ul>
        <button class="btn btn-sm" id="ov-orders" style="margin-top:12px">Open orders</button>
      </div>
    </div>`;

  $('#status-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-s]');
    if (!chip) return;
    state.statusFilter = chip.dataset.s;
    showTab('orders');
  });
  $('#ov-products').addEventListener('click', () => showTab('products'));
  $('#ov-orders').addEventListener('click', () => showTab('orders'));
}

// ================= Orders =======================================================

async function renderOrdersPanel() {
  const panel = $('#panel-orders');
  panel.innerHTML = `
    <div class="panel-card">
      <h2>Orders</h2>
      <p class="sub">Every order across the store.</p>
      <div class="filter-row">
        <button class="chip ${!state.statusFilter ? 'active' : ''}" data-status="">All</button>
        ${['placed', 'paid', 'shipped', 'delivered', 'cancelled'].map((s) =>
          `<button class="chip ${state.statusFilter === s ? 'active' : ''}" data-status="${s}">${STATUS_LABEL[s]}</button>`).join('')}
      </div>
      <div id="orders-table" class="table-wrap"></div>
    </div>`;
  panel.querySelector('.filter-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.statusFilter = chip.dataset.status;
    renderOrdersPanel();
  });
  await loadOrders();
}

async function loadOrders() {
  const box = $('#orders-table');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  const params = state.statusFilter ? `?status=${state.statusFilter}` : '';
  try {
    state.orders = await api(`/api/manage/orders${params}`);
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  if (state.orders.length === 0) {
    box.innerHTML = '<div class="empty-state" style="padding:24px"><p>No orders in this view.</p></div>';
    return;
  }
  box.innerHTML = `
    <table class="tbl">
      <thead><tr><th>#</th><th>Placed</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th class="actions"></th></tr></thead>
      <tbody>
        ${state.orders.map((o) => `
          <tr data-id="${o.id}">
            <td class="mono">#${o.id}</td>
            <td>${esc(fmtDate(o.createdAt))}</td>
            <td>${esc(o.customerName)}<div class="small muted">${esc(o.customerEmail)}</div></td>
            <td>${o.itemCount}</td>
            <td class="num mono">${fmtMoney(o.totalCents)}</td>
            <td>${statusBadge(o.status)}</td>
            <td class="actions"><button class="btn btn-sm" data-view="${o.id}">View</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  $$('[data-view]', box).forEach((btn) => {
    btn.addEventListener('click', () => openOrderDetail(Number(btn.dataset.view)));
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
      </div>
    </div>`;
  $('#od-close').addEventListener('click', () => hide($('#order-modal')));
  $('#order-modal').addEventListener('click', (e) => {
    if (e.target.id === 'order-modal') hide($('#order-modal'));
  });
}

// ================= Products ====================================================

async function renderProductsPanel() {
  const panel = $('#panel-products');
  panel.innerHTML = `
    <div class="panel-card">
      <h2>Products</h2>
      <p class="sub">Full catalog control.</p>
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
    const cats = await api('/api/admin/categories');
    state.categories = cats;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  const lowCount = state.products.filter((p) => p.stock <= 5 && p.active).length;
  $('#page-sub').textContent = `Store performance and administration · ${state.products.length} products, ${lowCount} low-stock.`;

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
            <td>${esc(p.name)}</td>
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
      openProductEditor(state.products.find((x) => x.id === Number(btn.dataset.edit)));
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
          <option value="1" ${p.active ? 'selected' : ''}>Active</option>
          <option value="0" ${!p.active ? 'selected' : ''}>Hidden</option>
        </select>
      </label>
      <label class="field full">Image URL<input name="imageUrl" type="url" value="${esc(p.imageUrl)}" /></label>
      <div id="pe-msg" class="full"></div>
      <div class="full spread">
        <div>${isNew ? '' : '<button type="button" class="btn btn-danger" id="pe-delete">Delete</button>'}</div>
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
  $('#pe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#pe-msg');
    msg.innerHTML = '';
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name').trim(),
      description: fd.get('description').trim(),
      priceCents: Math.round(Number(fd.get('price')) * 100),
      stock: Number(fd.get('stock')),
      imageUrl: fd.get('imageUrl').trim(),
      categoryId: fd.get('categoryId') ? Number(fd.get('categoryId')) : null,
      active: fd.get('active') === '1',
    };
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
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
      btn.disabled = false;
    }
  });
  const del = $('#pe-delete');
  if (del) {
    del.addEventListener('click', async () => {
      if (!confirm(`Delete “${p.name}”?`)) return;
      try {
        const r = await api(`/api/manage/products/${p.id}`, { method: 'DELETE' });
        toast(r.message || 'Product deleted', r.deleted ? 'success' : 'info');
        close();
        await loadProducts($('#inv-q').value.trim());
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

// ================= Categories ===================================================

async function renderCategoriesPanel() {
  const panel = $('#panel-categories');
  panel.innerHTML = '<div class="skeleton"></div>';
  try {
    state.categories = await api('/api/admin/categories');
  } catch (err) {
    panel.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="panel-card">
      <h2>Categories</h2>
      <p class="sub">Organize the catalog. Deleting a category moves its products to “Uncategorized”.</p>
      <form id="cat-add" class="spread" style="gap:10px;margin-bottom:14px">
        <input id="cat-new-name" type="text" placeholder="New category name, e.g. Garden" style="max-width:340px" required />
        <button type="submit" class="btn btn-primary">Add category</button>
      </form>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Name</th><th>Slug</th><th>Products</th><th class="actions"></th></tr></thead>
          <tbody>
            ${state.categories.map((c) => `
              <tr data-id="${c.id}">
                <td>${esc(c.name)}</td>
                <td class="muted mono small">${esc(c.slug)}</td>
                <td>${c.productCount}</td>
                <td class="actions">
                  <button class="btn btn-sm" data-rename="${c.id}">Rename</button>
                  <button class="btn btn-sm btn-danger" data-delcat="${c.id}">Delete</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  $('#cat-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/categories', { method: 'POST', body: { name: $('#cat-new-name').value.trim() } });
      toast('Category added', 'success');
      await renderCategoriesPanel();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $$('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', () => openCategoryEditor(state.categories.find((c) => c.id === Number(btn.dataset.rename))));
  });
  $$('[data-delcat]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const c = state.categories.find((x) => x.id === Number(btn.dataset.delcat));
      if (!confirm(`Delete category “${c.name}”? Its ${c.productCount} products will become uncategorized.`)) return;
      try {
        await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
        toast('Category deleted', 'success');
        await renderCategoriesPanel();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function openCategoryEditor(category) {
  const modal = $('#cat-modal');
  $('#cat-editor').innerHTML = `
    <button class="modal-close" id="ce-close">✕</button>
    <h2>Rename category</h2>
    <form id="ce-form" class="form-grid">
      <label class="field full">Name<input id="ce-name" type="text" value="${esc(category.name)}" required maxlength="80" /></label>
      <div id="ce-msg" class="full"></div>
      <div class="full spread">
        <button type="button" class="btn" id="ce-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`;
  const close = () => hide(modal);
  $('#ce-close').addEventListener('click', close);
  $('#ce-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'cat-modal') close();
  });
  $('#ce-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/categories/${category.id}`, { method: 'PUT', body: { name: $('#ce-name').value.trim() } });
      toast('Category renamed', 'success');
      close();
      await renderCategoriesPanel();
    } catch (err) {
      $('#ce-msg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  });
}

// ================= Users ========================================================

async function renderUsersPanel() {
  const panel = $('#panel-users');
  panel.innerHTML = '<div class="skeleton"></div>';
  try {
    state.users = await api('/api/admin/users');
  } catch (err) {
    panel.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="panel-card">
      <h2>Users</h2>
      <p class="sub">Manage roles and access. You can’t change your own account here.</p>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>User</th><th>Role</th><th>Orders</th><th>Status</th><th>Joined</th><th class="actions"></th></tr></thead>
          <tbody>
            ${state.users.map((u) => `
              <tr data-id="${u.id}">
                <td><strong>${esc(u.name)}</strong><div class="small muted">${esc(u.email)}</div></td>
                <td>
                  <select class="role-select" data-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>
                    ${['customer', 'staff', 'admin'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td>${u.orderCount}</td>
                <td>${u.active ? '<span class="badge-status delivered">Active</span>' : '<span class="pill inactive">Disabled</span>'}</td>
                <td class="muted small">${esc(fmtDay(u.createdAt))}</td>
                <td class="actions">
                  ${u.id === state.user.id
                    ? '<span class="small muted">you</span>'
                    : `<button class="btn btn-sm ${u.active ? 'btn-danger' : ''}" data-toggle="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  $$('[data-role]', panel).forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = Number(sel.dataset.role);
      const old = state.users.find((u) => u.id === id).role;
      try {
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { role: sel.value } });
        toast(`Role updated to ${sel.value}`, 'success');
        await renderUsersPanel();
      } catch (err) {
        toast(err.message, 'error');
        sel.value = old;
      }
    });
  });
  $$('[data-toggle]', panel).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.toggle);
      const u = state.users.find((x) => x.id === id);
      const action = u.active ? 'disable' : 'enable';
      if (!confirm(`${action === 'disable' ? 'Disable' : 'Enable'} ${u.name} (${u.email})?`)) return;
      try {
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { active: !u.active } });
        toast(`${u.name} ${action}d`, 'success');
        await renderUsersPanel();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

init();