// app.cart.js — cart wired to existing store, with site-consistent layout and totals.
// No changes to overall site styles; this script just fills the cart page cleanly.

(function () {
  const $ = (s) => document.querySelector(s);

  // DOM hooks
  const $countTop = $("#cart-count");
  const $itemsCount = $("#cart-items-count");
  const $empty = $("#cart-empty");
  const $list = $("#cart-items");
  const $addonsNote = $("#addons-note");

  const $subtotal = $("#subtotal-amt");
  const $gst = $("#gst-amt");
  const $delivery = $("#delivery-amt");
  const $total = $("#total-amt");
  const $proceed = $("#proceed-btn");

  // simple rules (you asked to “show it in this format for now”)
  const GST_PERCENT = 5; // can be changed later if needed

  function inr(v) {
    return "₹" + Math.round(v || 0).toLocaleString("en-IN");
  }

  function entries() {
    const bag = (window.Cart && Cart.get && Cart.get()) || {};
    return Object.entries(bag);
  }

  function count() {
    return entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
  }

  function subtotal() {
    return entries().reduce((sum, [, it]) => {
      const unit = Number(it.price) || 0;
      const qty = Number(it.qty) || 0;
      return sum + unit * qty;
    }, 0);
  }

  function calcGST(sub) {
    return Math.max(0, (sub * GST_PERCENT) / 100);
  }

  function renderCounts() {
    const n = count();
    if ($countTop) $countTop.textContent = n;
    if ($itemsCount) $itemsCount.textContent = `(${n} ${n === 1 ? "item" : "items"})`;
    $empty.hidden = n > 0;
    $list.hidden = n === 0;
    $proceed.disabled = n === 0;

    // soft reminder for add-ons (always show if there are any items)
    $addonsNote.style.display = n > 0 ? "block" : "none";
  }

  function row(key, it) {
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

    // stepper
    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out = document.createElement("output"); out.textContent = String(it.qty || 0);
    const plus = document.createElement("button"); plus.textContent = "+";
    stepper.append(minus, out, plus);

    const subtotalEl = document.createElement("div");
    subtotalEl.className = "line-subtotal";
    subtotalEl.textContent = inr((Number(it.price) || 0) * (Number(it.qty) || 0));

    const remove = document.createElement("button");
    remove.className = "remove-link";
    remove.textContent = "Remove";

    // actions
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

    // build
    mid.append(title, sub);
    right.append(stepper, subtotalEl, remove);
    li.append(img, mid, right);
    return li;
  }

  function renderList() {
    const es = entries();
    $list.innerHTML = "";
    for (const [key, it] of es) $list.appendChild(row(key, it));
  }

  function renderTotals() {
    const sub = subtotal();
    const gst = calcGST(sub);
    const grand = sub + gst; // delivery shown later at payment
    $subtotal.textContent = inr(sub);
    $gst.textContent = inr(gst);
    $delivery.textContent = "Shown at payment";
    $total.textContent = inr(grand);
  }

  function syncAll() {
    renderCounts();
    renderList();
    renderTotals();
  }

  // initial + subscribe
  document.addEventListener("DOMContentLoaded", syncAll);
  window.addEventListener("cart:update", syncAll);

  // proceed (no gateway yet)
  $("#proceed-btn")?.addEventListener("click", () => {
    if (count() === 0) return;
    alert("Cart confirmed. Payment step will be added next.");
  });
})();
