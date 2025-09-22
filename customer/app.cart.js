// app.cart.js — wired to your existing table DOM and your Cart store (no imports, no CSS changes)

(function () {
  const $ = (s) => document.querySelector(s);

  const $body  = $("#cartBody");   // <tbody>
  const $total = $("#cartTotal");  // <span id="cartTotal">
  const $count = $("#cart-count"); // header badge (if present)

  if (!$body || !$total) {
    // Safety: if this page doesn't have the table layout, do nothing.
    return;
  }

  function inr(v) {
    return "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
  }

  function entries() {
    const bag = (window.Cart && Cart.get && Cart.get()) || {};
    return Object.entries(bag); // [ [key, item], ... ]
  }

  function lineSubtotal(it) {
    return (Number(it.price) || 0) * (Number(it.qty) || 0);
  }

  function subtotal() {
    return entries().reduce((sum, [, it]) => sum + lineSubtotal(it), 0);
  }

  function itemRow(key, it) {
    const tr = document.createElement("tr");

    const tdImg = document.createElement("td");
    tdImg.innerHTML = it.thumb
      ? `<img src="${it.thumb}" alt="${it.name || ""}" class="thumb" loading="lazy"/>`
      : "";

    const tdName = document.createElement("td");
    tdName.innerHTML = `<div class="name">${it.name || ""}</div>
                        <div class="muted">${it.variant || ""}</div>`;

    const tdPrice = document.createElement("td");
    tdPrice.textContent = inr(it.price || 0);

    const tdQty = document.createElement("td");
    tdQty.className = "qty-cell";
    const btnMinus = document.createElement("button");
    const qtyOut   = document.createElement("span");
    const btnPlus  = document.createElement("button");
    btnMinus.className = "qty-btn dec"; btnMinus.textContent = "–";
    btnPlus.className  = "qty-btn inc"; btnPlus.textContent  = "+";
    qtyOut.className   = "qty-out";     qtyOut.textContent   = String(it.qty || 0);
    tdQty.append(btnMinus, qtyOut, btnPlus);

    const tdSub = document.createElement("td");
    tdSub.className = "subtotal";
    tdSub.textContent = inr(lineSubtotal(it));

    // actions
    btnPlus.addEventListener("click", () => {
      const next = (Number(Cart.get()?.[key]?.qty) || 0) + 1;
      Cart.setQty(key, next, it); // keep same meta (name, variant, price, thumb)
    });

    btnMinus.addEventListener("click", () => {
      const prev = Number(Cart.get()?.[key]?.qty) || 0;
      const next = Math.max(0, prev - 1);
      Cart.setQty(key, next, it);
    });

    tr.append(tdImg, tdName, tdPrice, tdQty, tdSub);
    return tr;
  }

  function render() {
    const es = entries();

    if (!es.length) {
      $body.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
      $total.textContent = inr(0);
      if ($count) $count.textContent = "0";
      return;
    }

    $body.innerHTML = "";
    for (const [key, it] of es) $body.appendChild(itemRow(key, it));

    $total.textContent = inr(subtotal());
    if ($count) {
      const n = es.reduce((acc, [, it]) => acc + (Number(it.qty) || 0), 0);
      $count.textContent = String(n);
    }
  }

  // First paint + keep in sync with store
  document.addEventListener("DOMContentLoaded", render);
  window.addEventListener("cart:update", render);
})();
