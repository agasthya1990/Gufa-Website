// app.cart.js — repaired: full features kept, promo sync strict, Delivery vs Dining aware
// Works with your current checkout.html (single right-side invoice) and gracefully degrades if some anchors are absent.

/////////////////////////////
// Currency & math helpers //
/////////////////////////////
const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
const SERVICE_TAX_RATE  = 0.05;
const SERVICE_TAX_LABEL = "Service Tax";
const clamp0 = (n) => Math.max(0, Number(n)||0);
const taxOn  = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

//////////////////////
// Mode + Cart read //
//////////////////////
function activeMode() {
  // Prefer your GUFA API if present; else fallback to localStorage
  const api = window?.GUFA?.serviceMode?.get;
  if (typeof api === "function") return api() === "dining" ? "dining" : "delivery";
  const raw = localStorage.getItem("gufa:serviceMode") ?? localStorage.getItem("gufa_mode") ?? "delivery";
  return String(raw).toLowerCase() === "dining" ? "dining" : "delivery";
}

function entries() {
  try {
    // Prefer live store
    const store = window?.Cart?.get?.();
    if (store && typeof store === "object") {
      const itemsObj = (store.items && typeof store.items === "object")
        ? store.items
        : (store instanceof Map ? Object.fromEntries(store) : store);
      const live = Object.entries(itemsObj);
      if (live.length) return live;
    }
    // Fallback to persisted store
    const raw = localStorage.getItem("gufa_cart");
    if (raw) {
      const parsed = JSON.parse(raw);
      const items = (parsed && typeof parsed === "object")
        ? (parsed.items && typeof parsed.items === "object" ? parsed.items : parsed)
        : {};
      const list = Object.entries(items);
      if (list.length) return list;
    }
  } catch(e) { console.warn("[cart] entries() failed:", e); }
  return [];
}

const itemCount = () => entries().reduce((n, [,it]) => n + (Number(it?.qty)||0), 0);

/////////////////////////////
// Lock + Catalogs (global)//
/////////////////////////////
const COUPON_KEY = "gufa_coupon";
if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
if (!window.BANNERS) window.BANNERS = new Map(); // Map preferred; Array legacy tolerated

function getLock() {
  try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; }
}
function setLock(obj) {
  try { obj ? localStorage.setItem(COUPON_KEY, JSON.stringify(obj)) : localStorage.removeItem(COUPON_KEY); } catch {}
}

/////////////////////////
// Display code helpers//
/////////////////////////
// (kept & fixed from your original; adds safe async backfill if only couponId is known)
function displayCodeFromLock(locked){
  try {
    const raw = String(locked?.code || "").toUpperCase();
    const cid = String(locked?.scope?.couponId || "");
    const looksLikeUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw);
    if (raw && !looksLikeUuid) return raw;

    // 1) Try global coupons Map
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta?.code) return String(meta.code).toUpperCase();

    // 2) Firestore one-shot read (only to resolve label), then backfill lock
    fetchCouponCodeAndBackfill(cid, locked);
    return raw || cid.toUpperCase(); // immediate label; will update after backfill
  } catch {
    return String(locked?.code || "").toUpperCase();
  }
}
// Keep promise shape so old call sites that used .then(...) still work
function resolveDisplayCode(locked) {
  try { return Promise.resolve(displayCodeFromLock(locked)); }
  catch { return Promise.resolve(String(locked?.code || "").toUpperCase()); }
}

async function fetchCouponCodeAndBackfill(cid, locked) {
  try {
    if (!window.db || !cid) return;
    const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDoc(doc(window.db, "promotions", cid));
    if (snap.exists()) {
      const code = String(snap.data()?.code || cid).toUpperCase();
      localStorage.setItem(COUPON_KEY, JSON.stringify({ ...(locked || {}), code }));
      window.dispatchEvent(new CustomEvent("cart:update"));
    }
  } catch {/* no-op */}
}

///////////////////////////////
// Eligibility & Mode checks //
///////////////////////////////
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

function eligibleIdsFromBanners(scope) {
  const out = new Set();
  if (!scope) return out;

  const bid = String(scope.bannerId||"").trim();
  const cid = String(scope.couponId||"").trim();

  // Map form
  if (window.BANNERS instanceof Map) {
    const arr = window.BANNERS.get(bid) || window.BANNERS.get(`coupon:${cid}`);
    if (Array.isArray(arr)) arr.forEach(x => out.add(String(x).toLowerCase()));
    return out;
  }
  // Array form
  if (Array.isArray(window.BANNERS)) {
    const found = window.BANNERS.find(b => String(b?.id||"").trim() === bid);
    const arr = found?.items || found?.eligibleItemIds || found?.itemIds || [];
    if (Array.isArray(arr)) arr.forEach(x => out.add(String(x).toLowerCase()));
    if (!out.size && cid) {
      const byCoupon = window.BANNERS.find(b => Array.isArray(b?.linkedCouponIds) && b.linkedCouponIds.includes(cid));
      const carr = byCoupon?.items || byCoupon?.eligibleItemIds || byCoupon?.itemIds || [];
      if (Array.isArray(carr)) carr.forEach(x => out.add(String(x).toLowerCase()));
    }
  }
  return out;
}

