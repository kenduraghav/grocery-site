(() => {
  'use strict';

  // ---------- Settings ----------
  const CART_KEY = 'grocery-cart-v1';
  const CUSTOMER_KEY = 'grocery-customer-v1';
  const MAX_QTY = 99;
  const MAX_URL_LENGTH = 6000;                       // longer orders are copied instead of pre-filled
  const SHOW_CHECK = new URLSearchParams(location.search).has('check');   // owner adds ?check to the address

  // ---------- State ----------
  const state = {
    config: { shopName: 'Grocery Store', whatsappNumber: '', currencySymbol: '₹' },
    products: [],
    byId: new Map(),
    cart: {},            // { productId: quantity }, nothing else is stored
    removedFromCart: 0,
    category: 'All',
    brand: '',
    query: ''
  };
  const actionBoxes = new Map();   // productId -> element holding the Add / quantity buttons
  let lastFocus = null;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    shopName: $('#shop-name'), search: $('#search'), chips: $('#chips'), brand: $('#brand'),
    notice: $('#notice'), count: $('#count'), grid: $('#grid'),
    cartBtn: $('#cart-btn'), cartCount: $('#cart-count'), cartTotal: $('#cart-total'),
    overlay: $('#overlay'), drawer: $('#cart'), title: $('#cart-title'), closeBtn: $('#cart-close'),
    cartNote: $('#cart-note'), cartEmpty: $('#cart-empty'), cartFull: $('#cart-full'),
    items: $('#cart-items'), sum: $('#cart-sum'),
    form: $('#order-form'), name: $('#cust-name'), note: $('#cust-note'),
    status: $('#status'), clear: $('#clear-cart')
  };

  // ---------- Small helpers ----------
  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    kids.flat().forEach((kid) => { if (kid != null) node.append(kid); });
    return node;
  }

  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: carry on without it */ }
  }

  // Prices are whole numbers in the smallest unit (paise/cents), so there is no rounding drift.
  const money = (amount) => state.config.currencySymbol + (amount / 100).toFixed(2);
  const label = (p) => [p.name, p.brand, p.unit].filter(Boolean).join(' ');

  async function loadJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });   // always re-check, so JSON edits show up
    if (!res.ok) throw new Error(`${url} could not be loaded (HTTP ${res.status})`);
    return res.json();
  }

  // ---------- Reading products.json ----------
  function problemWith(p) {
    if (!p || typeof p !== 'object') return 'row is not an object';
    if (typeof p.id !== 'string' || !p.id.trim()) return 'missing id';
    if (typeof p.name !== 'string' || !p.name.trim()) return 'missing name';
    if (typeof p.category !== 'string' || !p.category.trim()) return 'missing category';
    if (!Number.isInteger(p.price) || p.price <= 0) return 'price must be a whole number above 0 (paise, so 4500 = 45.00)';
    if (p.brand != null && typeof p.brand !== 'string') return 'brand must be text';
    if (p.unit != null && typeof p.unit !== 'string') return 'unit must be text';
    if (p.inStock != null && typeof p.inStock !== 'boolean') return 'inStock must be true or false';
    return '';
  }

  function ingest(list) {
    const problems = [];
    if (!Array.isArray(list)) throw new Error('data/products.json needs a "products" list');

    list.forEach((raw, i) => {
      const where = raw && typeof raw.id === 'string' && raw.id.trim() ? raw.id : `row ${i + 1}`;
      let reason = problemWith(raw);
      if (!reason && state.byId.has(raw.id.trim())) reason = 'duplicate id (each id must be unique)';
      if (reason) { problems.push(`${where}: ${reason}`); return; }

      const p = {
        id: raw.id.trim(),
        name: raw.name.trim(),
        brand: (raw.brand || '').trim(),
        unit: (raw.unit || '').trim(),
        category: raw.category.trim(),
        price: raw.price,
        inStock: raw.inStock !== false
      };
      p.brandKey = p.brand.toLowerCase();                       // "Aachi" and "aachi" count as one brand
      p.search = `${p.name} ${p.brand} ${p.category}`.toLowerCase();
      state.products.push(p);
      state.byId.set(p.id, p);
    });
    return problems;
  }

  // ---------- Filters and product cards ----------
  function renderChips() {
    const cats = ['All', ...new Set(state.products.map((p) => p.category))];
    els.chips.replaceChildren(...cats.map((c) => el('button', {
      type: 'button',
      class: 'chip',
      text: c,
      'aria-pressed': String(c === state.category),
      onclick: () => { state.category = c; state.brand = ''; refreshFilters(); }
    })));
  }

  function renderBrands() {
    const brands = new Map();
    state.products.forEach((p) => {
      if (p.brand && (state.category === 'All' || p.category === state.category) && !brands.has(p.brandKey)) {
        brands.set(p.brandKey, p.brand);
      }
    });
    if (state.brand && !brands.has(state.brand)) state.brand = '';
    const sorted = [...brands.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    els.brand.replaceChildren(
      el('option', { value: '', text: 'All brands' }),
      ...sorted.map(([key, name]) => el('option', { value: key, text: name }))
    );
    els.brand.value = state.brand;
    els.brand.closest('label').hidden = sorted.length === 0;
  }

  function refreshFilters() {
    renderChips();
    renderBrands();
    renderGrid();
  }

  function renderGrid() {
    actionBoxes.clear();
    const q = state.query.trim().toLowerCase();
    const list = state.products.filter((p) =>
      (state.category === 'All' || p.category === state.category) &&
      (!state.brand || p.brandKey === state.brand) &&
      (!q || p.search.includes(q)));

    els.count.textContent = list.length === 1 ? '1 item' : `${list.length} items`;
    if (!list.length) {
      els.grid.replaceChildren(el('p', {
        class: 'empty',
        text: state.products.length ? 'No items match. Try another word or choose All.' : 'No items are available right now.'
      }));
      return;
    }
    els.grid.replaceChildren(...list.map(card));
  }

  function card(p) {
    const actions = el('div', { class: 'actions' });
    actionBoxes.set(p.id, actions);
    renderActions(p.id);
    return el('article', { class: 'card' + (p.inStock ? '' : ' sold-out') },
      el('div', { class: 'info' },
        el('h2', { class: 'name', text: p.name }),
        p.brand ? el('p', { class: 'brand', text: p.brand }) : null,
        p.unit ? el('p', { class: 'unit', text: p.unit }) : null),
      el('div', { class: 'buy' },
        el('span', { class: 'price', text: money(p.price) }),
        actions));
  }

  function stepper(p, qty) {
    return el('div', { class: 'stepper' },
      el('button', {
        type: 'button', class: 'step', text: '−', 'data-k': 'dec-' + p.id,
        'aria-label': `Remove one ${label(p)}`, onclick: () => setQty(p.id, (state.cart[p.id] || 0) - 1)
      }),
      el('span', { class: 'qty', text: String(qty), 'aria-label': `${qty} in cart` }),
      el('button', {
        type: 'button', class: 'step', text: '+', 'data-k': 'inc-' + p.id,
        'aria-label': `Add one ${label(p)}`, onclick: () => setQty(p.id, (state.cart[p.id] || 0) + 1)
      }));
  }

  function renderActions(id) {
    const box = actionBoxes.get(id);
    if (!box) return;
    const p = state.byId.get(id);
    const qty = state.cart[id] || 0;
    if (!p.inStock) {
      box.replaceChildren(el('span', { class: 'sold', text: 'Out of stock' }));
    } else if (!qty) {
      box.replaceChildren(el('button', {
        type: 'button', class: 'btn add', text: 'Add', 'data-k': 'inc-' + id,
        'aria-label': `Add ${label(p)} to cart`, onclick: () => setQty(id, 1)
      }));
    } else {
      box.replaceChildren(stepper(p, qty));
    }
  }

  // ---------- Cart ----------
  function cartLines() {
    return Object.entries(state.cart).map(([id, qty]) => ({ p: state.byId.get(id), qty }));
  }

  function loadCart() {
    const saved = readStore(CART_KEY);
    const clean = {};
    let dropped = 0;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [id, qty] of Object.entries(saved)) {
        const p = state.byId.get(id);
        if (p && p.inStock && Number.isInteger(qty) && qty > 0) clean[id] = Math.min(qty, MAX_QTY);
        else dropped += 1;
      }
    }
    state.cart = clean;
    state.removedFromCart = dropped;
    writeStore(CART_KEY, clean);
  }

  function setQty(id, qty) {
    const p = state.byId.get(id);
    if (!p || !p.inStock) return;
    const next = Math.max(0, Math.min(MAX_QTY, qty));
    if (next) state.cart[id] = next; else delete state.cart[id];
    writeStore(CART_KEY, state.cart);

    // Rebuilding buttons would drop keyboard focus, so put it back on the matching button.
    const active = document.activeElement;
    const key = active && active.dataset ? active.dataset.k : '';
    const inDrawer = els.drawer.contains(active);
    renderActions(id);
    renderHeader();
    renderCart();
    if (inDrawer) restoreFocus(els.drawer, key, els.title);
    else restoreFocus(els.grid, key, null);
  }

  function restoreFocus(root, key, fallback) {
    if (key) {
      for (const k of [key, key.replace(/^dec-/, 'inc-')]) {
        const target = [...root.querySelectorAll('[data-k]')].find((n) => n.dataset.k === k);
        if (target) { target.focus(); return; }
      }
    }
    if (fallback) fallback.focus();
  }

  function renderHeader() {
    const lines = cartLines();
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const total = lines.reduce((n, l) => n + l.p.price * l.qty, 0);
    els.cartCount.textContent = String(count);
    els.cartTotal.textContent = count ? money(total) : '';
  }

  function renderCart() {
    const lines = cartLines();
    const total = lines.reduce((n, l) => n + l.p.price * l.qty, 0);
    els.cartNote.hidden = state.removedFromCart === 0;
    els.cartEmpty.hidden = lines.length > 0;
    els.cartFull.hidden = lines.length === 0;
    els.items.replaceChildren(...lines.map(({ p, qty }) => el('li', { class: 'line' },
      el('div', { class: 'line-info' },
        el('p', { class: 'line-name', text: p.name }),
        el('p', { class: 'line-meta', text: [p.brand, p.unit].filter(Boolean).join(', ') }),
        el('button', {
          type: 'button', class: 'link', text: 'Remove', 'data-k': 'rm-' + p.id,
          'aria-label': `Remove ${label(p)} from cart`, onclick: () => setQty(p.id, 0)
        })),
      el('div', { class: 'line-side' },
        stepper(p, qty),
        el('p', { class: 'line-total', text: money(p.price * qty) })))));
    els.sum.textContent = money(total);
  }

  function openCart() {
    lastFocus = document.activeElement;
    setStatus('');
    renderCart();
    els.overlay.hidden = false;
    els.drawer.hidden = false;
    document.body.classList.add('lock');
    els.closeBtn.focus();
  }

  function closeCart() {
    els.overlay.hidden = true;
    els.drawer.hidden = true;
    document.body.classList.remove('lock');
    state.removedFromCart = 0;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---------- Order and WhatsApp ----------
  function setStatus(message, isError = false) {
    els.status.replaceChildren(message);
    els.status.className = 'status' + (isError ? ' error' : '');
  }

  function buildBill(lines, name, note) {
    const out = [
      `*New order – ${state.config.shopName}*`,
      new Date().toLocaleString(),
      '',
      `Name: ${name}`
    ];
    if (note) out.push(`Address/note: ${note}`);
    out.push('');
    let total = 0;
    lines.forEach(({ p, qty }, i) => {
      const subtotal = p.price * qty;
      total += subtotal;
      const what = p.brand ? `${p.name} – ${p.brand}` : p.name;
      out.push(`${i + 1}. ${what}${p.unit ? ` (${p.unit})` : ''} × ${qty} = ${money(subtotal)}`);
    });
    out.push('-------------------', `*Total: ${money(total)}*`);
    return out.join('\n');
  }

  function sendOrder(event) {
    event.preventDefault();
    setStatus('');

    const lines = cartLines();
    if (!lines.length) return;


    const name = els.name.value.trim();
    if (!name) { setStatus('Please enter your name.', true); els.name.focus(); return; }
    const note = els.note.value.trim();
    writeStore(CUSTOMER_KEY, { name, note });

    const text = buildBill(lines, name, note);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;

    if (url.length <= MAX_URL_LENGTH) {
      const win = window.open(url, '_blank');
      if (!win) window.location.href = url;          // pop-up blocked: open in this tab instead
      setStatus('WhatsApp is opening. Press Send there to place your order.');
    } else {
      sendLongOrder(text);
    }
  }

  // Very large carts: open the chat empty and copy the bill so the customer can paste it.
  function sendLongOrder(text) {
    const win = window.open('https://wa.me/', '_blank');
    if (!win) window.location.href = 'https://wa.me/';
    const copy = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error('no clipboard'));
    copy.then(
      () => setStatus('Your order is long, so it was copied. Paste it into the WhatsApp chat and press Send.'),
      () => {
        const box = el('textarea', { rows: '6', readonly: 'readonly', 'aria-label': 'Your order text' });
        box.value = text;
        els.status.replaceChildren('Copy this order text, paste it into the WhatsApp chat and press Send.', box);
        box.select();
      });
  }

  // ---------- Start-up ----------
  function showFatal(err) {
    console.error(err);
    els.count.textContent = '';
    els.grid.replaceChildren(el('p', { class: 'empty', text: "The item list couldn't load. Please try again in a moment." }));
    showCheck([`Technical details: ${err.message}`]);
  }

  function showCheck(problems) {
    if (!SHOW_CHECK || !problems.length) return;
    els.notice.replaceChildren(
      el('strong', { text: 'Owner check: fix these in the data files' }),
      el('ul', {}, problems.map((text) => el('li', { text }))));
    els.notice.hidden = false;
  }

  async function init() {
    const problems = [];
    try {
      const [config, data] = await Promise.all([
        loadJson('data/config.json').catch((err) => { problems.push(err.message); return {}; }),
        loadJson('data/products.json')
      ]);
      state.config = { ...state.config, ...config };
      problems.push(...ingest(data.products));
    } catch (err) {
      showFatal(err);
      return;
    }
    problems.forEach((text) => console.warn('Catalog problem:', text));

    document.title = state.config.shopName;
    els.shopName.textContent = state.config.shopName;

    loadCart();
    const customer = readStore(CUSTOMER_KEY);
    if (customer && typeof customer === 'object') {
      els.name.value = typeof customer.name === 'string' ? customer.name : '';
      els.note.value = typeof customer.note === 'string' ? customer.note : '';
    }

    refreshFilters();
    renderHeader();
    renderCart();
    showCheck(problems);

    els.search.addEventListener('input', () => { state.query = els.search.value; renderGrid(); });
    els.brand.addEventListener('change', () => { state.brand = els.brand.value; renderGrid(); });
    els.cartBtn.addEventListener('click', openCart);
    els.closeBtn.addEventListener('click', closeCart);
    els.overlay.addEventListener('click', closeCart);
    els.form.addEventListener('submit', sendOrder);
    els.clear.addEventListener('click', () => {
      if (!confirm('Remove all items from the cart?')) return;
      state.cart = {};
      writeStore(CART_KEY, state.cart);
      renderGrid();
      renderHeader();
      renderCart();
      els.title.focus();
    });

    document.addEventListener('keydown', (e) => {
      if (els.drawer.hidden) return;
      if (e.key === 'Escape') { closeCart(); return; }
      if (e.key !== 'Tab') return;
      const focusable = [...els.drawer.querySelectorAll('button, input, textarea, select')]
        .filter((n) => !n.disabled && n.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === els.title)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }

  init();
})();
