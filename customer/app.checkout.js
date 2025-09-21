// app.checkout.js
import { Cart } from "./app.cart.js";
const FUNCTIONS_BASE = "https://us-central1-gufa-restaurant.cloudfunctions.net"; // keep as-is

function calcTotals(items) {
  const subtotal = items.reduce((s, i) => s + (Number(i.price) * Number(i.qty)), 0);
  const discount = 0;
  const total = Math.max(0, subtotal - discount);
  return { subtotal, discount, total };
}

// --- NEW: coupon state
let appliedCoupon = "";
let currentQuote = null; // { subtotal, discount, total, coupon?: { code, type, value } }

function renderSummary() {
  const items = Object.values(Cart.get());
  const list = document.getElementById("cartList");
  const totalsEl = document.getElementById("totals");

  if (!items.length) {
    list.innerHTML = "<p>Your cart is empty.</p>";
    totalsEl.textContent = "";
    return;
  }

  list.innerHTML = items.map(i =>
    `<div class="row" style="justify-content:space-between;">
      <div>${i.qty} × ${i.name} ${i.variant !== "single" ? `<small>(${i.variant})</small>` : ""}</div>
      <strong>₹${Number(i.price) * Number(i.qty)}</strong>
    </div>`
  ).join("");

  // Prefer server quote (when a coupon is applied), else local calc
  const t = currentQuote
    ? { subtotal: currentQuote.subtotal, discount: currentQuote.discount, total: currentQuote.total }
    : calcTotals(items);

  totalsEl.innerHTML = `
    <div class="row" style="justify-content:space-between;"><div>Subtotal</div><div>₹${t.subtotal}</div></div>
    <div class="row" style="justify-content:space-between;"><div>Discount</div><div>− ₹${t.discount}</div></div>
    <div class="row" style="justify-content:space-between;"><strong>Total</strong><strong>₹${t.total}</strong></div>
  `;
}

async function applyCoupon() {
  const codeInput = document.getElementById("couponCode");
  const msg = document.getElementById("couponMsg");
  const code = (codeInput.value || "").trim();
  const items = Object.values(Cart.get());
  if (!items.length) { msg.textContent = "Cart is empty"; return; }
  if (!code) { msg.textContent = "Enter a code"; return; }

  msg.textContent = "Checking…";
  try {
    const phone = document.getElementById("cPhone")?.value.trim() || ""; // used for per-user limits
    const resp = await fetch(`${FUNCTIONS_BASE}/validateCoupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, couponCode: code, customer: { phone } })
    });
    const data = await resp.json();
    if (!resp.ok || !data.valid) throw new Error(data.reason || "Invalid coupon");

    appliedCoupon = code.toUpperCase();
    currentQuote = data;
    msg.textContent = `Applied ✓ ${data.coupon?.code || ""}`;
    renderSummary();
  } catch (err) {
    appliedCoupon = "";
    currentQuote = null;
    msg.textContent = err.message || "Coupon not valid";
    renderSummary();
  }
}

document.getElementById("applyCouponBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  applyCoupon();
});

function renderSummaryAndMaybeResetQuote() {
  // If cart changed after applying coupon, you could clear the quote. For MVP we keep it as-is.
  renderSummary();
}

renderSummaryAndMaybeResetQuote();

// --- submit order (include couponCode)
async function submitOrder(e) {
  e.preventDefault();
  const items = Object.values(Cart.get());
  const msg = document.getElementById("placeMsg");
  if (!items.length) { msg.textContent = "Cart is empty"; return; }

  const name = document.getElementById("cName").value.trim();
  const phone = document.getElementById("cPhone").value.trim();
  const address = document.getElementById("cAddress").value.trim();

  msg.textContent = "Placing order…";
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;

  try {
    const resp = await fetch(`${FUNCTIONS_BASE}/placeOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items,
        customer: { name, phone, address },
        method: "COD",
        couponCode: appliedCoupon || null
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to place order");

    Cart.clear();
    window.location.href = `customer/track.html?order=${encodeURIComponent(data.orderId)}`;
  } catch (err) {
    msg.textContent = err.message || "Something went wrong";
  } finally {
    btn.disabled = false;
  }
}
document.getElementById("checkoutForm").addEventListener("submit", submitOrder);
