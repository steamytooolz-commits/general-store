import { api, esc, fmtMoney, me, mountNav, $, $$, show, hide, toast } from './auth.js';

const state = {
  products: [],
  categories: [],
  category: '', // active category slug
  q: '',
  sort: 'newest',
  cart: new Map(), // productId -> quantity
  user: null,
};

const CART_KEY = 'gs-cart-v1';

// ---- Boot -------------------------------------------------------------------

async function init() {
  state.user = await mountNav('store');
  loadCart();
  await Promise.all([loadCategories(), loadProducts()]);
  bindEvents();
  updateCartUi();
}

function bindEvents() {
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = $('#search-input').value.trim();
    loadProducts();
  });
  $('#sort-select').addEventListener('change', () => {
    state.sort = $('#sort-select').value;
    loadProducts();
  });
  $('#cart-button').addEventListener('click', openCart);
  $('#product-modal').addEventListener('click', (e) => {
    if (e.target.id === 'product-modal') hide($('#product-modal'));
  });
  $('#cart-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'cart-overlay') closeCart();
  });
  $('#confirm-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'confirm-overlay') hide($('#confirm-overlay'));
  });
  $('#products').addEventListener('click', (e) => {
    const card = e.target.closest('.product-card');
    if (!card || e.target.closest('button')) return;
    openProduct(Number(card.dataset.id));
  });
}

// ---- Catalog ---------------------------------------------------------------

async function loadCategories() {
  try {
    state.categories = await api('/api/categories');
  } catch {
    state.categories = [];
  }
  renderCategories();
}

function renderCategories() {
  const bar = $('#category-bar');
  let html = '<div class="category-chips">';
  html += `<button class="chip ${!state.category ? 'active' : ''}" data-slug="">All products</button>`;
  for (const c of state.categories) {
    html += `<button class="chip ${state.category === c.slug ? 'active' : ''}" data-slug="${esc(c.slug)}">${esc(c.name)}</button>`;
  }
  html += '</div>';
  bar.innerHTML = html;
  $$('.chip', bar).forEach((chip) => {
    chip.addEventListener('click', () => {
      state.category = chip.dataset.slug;
      renderCategories();
      loadProducts();
    });
  });
}

async function loadProducts() {
  const params = new URLSearchParams({ sort: state.sort });
  if (state.category) params.set('category', state.category);
  if (state.q) params.set('q', state.q);
  const grid = $('#products');
  grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    state.products = await api(`/api/products?${params}`);
  } catch (err) {
    grid.innerHTML = `<p class="empty-state">Could not load products: ${esc(err.message)}</p>`;
    return;
  }
  renderProducts();
}