// STRICT final eligibility: explicit list > banner-derived list > empty (no list ⇒ no discount)
function resolveEligibilitySet(locked) {
  const scope = locked?.scope || {};
  const explicit = (
    Array.isArray(scope.eligibleItemIds) ? scope.eligibleItemIds :
    Array.isArray(scope.eligibleIds)     ? scope.eligibleIds     :
    Array.isArray(scope.itemIds)         ? scope.itemIds         :
    []
  ).map(s => String(s).toLowerCase());
  if (explicit.length) return new Set(explicit);
  const byBanner = eligibleIdsFromBanners(scope);
  if (byBanner.size) return byBanner;
  return new Set();
}

// Base vs Add-ons split (for totals & display)
function splitBaseVsAddons() {
  let base = 0, add = 0;
  for (const [key, it] of entries()) {
    const isAddon = String(key).split(":").length >= 3; // itemId:variant:addon
    const line = clamp0(it.price) * clamp0(it.qty);
    if (isAddon) add += line; else base += line;
  }
  return { base, add };
}

// Compute discount strictly on eligible BASE items; add-ons never discounted
function computeDiscount(locked, baseSubtotal) {
  if (!locked) return { discount:0 };
  if (!couponValidForCurrentMode(locked)) return { discount:0 };
  const minOrder = Number(locked?.minOrder || 0);
  if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0 };

  const elig = resolveEligibilitySet(locked);
  if (!elig.size) return { discount:0 };

  let eligibleBase = 0;
  for (const [key, it] of entries()) {
    const parts = String(key).split(":");
    if (parts.length >= 3) continue; // skip add-ons
    const itemId  = String(it?.id ?? parts[0]).toLowerCase();
    const baseKey = parts.slice(0,2).join(":").toLowerCase();
    if (elig.has(itemId) || elig.has(baseKey) || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))) {
      eligibleBase += clamp0(it.price) * clamp0(it.qty);
    }
  }
  if (eligibleBase <= 0) return { discount:0 };

  const t = String(locked?.type||"").toLowerCase();
  const v = Number(locked?.value||0);
  if (t === "percent") return { discount: Math.round(eligibleBase * (v/100)) };
  if (t === "flat")    return { discount: Math.min(v, eligibleBase) };
  return { discount:0 };
}

