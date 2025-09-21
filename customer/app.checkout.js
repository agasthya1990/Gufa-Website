import { Cart } from "./app.cart.js";

const FUNCTIONS_BASE = "https://us-central1-<PROJECT-ID>.cloudfunctions.net"; // <-- change this

function calcTotals(items) {
  const subtotal = items.reduce((s, i) => s + (Number(i.price) * Number(i.qty)), 0);
  const discount = 0; // coupons later
  const total = Math.max(0, subtotal - discount);
  return { subtotal, discount, total };
}

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

  const t = calcTotals(items);
  totalsEl.innerHTML = `
    <div class="row" style="justify-content:space-between;"><div>Subtotal</div><div>₹${t.subtotal}</div></div>
    <div class="row" style="justify-content:space-between;"><div>Discount</div><div>− ₹${t.discount}</div></div>
    <div class="row" style="justify-content:space-between;"><strong>Total</strong><strong>₹${t.total}</strong></div>
  `;
}

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
        method: "COD"
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

renderSummary();
document.getElementById("checkoutForm").addEventListener("submit", submitOrder);

