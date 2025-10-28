// app.cart.js — Robust Cart with strict Promotions, FCFS (non-stackable), Mode gating,
// Add-on steppers + auto-prune, Promo totals row, and Delivery Address form.
// Refactor-friendly: clear seams for minOrder & usageLimit coming from Admin/promotions.js.

;(function(){
  /* ===================== Money & utils ===================== */
  const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
  const SERVICE_TAX_RATE = 0.05;
  const clamp0 = (n) => Math.max(0, Number(n)||0);
  const taxOn = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

  const COUPON_KEY = "gufa_coupon";
  const ADDR_KEY   = "gufa:deliveryAddress";

  const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||"");

  /* ===================== Mode ===================== */
  function activeMode(){
    const raw = (localStorage.getItem("gufa:serviceMode") || localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
    return raw === "dining" ? "dining" : "delivery";
  }

  /* ===================== Cart I/O ===================== */
  function entries(){
    try {
      const store = window?.Cart?.get?.();
      if (store && typeof store === "object") return Object.entries(store);
    } catch {}
    try {
      const raw = localStorage.getItem("gufa_cart");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const bag = (parsed && typeof parsed === "object")
        ? (parsed.items && typeof parsed.items === "object" ? parsed.items : parsed)
        : {};
      return Object.entries(bag || {});
    } catch { return []; }
  }
  const itemCount = () => entries().reduce((n, [,it]) => n + (Number(it?.qty)||0), 0);
  const isAddonKey = (key) => String(key).split(":").length >= 3;
  const baseKeyOf  = (key) => String(key).split(":").slice(0,2).join(":");

  function splitBaseVsAddons(){
    let base=0, add=0;
    for (const [key, it] of entries()){
      const line = clamp0(it.price) * clamp0(it.qty);
      if (isAddonKey(key)) add += line; else base += line;
    }
    return { base, add };
  }

  /* ===================== Global Catalogs ===================== */
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  if (!window.BANNERS) window.BANNERS = new Map(); // Map preferred; Array tolerated

  /* ===================== Coupon Lock ===================== */
  const getLock = () => { try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; } };
  const setLock = (obj) => { try { obj ? localStorage.setItem(COUPON_KEY, JSON.stringify(obj)) : localStorage.removeItem(COUPON_KEY); } catch {} };

  function displayCode(locked){
  try {
    if (!locked) return "";
    const raw = String(locked.code || "").trim();
    if (raw && !isUUID(raw)) return raw.toUpperCase();
    const cid = String(locked?.scope?.couponId || "").trim();
    if (cid && (window.COUPONS instanceof Map)) {
      const meta = window.COUPONS.get(cid);
      if (meta?.code) return String(meta.code).toUpperCase();
    }
    return "";
  } catch { return ""; }
}

// --- Helpers: resolve code -> coupon, build lock, and error host ---
function findCouponByCode(codeUpp) {
  if (!(window.COUPONS instanceof Map)) return null;
  for (const [cid, meta] of window.COUPONS) {
    const mcode = (meta?.code || "").toString().trim().toUpperCase();
    if (mcode && mcode === codeUpp) return { cid: String(cid), meta };
  }
  return null;
}

function buildLockFromMeta(cid, meta) {
  // Eligible set from banners by coupon
  const elig = eligibleIdsFromBanners({ couponId: cid });
  return {
    scope: { couponId: cid, eligibleItemIds: Array.from(elig) },
    type:  String(meta?.type || "flat").toLowerCase(),
    value: Number(meta?.value || 0),
    minOrder: Number(meta?.minOrder || 0),
    valid: meta?.targets ? { delivery: !!meta.targets.delivery, dining: !!meta.targets.dining } : undefined,
    code: (meta?.code ? String(meta.code).toUpperCase() : undefined),
  };
}

// Create/find a small error line under the input (single-line, red, compact)
function ensurePromoErrorHost() {
  if (!R || !R.promoInput) return null;
  const parent = R.promoInput.parentElement || R.promoInput.closest(".inv-list") || R.promoInput.closest("form") || R.promoInput;
  let node = parent.querySelector("#promo-error");
  if (!node) {
    node = document.createElement("div");
    node.id = "promo-error";
    node.style.color = "#B00020";
    node.style.fontSize = "12px";
    node.style.marginTop = "6px";
    node.style.lineHeight = "1.2";
    node.style.minHeight = "14px";
    parent.appendChild(node);
  }
  return node;
}

function showPromoError(msg) {
  const host = ensurePromoErrorHost();
  if (host) host.textContent = msg || "";
}

  /* ===================== Promotions Discipline ===================== */
  // Hooks for future admin fields:
  // - minOrder: number  (already supported)
  // - usageLimit: number, usedCount: number (supported via checkUsageAvailable)
  function checkUsageAvailable(meta){
    // Future ready: if admin tracks usedCount per customer/user, plug it here.
    // For now, if usageLimit exists on meta and is 0 or less, treat as exhausted.
    if (!meta) return true;
    if (typeof meta.usageLimit === "number" && meta.usageLimit <= 0) return false;
    // If meta.usedCount >= usageLimit → not available
    if (typeof meta.usageLimit === "number" && typeof meta.usedCount === "number") {
      return meta.usedCount < meta.usageLimit;
    }
    return true;
  }

  function modeAllowed(locked){
    const m = activeMode();
    const v = locked?.valid;
    if (v && typeof v === "object" && (m in v)) return !!v[m];
    const cid = String(locked?.scope?.couponId||"");
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta && meta.targets && (m in meta.targets)) return !!meta.targets[m];
    return true;
  }

  function eligibleIdsFromBanners(scope){
    const out = new Set();
    if (!scope) return out;
    const bid = String(scope.bannerId||"").trim();
    const cid = String(scope.couponId||"").trim();

    if (window.BANNERS instanceof Map){
      const arr = window.BANNERS.get(bid) || window.BANNERS.get(`coupon:${cid}`);
      if (Array.isArray(arr)) arr.forEach(x=>out.add(String(x).toLowerCase()));
      return out;
    }
    if (Array.isArray(window.BANNERS)){
      const found = window.BANNERS.find(b => String(b?.id||"").trim() === bid);
      const arr = found?.items || found?.eligibleItemIds || found?.itemIds || [];
      if (Array.isArray(arr)) arr.forEach(x=>out.add(String(x).toLowerCase()));
      if (!out.size && cid) {
        const byCoupon = window.BANNERS.find(b => Array.isArray(b?.linkedCouponIds) && b.linkedCouponIds.includes(cid));
        const carr = byCoupon?.items || byCoupon?.eligibleItemIds || byCoupon?.itemIds || [];
        if (Array.isArray(carr)) carr.forEach(x=>out.add(String(x).toLowerCase()));
      }
    }
    return out;
  }

  // explicit eligibleItemIds > banner-derived > empty (strict)
  function resolveEligibilitySet(locked){
    const scope = locked?.scope || {};
    const explicit = (
      Array.isArray(scope.eligibleItemIds) ? scope.eligibleItemIds :
      Array.isArray(scope.eligibleIds)     ? scope.eligibleIds     :
      Array.isArray(scope.itemIds)         ? scope.itemIds         :
      []
    ).map(s=>String(s).toLowerCase());
    if (explicit.length) return new Set(explicit);

    const byBanner = eligibleIdsFromBanners(scope);
    if (byBanner.size) return byBanner;

    return new Set();
  }

  // FCFS: pick the first base item in the cart that matches any coupon eligibility,
  // and use that coupon exclusively (non-stackable).
  function findFirstApplicableCouponForCart(){
    const es = entries();
    if (!es.length) return null;
    if (!(window.COUPONS instanceof Map)) return null;

    // Build couponId -> eligible set
    const couponEligible = new Map();
    for (const [cid, meta] of window.COUPONS){
      if (!checkUsageAvailable(meta)) continue; // respect (future) usage limits
      const set = eligibleIdsFromBanners({ couponId: cid });
      if (set.size) couponEligible.set(String(cid), set);
    }

    for (const [key, it] of es){
      const parts = String(key).split(":");
      if (parts.length >= 3) continue; // skip add-ons
      const itemId  = String(it?.id ?? parts[0]).toLowerCase();
      const baseKey = parts.slice(0,2).join(":").toLowerCase();

      for (const [cid, set] of couponEligible){
        if (set.has(itemId) || set.has(baseKey) || Array.from(set).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))){
          const meta = window.COUPONS.get(cid) || {};
          // Prepare a full lock payload
          return {
            scope: { couponId: cid, eligibleItemIds: Array.from(set) },
            type:  String(meta?.type || "flat").toLowerCase(),
            value: Number(meta?.value || 0),
            minOrder: Number(meta?.minOrder || 0),
            valid: meta?.targets ? { delivery: !!meta.targets.delivery, dining: !!meta.targets.dining } : undefined,
            code: meta?.code ? String(meta.code).toUpperCase() : undefined,
            // future: usageLimit/usedCount could be mirrored into the lock if desired
          };
        }
      }
    }
    return null;
  }

  function clearLockIfNoLongerApplicable(){
    const lock = getLock();
    if (!lock) return;
    // If no eligible items for this lock remain, clear it.
    const elig = resolveEligibilitySet(lock);
    if (!elig.size){
      setLock(null);
      return;
    }
    // If the cart no longer contains any of the eligible IDs as base lines, clear it.
    let any = false;
    for (const [key, it] of entries()){
      if (isAddonKey(key)) continue;
      const parts = String(key).toLowerCase().split(":");
      const itemId  = String(it?.id ?? parts[0]);
      const baseKey = parts.slice(0,2).join(":");
      if (elig.has(itemId) || elig.has(baseKey) || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))){
        any = true; break;
      }
    }
    if (!any) setLock(null);
  }

