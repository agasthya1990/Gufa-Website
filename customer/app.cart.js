// customer/app.cart.ui.js
import { Cart } from "./app.cart.js";

const FUNCTIONS_BASE = "https://us-central1-gufa-restaurant.cloudfunctions.net";
const COUPON_KEY = "gufa_coupon";

// ---------- utils ----------
const $ = (s, r = document) => r.querySelector(s);
const fmt = (n) => `₹${Number(n || 0)}`;

function cartItems() {
  return Object.values(Cart.get() || {});
}
function qtySum(items) {
  return items.reduce((s, i) => s + Number(i.qty || 0), 0);
}

// coupon state persisted across pages
function getSavedCoupon() {
  try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); }
  catch { return null; }
}
function saveCoupon(obj) {
  if (!obj) localStorage.removeItem(COUPON_KEY);
  else localStorage.setItem(COUPON_KEY, JSON.stringify(obj));
}

// ---------- badge ----------
function renderBadge() {
  const a = $("#cartLink");
  if (!a) return;
  const items = cartItems();
  a.textContent = `Cart (${qtySum(items)})`;
}

// ---------- drawer skeleton ----------
function ensureDrawer() {
  if ($("#cartDrawer")) return $("#cartDrawer");
  const el = document.createElement("div");
  el.id = "cartDrawer";
  el.innerHTML = `
    <div class="cd-overlay" data-close></div>
    <aside class="cd-panel">
      <header class="cd-head">
        <strong>Your Cart</strong>
        <button class="cd-close" data-close>&times;</button>
      </header>
      <div class="cd-body">
        <div id="cdList"></div>
        <hr class="cd-hr"/>
        <div class="cd-coupon">
          <input id="cdCoupon" class="cd-input" placeholder="Coupon code"/>
          <button id="cdApply" class="cd-btn">Apply</button>
          <small id="cdMsg" class="cd-msg"></small>
        </div>
        <div id="cdTotals" class="cd-totals"></div>
      </div>
      <footer class="cd-foot">
        <a href="customer/checkout.html" class="cd-btn cd-primary">Go to Checkout</a>
        <button id="cdClear" class="cd-btn cd-ghost">Clear Cart</button>
      </footer>
    </aside>
  `;
  document.body.appendChild(el);

  // close handlers
  el.addEventListener("click", (e) => {
    if (e.target.matches("[data-close]")) closeDrawer();
  });
  return el;
}
function openDrawer() { ensureDrawer().classList.add("is-open"); renderDrawer(); }
function closeDrawer() { $("#cartDrawer")?.classList.remove("is-open"); }

// ---------- render ----------
function currentQuoteOrNull(subtotal) {
  const saved = getSavedCoupon();
  if (!saved?.quote) return null;
  // if cart changed since quote, invalidate to avoid stale totals
  if (Number(saved.quote.subtotal) !== Number(subtotal)) return null;
  return saved.quote;
}

async function applyCouponFromDrawer() {
  const codeEl = $("#cdCoupon");
  const msg = $("#cdMsg");
  const code = (codeEl.value || "").trim();
  const items = cartItems();
  if (!items.length) { msg.textContent = "Cart is empty"; return; }
  if (!code) { msg.textContent = "Enter a code"; return; }

  msg.textContent = "Checking…";
  try {
    // we don't collect phone on homepage; pass blank. Per-user limit will be enforced on checkout too.
    const resp = await fetch(`${FUNCTIONS_BASE}/validateCoupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, couponCode: code, customer: { phone: "" } })
    });
    const data = await resp.json();
    if (!resp.ok || !data.valid) throw new Error(data.reason || "Invalid coupon");

    saveCoupon({ code: data.coupon?.code || code.toUpperCase(), quote: data });
    msg.textContent = "Applied ✓";
    renderDrawer();
  } catch (e) {
    saveCoupon(null);
    msg.textContent = e.message || "Coupon not valid";
    renderDrawer();
  }
}

function renderDrawer() {
  const list = $("#cdList");
  const tEl = $("#cdTotals");
  const items = cartItems();

  if (!items.length) {
    list.innerHTML = `<p class="cd-empty">Your cart is empty.</p>`;
    tEl.innerHTML = "";
    return;
  }

  list.innerHTML = items.map(i => `
    <div class="cd-row">
      <div class="cd-line">
        <span>${i.qty} × ${i.name}${i.variant && i.variant !== "single" ? ` <small>(${i.variant})</small>` : ""}</span>
        <strong>${fmt(Number(i.price) * Number(i.qty))}</strong>
      </div>
    </div>
  `).join("");

  const subtotal = items.reduce((s, i) => s + (Number(i.price) * Number(i.qty)), 0);
  const quote = currentQuoteOrNull(subtotal);
  const discount = quote ? quote.discount : 0;
  const total = Math.max(0, subtotal - discount);

  tEl.innerHTML = `
    <div class="cd-line"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="cd-line"><span>Discount</span><span>− ${fmt(discount)}</span></div>
    <div class="cd-line cd-strong"><span>Total</span><span>${fmt(total)}</span></div>
  `;

  // preload coupon input with saved code, if any
  const saved = getSavedCoupon();
  const input = $("#cdCoupon");
  if (saved?.code && input && !input.value) input.value = saved.code;
}

// ---------- events ----------
function bindEvents() {
  $("#cartLink")?.addEventListener("click", (e) => {
    // open drawer but keep link usable (meta-click etc.)
    if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
      e.preventDefault();
      openDrawer();
    }
  });
  document.addEventListener("visibilitychange", renderBadge);
  window.addEventListener("storage", (e) => {
    if (e.key === Cart.KEY || e.key === COUPON_KEY) {
      renderBadge();
      renderDrawer();
    }
  });
  $("#cartDrawer")?.querySelector("#cdApply")?.addEventListener("click", (e) => {
    e.preventDefault();
    applyCouponFromDrawer();
  });
  $("#cartDrawer")?.querySelector("#cdClear")?.addEventListener("click", (e) => {
    e.preventDefault();
    Cart.clear();
    saveCoupon(null);
    renderBadge();
    renderDrawer();
  });
}

// ---------- boot ----------
ensureDrawer();
renderBadge();
bindEvents();
