// app.cart.js — resolves layout AFTER DOM is ready, then renders.
// Works with window.CART_UI (list or table). Uses global window.Cart.

function displayCodeFromLock(locked){
  try {
    const raw = String(locked?.code || "").toUpperCase();
    const cid = String(locked?.scope?.couponId || "");
    const looksLikeUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw);

    if (!looksLikeUuid && raw) return raw;

    // try to resolve human-readable code from global coupons map
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    const code = (meta?.code || raw || cid || "").toString().toUpperCase();
    return code;
  } catch { return String(locked?.code || "").toUpperCase(); }
}

(function () {
async function resolveDisplayCode(locked) {
  try {
    const raw = String(locked?.code || "").toUpperCase();
    const cid = String(locked?.scope?.couponId || "");
    if (!cid) return raw;
    const looksUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw);
    if (raw && !looksUuid) return raw;                 // already human (e.g., SUMMER25)

    // 2) Try global COUPONS Map if present (from menu pages)
    if (window.COUPONS instanceof Map) {
      const meta = window.COUPONS.get(cid);
      const code = (meta?.code || raw || cid).toString().toUpperCase();
      if (code && !/[0-9A-F-]{36}/.test(code)) {
        // backfill and return
        try {
          const next = { ...locked, code };
          localStorage.setItem("gufa_coupon", JSON.stringify(next));
        } catch {}
        return code;
      }
    }

    // 3) Firestore one-shot read (no Admin edits; uses window.db from firebase.client.js)
    if (window.db && cid) {
      // dynamic import (safe in non-module scripts)
      const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDoc(doc(window.db, "promotions", cid));
      if (snap.exists()) {
        const data = snap.data() || {};
        const code = String(data.code || raw || cid).toUpperCase();
        try {
          const next = { ...locked, code };
          localStorage.setItem("gufa_coupon", JSON.stringify(next));
        } catch {}
        return code;
      }
    }

    // Fallbacks
    return raw || cid.toUpperCase();
  } catch {
    return String(locked?.code || "").toUpperCase();
  }
}


// helpers
const entries = () => {
  try { return Object.entries(window.Cart?.get?.() || {}); } catch { return []; }
};
const count = () => entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
const subtotal = () => entries().reduce((s, [, it]) => s + (Number(it.price)||0)*(Number(it.qty)||0), 0);
// (removed legacy gst() tied to GST_PERCENT)


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

  function buildGroups() {
  const bag = entries(); // [key,it][]
  const groups = new Map();
  for (const [key, it] of bag) {
    const parts = String(key).split(":");
    const baseKey = parts.slice(0, 2).join(":");   // itemId:variant
    const addonName = parts[2];                    // undefined for base

    if (!groups.has(baseKey)) groups.set(baseKey, { base: null, addons: [] });

    if (addonName) {
      const name = (it?.addons?.[0]?.name) || addonName;
      groups.get(baseKey).addons.push({ key, it, name });
    } else {
      groups.get(baseKey).base = { key, it };
    }
  }
  return groups;
}

function addonRow(baseKey, addon) {
  const { key, it, name } = addon;
  const row = document.createElement("div");
  row.className = "addon-row";

  const label = document.createElement("div");
  label.className = "addon-label muted";
  label.textContent = `+ ${name}`;

  const stepper = document.createElement("div");
  stepper.className = "stepper sm";
  const minus = document.createElement("button"); minus.textContent = "–";
  const out   = document.createElement("output");  out.textContent = String(it.qty || 0);
  const plus  = document.createElement("button");  plus.textContent = "+";
  stepper.append(minus, out, plus);

  const lineSub = document.createElement("div");
  lineSub.className = "line-subtotal";
  lineSub.textContent = "₹" + Math.round((Number(it.price)||0) * (Number(it.qty)||0)).toLocaleString("en-IN");

  plus.addEventListener("click", () => {
    const next = (Number(window.Cart.get()?.[key]?.qty) || 0) + 1;
    window.Cart.setQty(key, next, it);
  });
  minus.addEventListener("click", () => {
    const prev = Number(window.Cart.get()?.[key]?.qty) || 0;
    const next = Math.max(0, prev - 1);
    window.Cart.setQty(key, next, it);
  });

  row.append(label, stepper, lineSub);
  return row;
}

  function renderGroup(g) {
  const wrap = document.createElement("li");
  wrap.className = "cart-row grouped";

  // Base row (reuse existing lineItem output but inline here to append children)
  const { key: bKey, it: bIt } = g.base || {};
  const base = lineItem(bKey, bIt); // existing function
  wrap.appendChild(base);

  // Add-on list
  if (g.addons.length) {
    const list = document.createElement("div");
    list.className = "addon-list";
    // stable order: by name
    g.addons.sort((a,b) => a.name.localeCompare(b.name));
    g.addons.forEach(a => list.appendChild(addonRow(bKey, a)));
    wrap.appendChild(list);
  }
  return wrap;
}

  function renderList() {
    const es = entries();
    const n = count();

    if (R.empty) R.empty.hidden = n > 0;
    if (R.items) R.items.hidden = n === 0;
    if ($countTop) $countTop.textContent = String(n);
    if (R.count) R.count.textContent = `(${n} ${n === 1 ? "item" : "items"})`;
    if (R.proceed) R.proceed.disabled = n === 0;
    if (R.addonsNote) R.addonsNote.style.display = n > 0 ? "block" : "none";


// list items (group by base itemId:variant)
    
if (R.items) {
  R.items.innerHTML = "";
  const groups = buildGroups();
  for (const [, g] of groups) {
    // If user somehow added only add-ons (no base), still show them nicely
    const hasBase = !!g.base;
    if (!hasBase && g.addons.length) {
      // synthesize a "base" shell using the first addon’s meta (just for title/thumb)
      const first = g.addons[0];
      g.base = { key: first.key.split(":").slice(0,2).join(":"), it: { ...first.it } };
    }
    R.items.appendChild(renderGroup(g));
  }
}


// ---- PROMOTION & TAX (Base-only discount; add-ons excluded) ----

// 1) split base vs add-ons from current cart entries
let baseSubtotal = 0, addonSubtotal = 0;
for (const [key, it] of entries()) {
  const isAddon = String(key).split(":").length >= 3; // itemId:variant:addon
  const lineTotal = (Number(it.price)||0) * (Number(it.qty)||0);
  if (isAddon) addonSubtotal += lineTotal; else baseSubtotal += lineTotal;
}

// 2) read locked coupon (if any)
let discount = 0, couponCode = "";
let locked = null;
try { locked = JSON.parse(localStorage.getItem("gufa_coupon") || "null"); } catch {}
if (locked && Array.isArray(locked?.scope?.eligibleItemIds) && locked.scope.eligibleItemIds.length) {
  // eligible base-only sum
  let eligibleBase = 0;
  for (const [key, it] of entries()) {
    const isAddon = String(key).split(":").length >= 3;
    if (isAddon) continue;          // exclude add-ons
    if (!locked.scope.eligibleItemIds.includes(it.id)) continue;
    eligibleBase += (Number(it.price)||0) * (Number(it.qty)||0);
  }
  if (eligibleBase > 0) {
    const t = String(locked.type || "").toLowerCase();
    const v = Number(locked.value || 0);
    if (t === "percent") discount = Math.round(eligibleBase * (v/100));
    else if (t === "flat") discount = Math.min(v, eligibleBase);
    couponCode = String(locked.code || "").toUpperCase();
  }
}

// 3) compute totals
const preTax = Math.max(0, baseSubtotal + addonSubtotal - discount);
const tax = taxOn(preTax);
const grand = preTax + tax;

// 4) paint existing fields (right column)
if (R.subtotal) R.subtotal.textContent = INR(baseSubtotal + addonSubtotal);
if (R.gst)      R.gst.textContent      = INR(tax);
if (R.delivery) R.delivery.textContent = DELIVERY_TEXT;
if (R.total)    R.total.textContent    = INR(grand);

// 4b) ensure a visible Promotion row right under Subtotal (if DOM allows)
const totalsWrap = R.subtotal?.closest?.(".totals") || null;
if (totalsWrap) {
  // create row once; just update text later
  let promoRow = totalsWrap.querySelector(".total-row.promo-row");
  if (!promoRow) {
    promoRow = document.createElement("div");
    promoRow.className = "total-row promo-row";
    promoRow.innerHTML = `<span id="promo-label" class="muted">Promotion</span><span id="promo-amt"></span>`;
    // insert after Subtotal row
    const first = totalsWrap.firstElementChild;
    if (first) first.insertAdjacentElement("afterend", promoRow);
    else totalsWrap.prepend(promoRow);
  }
  const labelEl = promoRow.querySelector("#promo-label");
  const amtEl   = promoRow.querySelector("#promo-amt");
if (discount > 0) {
  // resolve friendly code asynchronously; paint immediately with a neutral label, then update
  labelEl.textContent = "Promotion";
  amtEl.textContent   = "− " + INR(discount);
  promoRow.style.display = "";

  // async resolve; no admin/menu dependency required
  resolveDisplayCode(locked).then(code => {
    if (code && promoRow && labelEl) labelEl.textContent = `Promotion (${code})`;
  }).catch(() => {});
} else {
  promoRow.style.display = "none";
}
}

// 5) optional mini invoice text in the "addons note" region (left column cue)
if (R.addonsNote) {
  // paint first without code; update after resolve
  const baseHtml = `
    <div class="muted" style="display:grid;row-gap:4px;">
      <div><span>Base Items:</span> <strong>${INR(baseSubtotal)}</strong></div>
      <div><span>Add-ons:</span> <strong>${INR(addonSubtotal)}</strong></div>
      ${discount > 0 ? `<div class="promo-line"><span class="plabel">Promotion</span>: <strong style="color:#b00020;">−${INR(discount)}</strong></div>` : ""}
      <div><span>${SERVICE_TAX_LABEL} (${(SERVICE_TAX_RATE*100).toFixed(0)}%):</span> <strong>${INR(tax)}</strong></div>
    </div>
  `;
  R.addonsNote.innerHTML = baseHtml;

  if (discount > 0) {
    resolveDisplayCode(locked).then(code => {
      const labelSpot = R.addonsNote.querySelector(".promo-line .plabel");
      if (labelSpot && code) labelSpot.textContent = `Promotion (${code})`;
    }).catch(() => {});
  }
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
