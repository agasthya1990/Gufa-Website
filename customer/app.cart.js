// app.cart.js — resolves layout AFTER DOM is ready, then renders.
// Works with window.CART_UI (list or table). Uses global window.Cart.

function displayCodeFromLock(locked){
  try {
    const raw = String(locked?.code || "").toUpperCase();
    const cid = String(locked?.scope?.couponId || "");
    const looksLikeUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw);
    if (raw && !looksLikeUuid) return raw;

    // 1) Try global coupons Map from menu
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta?.code) return String(meta.code).toUpperCase();

    // 2) Firestore one-shot read (only on checkout if needed), then backfill
    fetchCouponCodeAndBackfill(cid, locked);

    // Return something immediately; label will update after backfill
    return raw || cid.toUpperCase();
  } catch {
    return String(locked?.code || "").toUpperCase();
  }
}

// Promise-shaped shim to keep existing .then(...) call sites working 

function resolveDisplayCode(locked) { 
  try { 
  const code = displayCodeFromLock(locked); 
    return Promise.resolve(code); 
  } catch { 
    return Promise.resolve(String(locked?.code || "").toUpperCase()); 
  } 
} 


// parenthesis-safe, no inline IIFE
async function fetchCouponCodeAndBackfill(cid, locked) {
  try {
    if (!window.db || !cid) return;
    const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDoc(doc(window.db, "promotions", cid));
    if (snap.exists()) {
      const code = String(snap.data()?.code || cid).toUpperCase();
      localStorage.setItem("gufa_coupon", JSON.stringify({ ...(locked || {}), code }));
      window.dispatchEvent(new CustomEvent("cart:update"));
    }
  } catch {}
}