/////////////////////
// UI: group lines //
/////////////////////
function buildGroups() {
  const groups = new Map(); // baseKey -> { base, addons[] }
  for (const [key, it] of entries()) {
    const parts = String(key).split(":");
    const baseKey = parts.slice(0,2).join(":"); // itemId:variant
    const addonName = parts[2]; // undefined for base
    if (!groups.has(baseKey)) groups.set(baseKey, { base:null, addons:[] });
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
  lineSub.textContent = INR(clamp0(it.price) * clamp0(it.qty));

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

function lineItem(key, it) {
  const li = document.createElement("li");
  li.className = "cart-row";
  li.dataset.key = key;

  // Image optional (your latest UI prefers text—this renders clean even if src is empty)
  const img = document.createElement("img");
  img.className = "card-thumb";
  img.alt = it?.name || "";
  img.loading = "lazy";
  img.src = it?.thumb || "";
  img.onerror = () => { img.src = ""; };

  const mid = document.createElement("div");
  const title = document.createElement("h3");
  title.className = "cart-title";
  title.textContent = it?.name || "";
  const sub = document.createElement("p");
  sub.className = "cart-sub";
  sub.textContent = `${it?.variant || ""} • ${INR(clamp0(it?.price))}`;

  const right = document.createElement("div");
  right.className = "row-right";

  const stepper = document.createElement("div");
  stepper.className = "stepper";
  const minus = document.createElement("button"); minus.textContent = "–";
  const out   = document.createElement("output");  out.textContent = String(it?.qty || 0);
  const plus  = document.createElement("button");  plus.textContent = "+";
  stepper.append(minus, out, plus);

  const lineSub = document.createElement("div");
  lineSub.className = "line-subtotal";
  lineSub.textContent = INR(clamp0(it?.price) * clamp0(it?.qty));

  const remove = document.createElement("button");
  remove.className = "remove-link";
  remove.textContent = "Remove";

  plus.addEventListener("click", () => {
    const next = (Number(window.Cart.get()?.[key]?.qty)||0) + 1;
    window.Cart.setQty(key, next, it);
  });
  minus.addEventListener("click", () => {
    const prev = Number(window.Cart.get()?.[key]?.qty)||0;
    const next = Math.max(0, prev - 1);
    window.Cart.setQty(key, next, it);
  });
  remove.addEventListener("click", () => { window.Cart.setQty(key, 0); });

  mid.append(title, sub);
  right.append(stepper, lineSub, remove);
  // If you truly prefer “no images” look, your CSS can hide .card-thumb; keeping it here preserves feature parity.
  li.append(img, mid, right);
  return li;
}

function renderGroup(g) {
  const wrap = document.createElement("li");
  wrap.className = "cart-row grouped";
  // Base (or synthesize shell if only add-ons present)
  let { key: bKey, it: bIt } = g.base || {};
  if (!bKey && g.addons.length) {
    const first = g.addons[0];
    bKey = first.key.split(":").slice(0,2).join(":");
    bIt  = { ...(first.it||{}), qty: clamp0(first.it?.qty) || 0 };
  }
  if (bKey) wrap.appendChild(lineItem(bKey, bIt));

  // Add-ons
  if (g.addons.length) {
    const list = document.createElement("div");
    list.className = "addon-list";
    g.addons.sort((a,b)=>a.name.localeCompare(b.name)).forEach(a => list.appendChild(addonRow(bKey, a)));
    wrap.appendChild(list);
  }
  return wrap;
}

/////////////////////
// Layout resolver //
/////////////////////
let MODE = null; // 'list' | 'table'
let R = {};
let $countTop = null;
function resolveLayout() {
  const CFG = window.CART_UI || {};
  $countTop = document.querySelector('#cart-count');

  const listCfg = CFG.list || {
    items:'#cart-items',
    empty:'#cart-empty',
    count:'#cart-items-count',
    invFood:'#inv-food',
    invAddons:'#inv-addons',
    promoLbl:'#promo-label',
    promoAmt:'#promo-amt',
    promoInput:'#promo-input',
    promoApply:'#promo-apply',
    subtotal:'#subtotal-amt',
    servicetax:'#servicetax-amt',
    total:'#total-amt',
    proceed:'#proceed-btn'
  };
  const tableCfg = CFG.table || { body:'#cartBody', total:'#cartTotal' };

  const listEls = {
    items: document.querySelector(listCfg.items),
    empty: document.querySelector(listCfg.empty || null),
    count: document.querySelector(listCfg.count || null),
    invFood: document.querySelector(listCfg.invFood || null),
    invAddons: document.querySelector(listCfg.invAddons || null),
    promoLbl: document.querySelector(listCfg.promoLbl || null),
    promoAmt: document.querySelector(listCfg.promoAmt || null),
    promoInput: document.querySelector(listCfg.promoInput || null),
    promoApply: document.querySelector(listCfg.promoApply || null),
    subtotal: document.querySelector(listCfg.subtotal || null),
    servicetax: document.querySelector(listCfg.servicetax || null),
    total: document.querySelector(listCfg.total || null),
    proceed: document.querySelector(listCfg.proceed || null),
  };
  if (listEls.items) { MODE = 'list'; R = listEls; return true; }

  const tableEls = {
    body: document.querySelector(tableCfg.body),
    total: document.querySelector(tableCfg.total)
  };
  if (tableEls.body && tableEls.total) { MODE = 'table'; R = tableEls; return true; }

  MODE = null; R = {};
  console.warn("[cart] No usable layout found — check checkout.html and window.CART_UI before app.cart.js");
  return false;
}

/////////////////////
// Render routines //
/////////////////////
function renderList() {
  const n = itemCount();
  if (R.empty) R.empty.hidden = n > 0;
  if (R.items) R.items.hidden = n === 0;
  if ($countTop) $countTop.textContent = String(n);
  if (R.count) R.count.textContent = `(${n} ${n===1?"item":"items"})`;
  if (R.proceed) R.proceed.disabled = n === 0;

  // Left: grouped rows
  if (R.items) {
    R.items.innerHTML = "";
    const groups = buildGroups();
    for (const [, g] of groups) R.items.appendChild(renderGroup(g));
  }

  // Right: invoice lists (Food Items / Add-ons)
  const groups2 = buildGroups();
  const food = [];
  const adds = [];
  for (const [, g] of groups2) {
    if (g.base) {
      const it = g.base.it || {};
      const qty = clamp0(it.qty);
      if (qty > 0) food.push(`<div class="inv-row"><div>${it.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
    }
    for (const a of g.addons) {
      const it = a.it || {};
      const qty = clamp0(it.qty);
      if (qty > 0) adds.push(`<div class="inv-row"><div>${a.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
    }
  }
  if (R.invFood)   R.invFood.innerHTML   = food.length ? food.join("") : `<div class="muted">None</div>`;
  if (R.invAddons) R.invAddons.innerHTML = adds.length ? adds.join("") : `<div class="muted">None</div>`;

  // Totals + Promotion (strict)
  const { base, add } = splitBaseVsAddons();
  const locked = getLock();
  const { discount } = computeDiscount(locked, base);
  const preTax = clamp0(base + add - discount);
  const tax    = taxOn(preTax);
  const grand  = preTax + tax;

  if (R.subtotal)   R.subtotal.textContent   = INR(base + add);
  if (R.servicetax) R.servicetax.textContent = INR(tax);
  if (R.total)      R.total.textContent      = INR(grand);

  // Promo label & amount — no “Not Eligible” wording
  const codeText = locked ? displayCodeFromLock(locked) : "";
  const label = codeText ? `Promotion (${codeText}):` : `Promotion (): none`;
  if (R.promoLbl) R.promoLbl.textContent = label;
  if (R.promoAmt) R.promoAmt.textContent = `− ${INR(discount)}`;

  // Apply Coupon wire-up
  if (R.promoApply && !R.promoApply._wired) {
    R.promoApply._wired = true;
    R.promoApply.addEventListener("click", () => {
      const code = (R.promoInput?.value || "").trim().toUpperCase();
      if (!code) {
        setLock(null);
      } else {
        // Keep strict scope info if present (bannerId/couponId/eligibleItemIds)
        const prev = getLock() || {};
        const scope = prev.scope || {};
        setLock({ ...prev, code, scope });
      }
      window.dispatchEvent(new CustomEvent("cart:update"));
    }, false);
  }
  if (R.promoInput && !R.promoInput.value && codeText) {
    R.promoInput.value = codeText;
  }
}

function renderTable() {
  const es = entries();
  if (R.body) {
    if (!es.length) R.body.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
    else {
      R.body.innerHTML = "";
      for (const [key, it] of es) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${it.thumb ? `<img src="${it.thumb}" alt="${it.name||""}" class="thumb" loading="lazy"/>` : ""}</td>
          <td><div class="name">${it.name||""}</div><div class="muted">${it.variant||""}</div></td>
          <td>${INR(clamp0(it.price))}</td>
          <td class="qty-cell">
            <button class="qty-btn dec">–</button>
            <span class="qty-out">${clamp0(it.qty)}</span>
            <button class="qty-btn inc">+</button>
          </td>
          <td class="subtotal">${INR(clamp0(it.price)*clamp0(it.qty))}</td>
        `;
        const [dec, out, inc] = [
          tr.querySelector(".qty-btn.dec"),
          tr.querySelector(".qty-out"),
          tr.querySelector(".qty-btn.inc"),
        ];
        inc.addEventListener("click", () => {
          const next = (Number(window.Cart.get()?.[key]?.qty)||0)+1;
          window.Cart.setQty(key, next, it);
        });
        dec.addEventListener("click", () => {
          const prev = (Number(window.Cart.get()?.[key]?.qty)||0);
          const next = Math.max(0, prev-1);
          window.Cart.setQty(key, next, it);
        });
        R.body.appendChild(tr);
      }
    }
  }
  const { base, add } = splitBaseVsAddons();
  if (R.total) R.total.textContent = INR(base + add);
  const badge = document.querySelector('#cart-count');
  if (badge) badge.textContent = String(itemCount());
}

////////////////////////////
// Boot + reactive wiring //
////////////////////////////
function render() {
  if (!MODE && !resolveLayout()) return;
  if (MODE === "list") renderList();
  else if (MODE === "table") renderTable();
}

function rehydrateIfEmpty() {
  if (entries().length > 0) return;
  setTimeout(()=>{ if (entries().length===0) render(); }, 80);
  setTimeout(()=>{ if (entries().length===0) render(); }, 220);
  setTimeout(()=>{ if (entries().length===0) render(); }, 480);
}

function boot() {
  resolveLayout();
  render();
  rehydrateIfEmpty();

  window.addEventListener("cart:update", render, false);
  window.addEventListener("mode:change", render, false);
  window.addEventListener("serviceMode:changed", render, false);

  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (e.key === "gufa_cart_v1" || e.key === "gufa_cart" || e.key === "GUFA:CART" || e.key === COUPON_KEY) {
      render();
    }
  }, false);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { render(); rehydrateIfEmpty(); }
  }, false);
  window.addEventListener("pageshow", (ev) => {
    if (ev && ev.persisted) { render(); rehydrateIfEmpty(); }
  }, false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once:true });
} else {
  boot();
}