function enforceFirstComeLock(){
  // If there’s a current lock but it’s no longer applicable, clear it first.
  clearLockIfNoLongerApplicable();

  // If we still have a lock, keep it only if it actually produces a discount now.
  const kept = getLock();
  const { base } = splitBaseVsAddons();
  if (kept) {
    const { discount } = computeDiscount(kept, base);
    if (discount > 0) return;         // keep current non-stackable lock
    // Otherwise fall through to try the next applicable coupon (FCFS among remaining items)
    setLock(null);
  }

  // Pick the first coupon that actually yields a non-zero discount for current cart & mode.
  const fcfs = findFirstApplicableCouponForCart();
  if (!fcfs) return;
  const test = computeDiscount(fcfs, base);
  if (test.discount > 0) setLock(fcfs);
}



  /* ===================== Discount computation ===================== */
  function computeDiscount(locked, baseSubtotal){
    if (!locked) return { discount:0 };

    // Mode gate
    if (!modeAllowed(locked)) return { discount:0 };

    // Admin minOrder (present/future)
    const minOrder = Number(locked?.minOrder || 0);
    if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0 };

    // Eligibility set (strict)
    const elig = resolveEligibilitySet(locked);
    if (!elig.size) return { discount:0 };

    // Eligible base subtotal only
    let eligibleBase = 0;
    for (const [key, it] of entries()){
      if (isAddonKey(key)) continue;
      const parts = String(key).split(":");
      const itemId  = String(it?.id ?? parts[0]).toLowerCase();
      const baseKey = parts.slice(0,2).join(":").toLowerCase();
      if (elig.has(itemId) || elig.has(baseKey) || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))){
        eligibleBase += clamp0(it.price) * clamp0(it.qty);
      }
    }
    if (eligibleBase <= 0) return { discount:0 };