(function () {    
const INR = (v) => "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
const SERVICE_TAX_RATE  = 0.05;           // changeable without rewrites
const SERVICE_TAX_LABEL = "Service Tax";  // label shown in UI
const DELIVERY_TEXT     = "Shown at payment";
const taxOn = (amount) => Math.max(0, (Number(amount) || 0) * SERVICE_TAX_RATE);
  
// --- Mode + coupon validity helpers ---
function activeMode() {
  const raw = localStorage.getItem("gufa:serviceMode") ?? localStorage.getItem("gufa_mode") ?? "delivery";
  const m = String(raw).toLowerCase();
  return (m === "dining" ? "dining" : "delivery");
}



function couponValidForCurrentMode(locked) {
  try {
    const mode = activeMode(); // 'delivery' | 'dining'
    const v = locked?.valid;
    if (v && typeof v === "object" && (mode in v)) return !!v[mode];
    const cid = String(locked?.scope?.couponId || "");
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta && meta.targets && (mode in meta.targets)) return !!meta.targets[mode];
    return true;
  } catch { return true; }
}

// helpers
const entries = () => {
  try {
    // 1) Prefer the live store
    const store = window.Cart?.get?.();
    if (store && typeof store === "object") return Object.entries(store);

    // 2) Fallback: read directly from localStorage (so cart still paints)
    const raw = localStorage.getItem("gufa_cart_v1");
    const parsed = raw ? JSON.parse(raw) : null;
    const items = (parsed && typeof parsed === "object" && parsed.items) ? parsed.items : {};
    return Object.entries(items);
  } catch {
    return [];
  }
};

const count = () => entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
const subtotal = () => entries().reduce((s, [, it]) => s + (Number(it.price)||0)*(Number(it.qty)||0), 0);

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
  subtotal: document.querySelector(listCfg.subtotal || null),
  gst: document.querySelector(listCfg.gst || null),
  delivery: document.querySelector(listCfg.delivery || null),
  total: document.querySelector(listCfg.total || null),
  proceed: document.querySelector(listCfg.proceed || null),
};
// be tolerant: only the items container is required
const listOK = !!listEls.items;


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
  // normalize eligible ids to strings
  const eligibleIds = locked.scope.eligibleItemIds.map(x => String(x));
  // eligible base-only sum
  let eligibleBase = 0;
  for (const [key, it] of entries()) {
    const isAddon = String(key).split(":").length >= 3;
    if (isAddon) continue; // exclude add-ons
    if (!eligibleIds.includes(String(it?.id))) continue;
    eligibleBase += (Number(it?.price) || 0) * (Number(it?.qty) || 0);
  }

  if (eligibleBase > 0) {
    const t = String(locked?.type || "").toLowerCase();
    const v = Number(locked?.value || 0);

    // Gate discount by Delivery/Dining validity
    const validForMode = couponValidForCurrentMode(locked);
    if (validForMode) {
      if (t === "percent") discount = Math.round(eligibleBase * (v / 100));
      else if (t === "flat") discount = Math.min(v, eligibleBase);
    } else {
      discount = 0; // keep the lock, but no discount in this mode
    }

    couponCode = String(locked?.code || "").toUpperCase();
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

const totalsWrap = R.subtotal?.closest?.(".totals") || R.subtotal?.parentElement || null;
if (totalsWrap) {
  let promoRow = totalsWrap.querySelector(".total-row.promo-row");
  if (!promoRow) {
    promoRow = document.createElement("div");
    promoRow.className = "total-row promo-row";
    promoRow.innerHTML = `<span id="promo-label" class="muted">Promotion</span><span id="promo-amt"></span>`;
    const first = totalsWrap.firstElementChild;
    if (first) first.insertAdjacentElement("afterend", promoRow);
    else totalsWrap.prepend(promoRow);
  }
  const labelEl = promoRow.querySelector("#promo-label");
  const amtEl   = promoRow.querySelector("#promo-amt");

  const hasLock = !!(locked && locked.code);
  const validForMode = hasLock ? couponValidForCurrentMode(locked) : true;
  const modeLabel = (activeMode() === "dining") ? "Dining" : "Delivery";

  if (hasLock) {
    labelEl.textContent = "Promotion";
    if (!validForMode) {
      resolveDisplayCode(locked).then(code => {
        if (code && labelEl) labelEl.textContent = `Promotion (${code}) — Not valid for ${modeLabel}`;
      }).catch(() => {});
      amtEl.textContent = "− " + INR(0);
      promoRow.style.display = "";
    } else {
      amtEl.textContent = "− " + INR(discount);
      promoRow.style.display = "";
      resolveDisplayCode(locked).then(code => {
        if (code && labelEl) labelEl.textContent = `Promotion (${code})`;
      }).catch(() => {});
    }
  } else {
    promoRow.style.display = "none";
  }
}


    
// 5) optional mini invoice text in the "addons note" region (left column cue)
if (R.addonsNote) {
  const _mode = (String(localStorage.getItem("gufa_mode") || "delivery").toLowerCase() === "dining") ? "dining" : "delivery";
  const hasLock = !!(locked && locked.code);

  // compute validity for current mode
  let validForMode = true;
  if (hasLock) {
    if (locked.valid && typeof locked.valid === "object" && (_mode in locked.valid)) {
      validForMode = !!locked.valid[_mode];
    } else {
      const cid = String(locked?.scope?.couponId || "");
      if (cid && (window.COUPONS instanceof Map)) {
        const meta = window.COUPONS.get(cid);
        if (meta && meta.targets && (_mode in meta.targets)) {
          validForMode = !!meta.targets[_mode];
        }
      }
    }
  }

  // build promo line (always show when a coupon is locked; amount is 0 if not valid)
  const promoHtml = hasLock
    ? `<div class="promo-line"><span class="plabel">Promotion${validForMode ? "" : ` — Not valid for ${_mode === "dining" ? "Dining" : "Delivery"}`}</span>: <strong style="color:#b00020;">−${INR(validForMode ? discount : 0)}</strong></div>`
    : "";

  const baseHtml = `
    <div class="muted" style="display:grid;row-gap:4px;">
      <div><span>Base Items:</span> <strong>${INR(baseSubtotal)}</strong></div>
      <div><span>Add-ons:</span> <strong>${INR(addonSubtotal)}</strong></div>
      ${promoHtml}
      <div><span>${SERVICE_TAX_LABEL} (${(SERVICE_TAX_RATE*100).toFixed(0)}%):</span> <strong>${INR(tax)}</strong></div>
    </div>
  `;
  R.addonsNote.innerHTML = baseHtml;

  // fill friendly code asynchronously on label (keeps not-valid notice intact)
  if (hasLock) {
    resolveDisplayCode(locked).then(code => {
      const labelSpot = R.addonsNote?.querySelector?.(".promo-line .plabel");
      if (labelSpot && code) {
        labelSpot.textContent = `Promotion (${code})${validForMode ? "" : ` — Not valid for ${_mode === "dining" ? "Dining" : "Delivery"}`}`;
      }
    }).catch(() => {});
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
    lineSub.textContent = INR((Number(it?.price) || 0) * (Number(it?.qty) || 0));

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

// If script loads after DOMContentLoaded already fired, bootstrap immediately
if (document.readyState !== "loading") {
  if (!mode) {
    if (!resolveLayout()) {
      console.warn("[cart] DOM already ready, but no layout found yet.");
    } else {
      render();
    }
  }
}

// keep in sync with store
window.addEventListener("cart:update", () => {
  if (!mode) {
    if (!resolveLayout()) return;
  }
  render();
});

 // also re-render when Delivery/Dining mode changes
// also re-render when Delivery/Dining mode changes
const onModeChange = () => {
  if (!mode) {
    if (!resolveLayout()) return;
  }
  render();
};
window.addEventListener("mode:change", onModeChange);
window.addEventListener("serviceMode:changed", onModeChange);
} 
})();
