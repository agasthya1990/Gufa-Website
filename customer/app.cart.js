// app.cart.js — resolves layout AFTER DOM is ready, then renders.
// Works with window.CART_UI (list or table). Uses global window.Cart.

(function () {
  const INR = (v) => "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
  const GST_PERCENT = 5;
  const DELIVERY_TEXT = "Shown at payment";

  // helpers
  const entries = () => {
    try { return Object.entries(window.Cart?.get?.() || {}); } catch { return []; }
  };
  const count = () => entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
  const subtotal = () => entries().reduce((s, [, it]) => s + (Number(it.price)||0)*(Number(it.qty)||0), 0);
  const gst = (s) => Math.max(0, (s * GST_PERCENT) / 100);

  // runtime refs (filled after DOMContentLoaded)
  let mode = null; // 'list' | 'table'
  let R = {};      // resolved elements
  let $countTop = null;

  function resolveLayout() {
    const CFG = window.CART_UI || {};
    $countTop = document.querySelector('#cart-count');

    // prefer explicit config; otherwise try defaults
    const listCfg = CFG.list || {
      items:'#cart-items', empty:'#cart-empty', count:'#cart-items-count',
      addonsNote:'#addons-note', subtotal:'#subtotal-amt', gst:'#gst-amt',
      delivery:'#delivery-amt', total:'#total-amt', proceed:'#proceed-btn'
    };
    const tableCfg = CFG.table || { body:'#cartBody', total:'#cartTotal' };

    // try list first
    const listEls = {
      items: document.querySelector(listCfg.items),
      empty: document.querySelector(listCfg.empty || null),
      count: document.querySelector(listCfg.count || null),
      addonsNote: document.querySelector(listCfg.addonsNote || null),
      subtotal: document.querySelector(listCfg.subtotal),
      gst: document.querySelector(listCfg.gst),
      delivery: document.querySelector(listCfg.delivery),
      total: document.querySelector(listCfg.total),
      proceed: document.querySelector(listCfg.proceed || null),
    };
    const listOK = !!(listEls.items && listEls.subtotal && listEls.gst && listEls.delivery && listEls.total);

    if (listOK) {
      mode = 'list';
      R = listEls;
      return true;
    }

    // fallback: table
    const tableEls = {
      body: document.querySelector(tableCfg.body),
      total: document.querySelector(tableCfg.total)
    };
    const tableOK = !!(tableEls.body && tableEls.total);
    if (tableOK) {
      mode = 'table';
      R = tableEls;
      return true;
    }

    // neither found
    mode = null;
    R = {};
    console.warn("[cart] No usable layout found. Make sure window.CART_UI is set before app.cart.js and IDs exist in checkout.html.");
    return false;
  }

  // ----- renderers -----
  function renderList() {
    const es = entries();
    const n = count();

    if (R.empty) R.empty.hidden = n > 0;
    if (R.items) R.items.hidden = n === 0;
    if ($countTop) $countTop.textContent = String(n);
    if (R.count) R.count.textContent = `(${n} ${n === 1 ? "item" : "items"})`;
    if (R.proceed) R.proceed.disabled = n === 0;
    if (R.addonsNote) R.addonsNote.style.display = n > 0 ? "block" : "none";

    // list items
    if (R.items) {
      R.items.innerHTML = "";
      for (const [key, it] of es) R.items.appendChild(lineItem(key, it));
    }

    // totals
    const sub = subtotal();
    const g   = gst(sub);
    if (R.subtotal) R.subtotal.textContent = INR(sub);
    if (R.gst)      R.gst.textContent      = INR(g);
    if (R.delivery) R.delivery.textContent = DELIVERY_TEXT;
    if (R.total)    R.total.textContent    = INR(sub + g);
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
    if (R.body) {
      if (!es.length) {
        R.body.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
      } else {
        R.body.innerHTML = "";
        for (const [key, it] of es) R.body.appendChild(rowB(key, it));
      }
    }
    if (R.total) R.total.textContent = INR(subtotal());
    const n = count();
    const badge = document.querySelector('#cart-count');
    if (badge) badge.textContent = String(n);
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

  // unified render
  function render() {
    if (mode === 'list') renderList();
    else if (mode === 'table') renderTable();
  }

  // init after DOM is ready
  document.addEventListener("DOMContentLoaded", () => {
    if (!resolveLayout()) return; // logs once if nothing found
    render();
  });

  // keep in sync with store
  window.addEventListener("cart:update", () => {
    if (!mode) {
      // late-mount safety: try resolving again
      if (!resolveLayout()) return;
    }
    render();
  });

})();
