// app.cart.js — cart renderer with selector adapter.
// Uses window.CART_UI to find the right elements on YOUR page.
// Falls back to default IDs if no config is provided.

(function () {
  const $ = (s) => s ? document.querySelector(s) : null;

  // ---- 1) Read mapping (list OR table) ----
  const CFG = (window.CART_UI || {});
  const LIST = CFG.list || null;
  const TABLE = CFG.table || null;

  // DEFAULTS if no config is given (you can remove these if you want it strict)
  const defaultsList = {
    items: '#cart-items',
    empty: '#cart-empty',
    count: '#cart-items-count',
    addonsNote: '#addons-note',
    subtotal: '#subtotal-amt',
    gst: '#gst-amt',
    delivery: '#delivery-amt',
    total: '#total-amt',
    proceed: '#proceed-btn'
  };
  const defaultsTable = {
    body: '#cartBody',
    total: '#cartTotal'
  };

  const USE_LIST = LIST ? true : (TABLE ? false : !!document.querySelector(defaultsList.items));
  const useListCfg = LIST || (USE_LIST ? defaultsList : null);
  const useTableCfg = TABLE || (!USE_LIST ? defaultsTable : null);

  // ---- 2) Grab elements based on chosen mapping ----
  // header badge is optional and common
  const $countTop = $('#cart-count');

  // List layout refs
  const $list       = USE_LIST ? $(useListCfg.items)      : null;
  const $empty      = USE_LIST ? $(useListCfg.empty)      : null;
  const $itemsCount = USE_LIST ? $(useListCfg.count)      : null;
  const $addonsNote = USE_LIST ? $(useListCfg.addonsNote) : null;
  const $subtotal   = USE_LIST ? $(useListCfg.subtotal)   : null;
  const $gst        = USE_LIST ? $(useListCfg.gst)        : null;
  const $delivery   = USE_LIST ? $(useListCfg.delivery)   : null;
  const $total      = USE_LIST ? $(useListCfg.total)      : null;
  const $proceed    = USE_LIST ? $(useListCfg.proceed)    : null;

  // Table layout refs
  const $tableBody  = !USE_LIST ? $(useTableCfg.body)  : null;
  const $tableTotal = !USE_LIST ? $(useTableCfg.total) : null;

  // If neither layout is found, log once and stop
  const listOk = USE_LIST && $list && ($subtotal || $tableTotal || $total);
  const tableOk = !USE_LIST && $tableBody && $tableTotal;
  if (!listOk && !tableOk) {
    console.warn("[cart] No usable layout found. Provide window.CART_UI with your selectors.");
    return;
  }

  // ---- 3) Helpers ----
  const GST_PERCENT = 5;
  const DELIVERY_TEXT = "Shown at payment";
  const INR = (v) => "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");

  const entries = () => {
    try { return Object.entries(window.Cart?.get?.() || {}); }
    catch { return []; }
  };
  const count = () => entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
  const subtotal = () => entries().reduce((s, [, it]) => s + (Number(it.price)||0)*(Number(it.qty)||0), 0);
  const gst = (s) => Math.max(0, (s * GST_PERCENT) / 100);

  // ---- 4) Renderers ----
  function renderList() {
    const es = entries();
    const n = count();

    if ($empty) $empty.hidden = n > 0;
    if ($list)  $list.hidden  = n === 0;
    if ($itemsCount) $itemsCount.textContent = `(${n} ${n === 1 ? "item" : "items"})`;
    if ($countTop) $countTop.textContent = String(n);
    if ($proceed) $proceed.disabled = n === 0;
    if ($addonsNote) $addonsNote.style.display = n > 0 ? "block" : "none";

    if ($list) {
      $list.innerHTML = "";
      for (const [key, it] of es) $list.appendChild(lineItem(key, it));
    }

    if ($subtotal && $gst && $delivery && $total) {
      const sub = subtotal();
      const g   = gst(sub);
      $subtotal.textContent = INR(sub);
      $gst.textContent      = INR(g);
      $delivery.textContent = DELIVERY_TEXT;
      $total.textContent    = INR(sub + g);
    }
  }

  function lineItem(key, it) {
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
    sub.textContent = `${it.variant || ""} • ${INR(Number(it.price) || 0)}`;

    const right = document.createElement("div");
    right.className = "row-right";

    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    lineSub.textContent = INR((Number(it.price) || 0) * (Number(it.qty) || 0));

    const remove = document.createElement("button");
    remove.className = "remove-link";
    remove.textContent = "Remove";

    plus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[key]?.qty) || 0) + 1;
      window.Cart.setQty(key, next, it);
    });
    minus.addEventListener("click", () => {
      const prev = Number(window.Cart.get()?.[key]?.qty) || 0;
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(key, next, it);
    });
    remove.addEventListener("click", () => {
      window.Cart.setQty(key, 0);
    });

    mid.append(title, sub);
    right.append(stepper, lineSub, remove);
    li.append(img, mid, right);
    return li;
  }

  function renderTable() {
    const es = entries();
    if ($tableBody) {
      if (!es.length) {
        $tableBody.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
      } else {
        $tableBody.innerHTML = "";
        for (const [key, it] of es) $tableBody.appendChild(rowB(key, it));
      }
    }
    if ($tableTotal) $tableTotal.textContent = INR(subtotal());
    if ($countTop)   $countTop.textContent   = String(count());
  }

  function rowB(key, it) {
    const tr = document.createElement("tr");

    const tdImg = document.createElement("td");
    tdImg.innerHTML = it.thumb ? `<img src="${it.thumb}" alt="${it.name || ""}" class="thumb" loading="lazy"/>` : "";

    const tdName = document.createElement("td");
    tdName.innerHTML = `<div class="name">${it.name || ""}</div><div class="muted">${it.variant || ""}</div>`;

    const tdPrice = document.createElement("td");
    tdPrice.textContent = INR(it.price || 0);

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
    tdSub.textContent = INR((Number(it.price) || 0) * (Number(it.qty) || 0));

    btnPlus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[key]?.qty) || 0) + 1;
      window.Cart.setQty(key, next, it);
    });
    btnMinus.addEventListener("click", () => {
      const prev = Number(window.Cart.get()?.[key]?.qty) || 0;
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(key, next, it);
    });

    tr.append(tdImg, tdName, tdPrice, tdQty, tdSub);
    return tr;
  }

  // ---- 5) Unified render & hooks ----
  function render() {
    if (USE_LIST) renderList();
    else          renderTable();
  }

  document.addEventListener("DOMContentLoaded", render);
  window.addEventListener("cart:update", render);

  // proceed placeholder
  (USE_LIST ? $proceed : null)?.addEventListener("click", () => {
    if (count() === 0) return;
    alert("Cart confirmed. Payment step will be added next.");
  });
})();
