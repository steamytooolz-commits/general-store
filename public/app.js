const state = {
  products: [],
  cart: new Map(), // productId -> quantity
};

const $ = (sel) => document.querySelector(sel);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

async function init() {
  state.products = await fetchProducts();
  renderProducts();
  updateCartUi();

  $('#cart-button').addEventListener('click', openCart);
  $('#close-cart').addEventListener('click', closeCart);
  $('#products').addEventListener('click', (e) => {
    const btn = e.target.closest('.add-to-cart');
    if (btn) addToCart(Number(btn.dataset.id));
  });
  $('#checkout-form').addEventListener('submit', placeOrder);
}

async function fetchProducts() {
  const res = await fetch('/api/products');
  if (!res.ok) throw new Error('Failed to load products');
  return res.json();
}

function renderProducts() {
  const grid = $('#products');
  grid.innerHTML = state.products
    .map((p) => {
      const soldOut = p.stock === 0;
      return `
        <article class="product-card">
          <div class="product-image">
            <img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" loading="lazy" />
          </div>
          <div class="product-body">
            <h3>${escapeHtml(p.name)}</h3>
            <p class="description">${escapeHtml(p.description)}</p>
            <p class="price">${money(p.priceCents)}</p>
            <button class="add-to-cart" data-id="${p.id}" ${soldOut ? 'disabled' : ''}>
              ${soldOut ? 'Sold out' : 'Add to cart'}
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

function addToCart(productId) {
  state.cart.set(productId, (state.cart.get(productId) ?? 0) + 1);
  updateCartUi();

  const btn = document.querySelector(`.add-to-cart[data-id="${productId}"]`);
  if (btn) {
    const original = btn.textContent;
    btn.textContent = 'Added ✓';
    setTimeout(() => {
      btn.textContent = original;
    }, 700);
  }
}

function cartItems() {
  return [...state.cart.entries()].map(([id, quantity]) => ({
    product: state.products.find((p) => p.id === id),
    quantity,
  }));
}

function updateCartUi() {
  const count = [...state.cart.values()].reduce((a, b) => a + b, 0);
  $('#cart-count').textContent = count;

  const list = $('#cart-items');
  const items = cartItems();
  if (items.length === 0) {
    list.innerHTML = '<li class="empty">Your cart is empty.</li>';
    $('#cart-total').textContent = money(0);
    return;
  }
  list.innerHTML = items
    .map(
      ({ product, quantity }) => `
        <li>
          <span>${escapeHtml(product.name)} × ${quantity}</span>
          <span>${money(product.priceCents * quantity)}</span>
        </li>
      `
    )
    .join('');
  const total = items.reduce((sum, { product, quantity }) => sum + product.priceCents * quantity, 0);
  $('#cart-total').textContent = money(total);
}

function openCart() {
  $('#cart-overlay').classList.remove('hidden');
}

function closeCart() {
  $('#cart-overlay').classList.add('hidden');
}

async function placeOrder(event) {
  event.preventDefault();
  const message = $('#checkout-message');
  message.textContent = '';

  const items = cartItems().map(({ product, quantity }) => ({ productId: product.id, quantity }));
  if (items.length === 0) {
    message.textContent = 'Your cart is empty.';
    return;
  }

  const customer = {
    name: $('#customer-name').value.trim(),
    email: $('#customer-email').value.trim(),
  };

  message.textContent = 'Placing order…';
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not place order');

    showConfirmation(data);
    state.cart.clear();
    updateCartUi();
    $('#checkout-form').reset();
    closeCart();
    state.products = await fetchProducts();
    renderProducts();
  } catch (err) {
    message.textContent = err.message;
  }
}

function showConfirmation(order) {
  const box = $('#confirmation');
  box.innerHTML = `
    <div class="confirmation-card">
      <h2>Order confirmed 🎉</h2>
      <p>
        Thanks, ${escapeHtml(order.customer.name)}! Your order
        <strong>#${order.id}</strong> totals <strong>${money(order.totalCents)}</strong>.
      </p>
      <button type="button" onclick="this.closest('#confirmation').classList.add('hidden')">Keep shopping</button>
    </div>
  `;
  box.classList.remove('hidden');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

init().catch((err) => {
  console.error(err);
  $('#products').innerHTML = '<p>Failed to load the store. Is the server running?</p>';
});