const t = String(locked?.type||"").toLowerCase();
const v = Number(locked?.value||0);
let d = 0;
if (t === "percent") d = Math.round(eligibleBase * (v/100));
else if (t === "flat") d = Math.min(v, eligibleBase);
return { discount: Math.max(0, Math.round(d)) };
    
  }

  /* ===================== Grouping & rows ===================== */
  function buildGroups(){
    const gs = new Map(); // baseKey -> { base, addons[] }
    for (const [key, it] of entries()){
      const parts = String(key).split(":");
      const bKey = parts.slice(0,2).join(":");
      const addonName = parts[2];
      if (!gs.has(bKey)) gs.set(bKey, { base:null, addons:[] });
      if (addonName) {
        const name = (it?.addons?.[0]?.name) || addonName;
        gs.get(bKey).addons.push({ key, it, name });
      } else {
        gs.get(bKey).base = { key, it };
      }
    }
    return gs;
  }

  function removeAllAddonsOf(baseKey){
    const bag = window?.Cart?.get?.() || {};
    for (const k of Object.keys(bag)) {
      if (isAddonKey(k) && baseKeyOf(k) === baseKey) {
        window.Cart.setQty(k, 0);
      }
    }
  }

  function addonRow(baseKey, add){
    const { key, it, name } = add;
    const row = document.createElement("div");
    row.className = "addon-row";

    const label = document.createElement("div");
    label.className = "addon-label muted";
    label.textContent = `+ ${name}`;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "10px";

    const stepper = document.createElement("div");
    stepper.className = "stepper sm";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    const computeLine = () => INR(clamp0(it.price) * clamp0((window.Cart?.get?.()[key]?.qty || 0)));
    lineSub.textContent = computeLine();

    plus.addEventListener("click", () => {
      const cur = Number(window.Cart?.get?.()[key]?.qty || 0);
      const next = cur + 1;
      window.Cart.setQty(key, next, it);
      out.textContent = String(next);
      lineSub.textContent = computeLine();
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    minus.addEventListener("click", () => {
      const cur = Number(window.Cart?.get?.()[key]?.qty || 0);
      const next = Math.max(0, cur - 1);
      window.Cart.setQty(key, next, it);
      out.textContent = String(next);
      lineSub.textContent = computeLine();
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    right.append(stepper, lineSub);
    row.append(label, right);
    return row;
  }

  function baseRow(baseKey, it){
    const li = document.createElement("li");
    li.className = "cart-row grouped";
    li.dataset.key = baseKey;

    const mid = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "cart-title";
    title.textContent = it?.name || "";
    const sub = document.createElement("p");
    sub.className = "cart-sub";
    sub.textContent = `${it?.variant || ""} • ${INR(clamp0(it?.price))}`;

    const right = document.createElement("div");
    right.className = "row-right";

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    lineSub.textContent = INR(clamp0(it?.price) * clamp0(it?.qty));

    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it?.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    plus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[baseKey]?.qty)||0) + 1;
      window.Cart.setQty(baseKey, next, it);
      window.dispatchEvent(new CustomEvent("cart:update"));
    });
    minus.addEventListener("click", () => {
      const prev = (Number(window.Cart.get()?.[baseKey]?.qty)||0);
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(baseKey, next, it);
      if (next === 0) removeAllAddonsOf(baseKey);
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    const remove = document.createElement("button");
    remove.className = "remove-link";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      window.Cart.setQty(baseKey, 0);
      removeAllAddonsOf(baseKey);
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    mid.append(title, sub);
    right.append(stepper, lineSub, remove);
    li.append(mid, right);
    return li;
  }

  /* ===================== Layout & Invoice ===================== */
  let R = {};
  function resolveLayout(){
    const CFG = window.CART_UI?.list || {};
    R = {
      items:      document.querySelector(CFG.items),
      empty:      document.querySelector(CFG.empty || null),
      count:      document.querySelector(CFG.count || null),
      subtotal:   document.querySelector(CFG.subtotal || null),
      servicetax: document.querySelector(CFG.servicetax || null),
      total:      document.querySelector(CFG.total || null),
      proceed:    document.querySelector(CFG.proceed || null),
      invFood:    document.querySelector(CFG.invFood || null),
      invAddons:  document.querySelector(CFG.invAddons || null),
      promoLbl:   document.querySelector(CFG.promoLbl || null),
      promoAmt:   document.querySelector(CFG.promoAmt || null),
      promoInput: document.querySelector(CFG.promoInput || null),
      promoApply: document.querySelector(CFG.promoApply || null),
      badge:      document.querySelector('#cart-count'),
      // Delivery form container (created dynamically if missing)
      deliveryHost: document.querySelector('#delivery-form') || null,
    };
    return !!R.items;
  }

  function renderInvoiceLists(groups){
    const food = [], adds = [];
    for (const [, g] of groups){
      if (g.base){
        const it = g.base.it || {};
        const qty = clamp0(it.qty);
        if (qty > 0) food.push(`<div class="inv-row"><div>${it.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
      }
      for (const a of g.addons){
        const it = a.it || {};
        const qty = clamp0(it.qty);
        if (qty > 0) adds.push(`<div class="inv-row"><div>${a.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
      }
    }
    if (R.invFood)   R.invFood.innerHTML   = food.length ? food.join("") : `<div class="muted">None</div>`;
    if (R.invAddons) R.invAddons.innerHTML = adds.length ? adds.join("") : `<div class="muted">None</div>`;
  }

  /* ===================== Delivery Address form (mode = delivery) ===================== */
  function getAddress(){ try { return JSON.parse(localStorage.getItem(ADDR_KEY) || "null"); } catch { return null; } }
  function setAddress(obj){ try { obj ? localStorage.setItem(ADDR_KEY, JSON.stringify(obj)) : localStorage.removeItem(ADDR_KEY); } catch {} }

  function ensureDeliveryForm(){
    if (activeMode() !== "delivery") { if (R.deliveryHost) R.deliveryHost.remove(); return; }
    if (!R.deliveryHost) {
      const aside = document.querySelector("aside.cart-right") || document.body;
      const wrap = document.createElement("div");
      wrap.id = "delivery-form";
      wrap.style.marginTop = "12px";
      wrap.innerHTML = `
        <div class="pilltitle">Delivery Address</div>
        <div class="inv-list" id="delivery-fields">
          <input id="addr-name" placeholder="Full name"/>
          <input id="addr-phone" placeholder="Phone"/>
          <input id="addr-line1" placeholder="Address line 1"/>
          <input id="addr-line2" placeholder="Address line 2 (optional)"/>
          <input id="addr-area"  placeholder="Area / Locality"/>
          <input id="addr-pin"   placeholder="Pincode"/>
          <textarea id="addr-notes" placeholder="Delivery instructions (optional)"></textarea>
          <button id="addr-save" style="padding:10px;border:1px solid #111;background:#111;color:#fff;border-radius:8px;">Save Address</button>
        </div>
      `;
      aside.appendChild(wrap);
      R.deliveryHost = wrap;
      wireAddressForm();
    } else {
      wireAddressForm();
    }
  }

  function wireAddressForm(){
    const saved = getAddress() || {};
    const $ = (id) => R.deliveryHost.querySelector(id);
    const name=$('#addr-name'), phone=$('#addr-phone'), l1=$('#addr-line1'), l2=$('#addr-line2'),
          area=$('#addr-area'), pin=$('#addr-pin'), notes=$('#addr-notes'), save=$('#addr-save');
    if (name && !name.value)  name.value  = saved.name  || "";
    if (phone && !phone.value) phone.value= saved.phone || "";
    if (l1 && !l1.value)      l1.value    = saved.line1 || "";
    if (l2 && !l2.value)      l2.value    = saved.line2 || "";
    if (area && !area.value)  area.value  = saved.area  || "";
    if (pin && !pin.value)    pin.value   = saved.pin   || "";
    if (notes && !notes.value)notes.value = saved.notes || "";

    if (save && !save._wired){
      save._wired = true;
      save.addEventListener("click", ()=>{
        const obj = {
          name: name?.value?.trim() || "",
          phone: phone?.value?.trim() || "",
          line1: l1?.value?.trim() || "",
          line2: l2?.value?.trim() || "",
          area:  area?.value?.trim() || "",
          pin:   pin?.value?.trim() || "",
          notes: notes?.value?.trim() || ""
        };
        setAddress(obj);
        window.dispatchEvent(new CustomEvent("cart:update"));
      }, false);
    }
  }


  
  /* ===================== Render ===================== */
  function render(){
    if (!R.items && !resolveLayout()) return;

    // Enforce non-stackable, FCFS promo choice before totals.
    enforceFirstComeLock();

    const n = itemCount();
    if (R.badge)   R.badge.textContent = String(n);
    if (R.count)   R.count.textContent = `(${n} ${n===1?"item":"items"})`;
    if (R.proceed) R.proceed.disabled  = n === 0;
    if (R.empty)   R.empty.hidden      = n > 0;
    if (R.items)   R.items.hidden      = n === 0;

    // Left list
    if (R.items){
      R.items.innerHTML = "";
      const gs = buildGroups();
      for (const [, g] of gs){
        if (!g.base && g.addons.length){
          // synthesize shell if only add-ons exist for a baseKey
          const first = g.addons[0];
          g.base = { key: first.key.split(":").slice(0,2).join(":"), it: { ...(first.it||{}), qty: 0 } };
        }
        if (g.base){
          const row = baseRow(g.base.key, g.base.it);
          if (g.addons.length){
            const list = document.createElement("div");
            list.className = "addon-list";
            g.addons.sort((a,b)=>a.name.localeCompare(b.name)).forEach(a => list.appendChild(addonRow(g.base.key, a)));
            row.appendChild(list);
          }
          R.items.appendChild(row);
        }
      }
    }

    // Totals
    const { base, add } = splitBaseVsAddons();
    const locked = getLock();
    const { discount } = computeDiscount(locked, base);
    const preTax = clamp0(base + add - discount);
    const tax    = taxOn(preTax);
    const grand  = preTax + tax;

    renderInvoiceLists(buildGroups());

    if (R.subtotal)   R.subtotal.textContent   = INR(base + add);
    if (R.servicetax) R.servicetax.textContent = INR(tax);
    if (R.total)      R.total.textContent      = INR(grand);

    // Promo totals row (left label + right amount)
const codeText = locked ? displayCode(locked) : "";
if (R.promoLbl) {
  if (discount > 0) {
    const tag = codeText || "APPLIED";
    R.promoLbl.textContent = `Promotion (${tag}):`;
  } else {
    R.promoLbl.textContent = `Promotion (): none`;
  }
}
if (R.promoAmt) {
  R.promoAmt.textContent = `− ${INR(discount)}`;
}
// Clear any lingering error whenever a valid non-zero discount is active
if (discount > 0) showPromoError("");

  // Delivery address section (mode = delivery only)
    ensureDeliveryForm();

    // Manual Apply Coupon (no auto-fill from lock)
if (R.promoApply && !R.promoApply._wired){
  R.promoApply._wired = true;
  R.promoApply.addEventListener("click", ()=>{
    const code = (R.promoInput?.value || "").trim().toUpperCase();

    // If input is empty, DO NOTHING (don’t clear a valid existing lock by mistake)
    if (!code) {
      showPromoError(""); // clear any prior error
      return;
    }

    // Try to resolve code -> coupon
    const found = findCouponByCode(code);
    if (!found) {
      showPromoError("Invalid or Ineligible Coupon Code");
      return;
    }

    // Build a full lock from coupon meta + eligibility
    const fullLock = buildLockFromMeta(found.cid, found.meta);

    // Validate against current cart/mode/minOrder/eligibility
    const { base } = splitBaseVsAddons();
    const probe = computeDiscount(fullLock, base);
    if (!probe.discount || probe.discount <= 0) {
      showPromoError("Invalid or Ineligible Coupon Code");
      return;
    }

    // It’s valid: set as the active lock and clear any error
    setLock(fullLock);
    showPromoError("");
    window.dispatchEvent(new CustomEvent("cart:update"));
  }, false);
 }
}

  /* ===================== Boot & subscriptions ===================== */
  function boot(){
    resolveLayout();
    render();

    window.addEventListener("cart:update", render, false);
    window.addEventListener("serviceMode:changed", render, false);
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === "gufa_cart" || e.key === COUPON_KEY || e.key === ADDR_KEY) render();
    }, false);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") render();
    }, false);
    window.addEventListener("pageshow", (ev) => { if (ev && ev.persisted) render(); }, false);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }

  /* ===================== Debug helper ===================== */
  window.CartDebug = window.CartDebug || {};
  window.CartDebug.eval = function(){
    const lock = getLock();
    const { base, add } = splitBaseVsAddons();
    const elig = Array.from(lock ? resolveEligibilitySet(lock) : new Set());
    const { discount } = computeDiscount(lock, base);
    return { lock, mode:activeMode(), base, add, elig, discount };
  };
})();
