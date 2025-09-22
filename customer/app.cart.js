// app.cart.js — renders cart into the list + summary layout using your existing Cart store.
// No imports, no global CSS edits.

(function () {
  const $ = (s) => document.querySelector(s);

  // DOM
  const $list = $("#cart-items");
  const $empty = $("#cart-empty");
  const $itemsCount = $("#cart-items-count");
  const $addonsNote = $("#addons-note");

  const $subtotal = $("#subtotal-amt");
  const $gst = $("#gst-amt");
  const $delivery = $("#delivery-amt");
  const $total = $("#total-amt");

  const $countTop = $("#cart-count");
  const $proceed = $("#proceed-btn");

  // Display rules you asked for
  const GST_PERCENT = 5; // tweakable later
  const DELIVERY_TEXT = "Shown at payment"; // for now

  function inr(v) { return "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN"); }

  function entries() {
    const bag = (window.Cart && Cart.get && Cart.get()) || {};
    return Object.entries(bag); // [ [key, {id,name,variant,price,qty,thumb?}], ... ]
  }

  function count() { return entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0); }
  function subtotal() { return entries().reduce((s, [, it]) => s + (Number(it.price)||0)*(Number(it.qty)||0), 0); }
  function calcGST(sub) { return Math.max(0, (sub * GST_PERCENT) / 100); }

  function renderCounts() {
    const n = count();
    if ($itemsCount) $itemsCount.textContent = `(${n} ${n === 1 ? "item" : "items"})`;
    if ($countTop) $countTop.textContent = String(n);
    if ($proceed) $proceed.disabled = n === 0;

    if ($empty) $empty.hidden = n > 0;
    if ($list) $list.hidden = n === 0;
    if ($addonsNote) $addonsNote.style.display = n > 0 ? "block" : "none";
  }

  function line(key, it) {
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
    const out = document.createElement("output"); out.textContent = String(it.qty || 0);
    const plus = document.createElement("button"); plus.textContent = "+";
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
    return li;
  }

  function renderList() {
    const es = entries();
    $list.innerHTML = "";
    for (const [key, it] of es) $list.appendChild(line(key, it));
  }

  function renderTotals() {
    const sub = subtotal();
    const gst = calcGST(sub);
    const grand = sub + gst; // delivery shown later

    if ($subtotal) $subtotal.textContent = inr(sub);
    if ($gst) $gst.textContent = inr(gst);
    if ($delivery) $delivery.textContent = DELIVERY_TEXT;
    if ($total) $total.textContent = inr(grand);
  }

  function syncAll() { renderCounts(); renderList(); renderTotals(); }

  // boot
  document.addEventListener("DOMContentLoaded", syncAll);
  window.addEventListener("cart:update", syncAll);

  // proceed (payment later)
  $proceed?.addEventListener("click", () => {
    if (count() === 0) return;
    alert("Cart confirmed. Payment step will be added next.");
  });
})();