function renderProducts() {
  const grid = $('#products');
  const activeCat = state.categories.find((c) => c.slug === state.category);
  $('#heading').textContent = state.q
    ? `Results for “${state.q}”`
    : activeCat
      ? activeCat.name
      : 'All products';
  $('#heading-sub').textContent = `${state.products.length} item${state.products.length === 1 ? '' : 's'} available`;

  if (state.products.length === 0) {
    grid.innerHTML = '';
    show($('#empty-state'));
    return;
  }
  hide($('#empty-state'));
  grid.innerHTML = state.products
    .map((p) => {
      const tag = p.stock === 0
        ? '<span class="tag sold-out">Sold out</span>'
        : p.stock <= 5
          ? `<span class="tag low">Only ${p.stock} left</span>`
          : p.categoryName
            ? `<span class="tag">${esc(p.categoryName)}</span>`
            : '';
      const stockNote = p.stock === 0
        ? '<span class="stock-note none">Out of stock</span>'
        : p.stock <= 5
          ? `<span class="stock-note low">Only ${p.stock} left</span>`
          : `<span class="stock-note ok">In stock</span>`;
      return `
        <article class="product-card" data-id="${p.id}" role="button" tabindex="0">
          <div class="product-image">
            <img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy" />
            ${tag}
          </div>
          <div class="product-body">
            <h3>${esc(p.name)}</h3>
            <p class="desc">${esc(p.description)}</p>
            <div class="price-row">
              <span class="price">${fmtMoney(p.priceCents)}</span>
              ${stockNote}
            </div>
            <button class="add-to-cart btn btn-primary btn-sm" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
              ${p.stock === 0 ? 'Sold out' : 'Add to cart'}
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (btn && !btn.disabled) {
      const product = state.products.find((p) => p.id === Number(btn.dataset.add));
      addToCart(product);
    }
  });
}

// ---- Product modal ---------------------------------------------------------

function openProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  const inCart = state.cart.get(id) ?? 0;
  $('#product-detail').innerHTML = `
    <button class="modal-close" id="pm-close">✕</button>
    <div style="display:grid;grid-template-columns:1.1fr 1fr;gap:22px;align-items:start">
      <img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" style="width:100%;border-radius:12px;aspect-ratio:1/1;object-fit:cover;background:var(--gray-soft)" />
      <div>
        <p class="muted small" style="margin:0 0 4px">${esc(p.categoryName ?? 'General')}</p>
        <h2 style="margin:0 0 8px">${esc(p.name)}</h2>
        <p class="price" style="font-size:24px;margin:0 0 6px">${fmtMoney(p.priceCents)}</p>
        <p class="small" style="color:var(--muted);margin:0 0 12px">${esc(p.description)}</p>
        <p class="small ${p.stock === 0 ? 'stock-note none' : p.stock <= 5 ? 'stock-note low' : 'stock-note ok'}" style="margin:0 0 16px">
          ${p.stock === 0 ? 'Out of stock' : `${p.stock} in stock`}
        </p>
        <div class="spread" style="margin-bottom:14px">
          <div class="qty-stepper">
            <button type="button" data-step="-1">−</button>
            <span class="qty" id="pm-qty">${Math.max(1, inCart)}</span>
            <button type="button" data-step="1">+</button>
          </div>
          <button class="btn btn-primary" id="pm-add" ${p.stock === 0 ? 'disabled' : ''}>Add to cart</button>
        </div>
        ${inCart ? `<p class="small muted">${inCart} already in your cart</p>` : ''}
      </div>
    </div>
  `;
  $('#pm-close').addEventListener('click', () => hide($('#product-modal')));
  $('#pm-add').addEventListener('click', () => {
    const qty = Number($('#pm-qty').textContent);
    addToCart(p, qty);
  });
  $$('[data-step]', $('#product-detail')).forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = $('#pm-qty');
      const next = Math.min(p.stock, Math.max(1, Number(el.textContent) + Number(btn.dataset.step)));
      el.textContent = next;
    });
  });
  show($('#product-modal'));
}

// ---- Cart ------------------------------------------------------------------

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    state.cart = new Map(raw.filter(([id, q]) => Number.isInteger(id) && q > 0));
  } catch {
    state.cart = new Map();
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify([...state.cart.entries()]));
}

function addToCart(product, qty = 1) {
  const current = state.cart.get(product.id) ?? 0;
  const next = Math.min(product.stock, current + qty);
  if (next <= 0) return toast('This product is sold out', 'error');
  state.cart.set(product.id, next);
  saveCart();
  updateCartUi();
  hide($('#product-modal'));
  toast(`Added ${esc(product.name)} to your cart`, 'success', 1800);
}

function setQty(id, qty) {
  if (qty <= 0) state.cart.delete(id);
  else state.cart.set(id, qty);
  saveCart();
  updateCartUi();
}

function openCart() {
  renderCart();
  show($('#cart-overlay'));
}

function closeCart() {
  hide($('#cart-overlay'));
}

function cartEntries() {
  return [...state.cart.entries()]
    .map(([id, qty]) => ({ product: state.products.find((p) => p.id === id), qty }))
    .filter((x) => x.product);
}

function cartTotal() {
  return cartEntries().reduce((s, { product, qty }) => s + product.priceCents * qty, 0);
}

function updateCartUi() {
  const count = [...state.cart.values()].reduce((a, b) => a + b, 0);
  $('#cart-count').textContent = count;
}

function renderCart() {
  const panel = $('#cart-panel');
  const entries = cartEntries();
  const count = entries.reduce((s, { qty }) => s + qty, 0);

  if (entries.length === 0) {
    panel.innerHTML = `
      <div class="spread">
        <h2>Your cart</h2>
        <button class="modal-close" id="cart-close">✕</button>
      </div>
      <div class="empty-state"><div class="big">🛒</div><p>Your cart is empty.</p>
      <button class="btn" id="cart-back">Continue shopping</button></div>
    `;
    bindCartClose();
    $('#cart-back').addEventListener('click', closeCart);
    return;
  }

  panel.innerHTML = `
    <div class="spread">
      <h2>Your cart · ${count} ${count === 1 ? 'item' : 'items'}</h2>
      <button class="modal-close" id="cart-close">✕</button>
    </div>
    <ul class="cart-lines">
      ${entries.map(({ product, qty }) => `
        <li class="cart-line">
          <img src="${esc(product.imageUrl)}" alt="" />
          <div class="cl-info">
            <div class="cl-name">${esc(product.name)}</div>
            <div class="cl-price">${fmtMoney(product.priceCents)} each</div>
          </div>
          <div class="qty-stepper">
            <button type="button" data-dec="${product.id}">−</button>
            <span class="qty">${qty}</span>
            <button type="button" data-inc="${product.id}" ${qty >= product.stock ? 'disabled' : ''}>+</button>
          </div>
          <span class="cl-line-total mono" style="font-weight:700">${fmtMoney(product.priceCents * qty)}</span>
          <button class="cl-remove" data-remove="${product.id}" title="Remove">✕</button>
        </li>
      `).join('')}
    </ul>
    <div class="total-line"><span>Total</span><span>${fmtMoney(cartTotal())}</span></div>
    <details class="small muted"><summary>Shipping details</summary>
      <p style="margin:8px 0 0">Entered at checkout.</p>
    </details>
    <button class="btn btn-primary" id="checkout-btn">Checkout →</button>
  `;
  bindCartClose();
  panel.addEventListener('click', (e) => {
    const dec = e.target.closest('[data-dec]');
    const inc = e.target.closest('[data-inc]');
    const rem = e.target.closest('[data-remove]');
    if (dec) {
      const p = state.products.find((x) => x.id === Number(dec.dataset.dec));
      setQty(p.id, (state.cart.get(p.id) ?? 0) - 1);
    }
    if (inc) {
      const p = state.products.find((x) => x.id === Number(inc.dataset.inc));
      setQty(p.id, Math.min(p.stock, (state.cart.get(p.id) ?? 0) + 1));
    }
    if (rem) state.cart.delete(Number(rem.dataset.remove)), saveCart(), renderCart(), updateCartUi();
  });
  $('#checkout-btn').addEventListener('click', renderCheckout);
}

function bindCartClose() {
  const btn = $('#cart-close');
  if (btn) btn.addEventListener('click', closeCart);
}

// ---- Checkout ---------------------------------------------------------------

function renderCheckout() {
  const panel = $('#cart-panel');
  const u = state.user;
  panel.innerHTML = `
    <div class="spread">
      <h2>Checkout</h2>
      <button class="modal-close" id="cart-close">✕</button>
    </div>
    <div class="alert alert-info small">${esc(u ? `Signed in as ${u.name} — we’ll use your details.` : 'Guest checkout — create an account later to track this order.')}</div>
    <form id="checkout-form">
      <div class="form-grid">
        <label class="field">Full name<input id="co-name" type="text" value="${esc(u?.name ?? '')}" required ${u ? 'readonly' : ''} /></label>
        <label class="field">Email<input id="co-email" type="email" value="${esc(u?.email ?? '')}" required ${u ? 'readonly' : ''} /></label>
        <label class="field full">Phone (optional)<input id="co-phone" type="text" placeholder="+1 555 000 0000" /></label>
        <label class="field full">Street address<input id="co-address" type="text" required placeholder="123 Market Street, Apt 4" /></label>
        <label class="field">City<input id="co-city" type="text" required /></label>
        <label class="field">Postal code<input id="co-postal" type="text" /></label>
        <label class="field full">Country<input id="co-country" type="text" placeholder="US" /></label>
        <label class="field full">Order note (optional)<input id="co-note" type="text" placeholder="Leave at the door, gift wrap, …" /></label>
      </div>
      <div class="total-line" style="margin-top:14px"><span>Total</span><span>${fmtMoney(cartTotal())}</span></div>
      <div id="co-msg"></div>
      <div class="spread" style="margin-top:14px">
        <button type="button" class="btn" id="co-back">← Back to cart</button>
        <button type="submit" class="btn btn-primary">Place order · ${fmtMoney(cartTotal())}</button>
      </div>
    </form>
  `;
  $('#cart-close').addEventListener('click', closeCart);
  $('#co-back').addEventListener('click', renderCart);
  $('#checkout-form').addEventListener('submit', placeOrder);
}

async function placeOrder(e) {
  e.preventDefault();
  const msg = $('#co-msg');
  msg.innerHTML = '';
  const entries = cartEntries();
  if (entries.length === 0) {
    msg.innerHTML = '<div class="alert alert-error">Your cart is empty.</div>';
    return;
  }
  const payload = {
    customer: {
      name: $('#co-name').value.trim(),
      email: $('#co-email').value.trim(),
      phone: $('#co-phone').value.trim(),
      address: $('#co-address').value.trim(),
      city: $('#co-city').value.trim(),
      postalCode: $('#co-postal').value.trim(),
      country: $('#co-country').value.trim(),
    },
    note: $('#co-note').value.trim(),
    items: entries.map(({ product, qty }) => ({ productId: product.id, quantity: qty })),
  };
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Placing order…';
  try {
    const order = await api('/api/orders', { method: 'POST', body: payload });
    state.cart.clear();
    saveCart();
    updateCartUi();
    closeCart();
    showConfirmation(order);
    await loadProducts(); // refresh stock counts
  } catch (err) {
    msg.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    btn.disabled = false;
    btn.textContent = 'Place order';
  }
}

function showConfirmation(order) {
  const box = $('#confirm-box');
  box.innerHTML = `
    <div style="text-align:center">
      <div style="font-size:52px">🎉</div>
      <h2>Order confirmed!</h2>
      <p class="muted">Thanks, ${esc(order.customer.name)}. We’ve saved your order and will email ${esc(order.customer.email)} once it ships.</p>
      <p style="font-size:20px;font-weight:800;margin:14px 0 4px">Order #${order.id}</p>
      <p class="muted small">Total ${fmtMoney(order.totalCents)} · ${esc(order.items.length)} ${order.items.length === 1 ? 'item' : 'items'}</p>
      <div class="item-list" style="text-align:left;margin:16px 0">
        ${order.items.map((i) => `<li><span>${esc(i.productName)} × ${i.quantity}</span><span class="mono">${fmtMoney(i.lineTotalCents)}</span></li>`).join('')}
      </div>
      <p class="small muted">Shipping to ${esc(order.shipping.address)}, ${esc(order.shipping.city)}.</p>
      ${state.user ? '' : `<p class="small"><a href="/account.html">Create an account</a> to track this order later.</p>`}
      <button class="btn btn-primary" id="conf-close" style="margin-top:10px">Keep shopping</button>
    </div>
  `;
  $('#conf-close').addEventListener('click', () => hide($('#confirm-overlay')));
  show($('#confirm-overlay'));
}

init();