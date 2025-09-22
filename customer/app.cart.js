// app.cart.js — connects the cart page to your existing Cart store and current DOM.
// Works with either layout:
//   A) Old table:    #cartBody, #cartTotal
//   B) New list:     #cart-items, #subtotal-amt, #gst-amt, #delivery-amt, #total-amt

(function () {
  const $ = (s) => document.querySelector(s);

  // Try both layouts
  const $tableBody = $("#cartBody");               // old layout
  const $tableTotal = $("#cartTotal");

  const $list = $("#cart-items");                  // new layout
  const $empty = $("#cart-empty");
  const $itemsCount = $("#cart-items-count");
  const $addonsNote = $("#addons-note");

  const $subtotal = $("#subtotal-amt");
  const $gst = $("#gst-amt");
  const $delivery = $("#delivery-amt");
  const $total = $("#total-amt");

  const $countTop = $("#cart-count");
  const $proceed = $("#proceed-btn");

  // Display rules (as discussed)
  const GST_PERCENT = 5; // change here if you later decide a different GST %
  const DELIVERY_TEXT = "Shown at payment"; // for now we only display the text

  function inr(v) { return "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN"); }

  function entries() {
    const bag = (window.Cart && Cart.get && Cart.get()) || {};
    return Object.entries(bag); // [ [key, item], ... ]
  }

  function count() {
    return entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
  }

  function subtotal() {
    return entries().reduce((sum, [, it]) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  }

  function calcGST(sub) { return Math.max(0, (sub * GST_PERCENT) / 100); }

  // ---------- Old TABLE layout (A) ----------
  function renderTable() {
    if (!$tableBody || !$tableTotal) return false;

    const es = entries();
    if (!es.length) {
      $tableBody.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
      $tableTotal.textContent = inr(0);
      if ($countTop) $countTop.textContent = "0";
      return true;
    }

    $tableBody.innerHTML = "";
    for (const [key, it] of es) {
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
      const qtyOut = document.createElement("span");
      const btnPlus = document.createElement("button");
      btnMinus.className = "qty-btn dec"; btnMinus.textContent = "–";
      btnPlus.className = "qty-btn inc";  btnPlus.textContent = "+";
      qtyOut.className = "qty-out";       qtyOut.textContent = String(it.qty || 0);
      tdQty.append(btnMinus, qtyOut, btnPlus);

      const tdSub = document.createElement("td");
      tdSub.className = "subtotal";
      tdSub.textContent = inr((Number(it.price) || 0) * (Number(it.qty) || 0));

      btnPlus.addEventListener("click", () => {
        const next = (Number(Cart.get()?.[key]?.qty) || 0) + 1;
        Cart.setQty(key, next, it);
      });
      btnMinus.addEventListener("click", () => {
        const prev = Number(Cart.get()?.[key]?.qty) || 0;
        const next = Math.max(0, prev - 1);
        Cart.setQty(key, next, it);
      });

      tr.append(tdImg, tdName, tdPrice, tdQty, tdSub);
      $tableBody.appendChild(tr);
    }

    $tableTotal.textContent = inr(subtotal());
    if ($countTop) $countTop.textContent = String(count());
    return true;
  }

  // ---------- New LIST layout (B) ----------
  function renderList() {
    if (!$list) return false;

    const es = entries();
    const n = count();

    if ($empty) $empty.hidden = n > 0;
    $list.hidden = n === 0;
    if ($itemsCount) $itemsCount.textContent = `(${n} ${n === 1 ? "item" : "items"})`;
    if ($countTop) $countTop.textContent = String(n);
    if ($proceed) $proceed.disabled = n === 0;
    if ($addonsNote) $addonsNote.style.display = n > 0 ? "block" : "none";

    $list.innerHTML = "";
    for (const [key, it] of es) {
      const li = document.createElement("li");
      li.className = "cart-row";
      li.dataset.key = key;

      const img = document.createElement("img");
      img.className = "card-thumb";
      img.alt = it.name || "";
      img.loading = "lazy";
      img.src = it.thumb || "";
      img.onerror = () => { img.src = ""; };

      const mid = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "cart-title";
      title.textContent = it.name || "";
      const sub = document.createElement("p");
      sub.className = "cart-sub";
      sub.textContent = `${it.variant || ""} • ${inr(Number(it.price) || 0)}`;

      const right = document.createElement("div");
      right.className = "row-right";

      const stepper = document.createElement("div");
      stepper.className = "stepper";
      const minus = document.createElement("button"); minus.textContent = "–";
      const out = document.createElement("output");  out.textContent = String(it.qty || 0);
      const plus = document.createElement("button");  plus.textContent = "+";
      stepper.append(minus, out, plus);

      const lineSub = document.createElement("div");
      lineSub.className = "line-subtotal";
      lineSub.textContent = inr((Number(it.price) || 0) * (Number(it.qty) || 0));

      const remove = document.createElement("button");
      remove.className = "remove-link";
      remove.textContent = "Remove";

      plus.addEventListener("click", () => {
        const next = (Number(Cart.get()?.[key]?.qty) || 0) + 1;
        Cart.setQty(key, next, it);
      });
      minus.addEventListener("click", () => {
        const prev = Number(Cart.get()?.[key]?.qty) || 0;
        const next = Math.max(0, prev - 1);
        Cart.setQty(key, next, it);
      });
      remove.addEventListener("click", () => {
        Cart.setQty(key, 0);
      });

      mid.append(title, sub);
      right.append(stepper, lineSub, remove);
      li.append(img, mid, right);
      $list.appendChild(li);
    }

    // Totals (Subtotal + GST; delivery shown at payment)
    if ($subtotal && $gst && $delivery && $total) {
      const subVal = subtotal();
      const gstVal = calcGST(subVal);
      const totalVal = subVal + gstVal;
      $subtotal.textContent = inr(subVal);
      $gst.textContent = inr(gstVal);
      $delivery.textContent = DELIVERY_TEXT;
      $total.textContent = inr(totalVal);
    }

    return true;
  }

  function render() {
    // Prefer new list layout if present; otherwise fall back to old table.
    if (renderList()) return;
    renderTable();
  }

  document.addEventListener("DOMContentLoaded", render);
  window.addEventListener("cart:update", render);

  // Proceed (placeholder until gateway)
  $("#proceed-btn")?.addEventListener("click", () => {
    if (count() === 0) return;
    alert("Cart confirmed. Payment step will be added next.");
  });
})();
