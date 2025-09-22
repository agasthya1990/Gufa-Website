// app.cart.js — cart table wired to your existing cart.store.js (no UI changes)

// NOTE: cart.store.js attaches a global `Cart` with:
//   Cart.get() -> { [key]: { id, name, variant, price, qty, thumb? } }
//   Cart.setQty(key, qty, meta) -> updates one line (removes if qty <= 0)
//   Cart.clear() -> empties cart
// It also fires: window.dispatchEvent(new CustomEvent("cart:update", { detail: { cart } }))

(function () {
  const $$ = (sel) => document.querySelector(sel);

  const $body   = $$("#cartBody");   // <tbody>
  const $total  = $$("#cartTotal");  // <span id="cartTotal">
  const $count  = document.getElementById("cart-count"); // optional header badge if present

  function asEntries() {
    // { key: item } -> [ [key, item], ... ]
    const bag = (window.Cart && Cart.get && Cart.get()) || {};
    return Object.entries(bag);
  }

  function computeSubtotal() {
    return asEntries().reduce((sum, [, it]) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  }

  function computeCount() {
    return asEntries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
  }

  function formatINR(v) {
    return "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
  }

  function updateHeaderCount() {
    if ($count) $count.textContent = String(computeCount());
  }

  function renderEmpty() {
    $body.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
    $total.textContent = formatINR(0);
    updateHeaderCount();
  }

  function lineRow(key, it) {
    // builds one <tr> with image, name/variant, unit price, qty stepper, subtotal
    const tr = document.createElement("tr");

    const tdImg = document.createElement("td");
    tdImg.innerHTML = it.thumb
      ? `<img src="${it.thumb}" alt="${it.name}" class="thumb" loading="lazy"/>`
      : "";

    const tdName = document.createElement("td");
    tdName.innerHTML = `<div class="name">${it.name || ""}</div>
                        <div class="muted">${it.variant || ""}</div>`;

    const tdPrice = document.createElement("td");
    tdPrice.textContent = formatINR(it.price || 0);

    const tdQty = document.createElement("td");
    tdQty.className = "qty-cell";
    const minus = document.createElement("button");
    const plus  = document.createElement("button");
    const out   = document.createElement("span");
    minus.className = "qty-btn dec";
    plus.className  = "qty-btn inc";
    minus.textContent = "–";
    plus.textContent  = "+";
    out.className     = "qty-out";
    out.textContent   = String(it.qty || 0);
    tdQty.append(minus, out, plus);

    const tdSub = document.createElement("td");
    tdSub.className = "subtotal";
    tdSub.textContent = formatINR((Number(it.price) || 0) * (Number(it.qty) || 0));

    // wire actions
    plus.addEventListener("click", () => {
      const next = (Number(Cart.get()?.[key]?.qty) || 0) + 1;
      Cart.setQty(key, next, it); // keep same meta (name, variant, price, thumb)
    });

    minus.addEventListener("click", () => {
      const prev = Number(Cart.get()?.[key]?.qty) || 0;
      const next = Math.max(0, prev - 1);
      Cart.setQty(key, next, it);
    });

    tr.append(tdImg, tdName, tdPrice, tdQty, tdSub);
    return tr;
  }

  function render() {
    const entries = asEntries();

    if (!entries.length) {
      renderEmpty();
      return;
    }

    // fill rows
    $body.innerHTML = "";
    for (const [key, it] of entries) {
      $body.appendChild(lineRow(key, it));
    }

    // totals
    $total.textContent = formatINR(computeSubtotal());
    updateHeaderCount();
  }

  // Initial render
  document.addEventListener("DOMContentLoaded", render);

  // Re-render on any cart change
  window.addEventListener("cart:update", render);
})();
