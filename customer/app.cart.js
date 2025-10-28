// app.cart.js — promotions: first-come/first-served (non-stackable), strict eligibility,
// add-on auto-remove with base, promo amount as its own totals row, Delivery/Dining aware.
;(function(){
  /* ========== Money helpers ========== */
  const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
  const SERVICE_TAX_RATE = 0.05;
  const clamp0 = (n) => Math.max(0, Number(n)||0);
  const taxOn  = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

  /* ========== Mode ========== */
  function activeMode() {
    const raw = (localStorage.getItem("gufa:serviceMode") || localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
    return raw === "dining" ? "dining" : "delivery";
  }

  /* ========== Cart access ========== */
  function entries() {
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

  /* ========== Base vs Add-ons ========== */
  function splitBaseVsAddons() {
    let base = 0, add = 0;
    for (const [key, it] of entries()) {
      const isAddon = String(key).split(":").length >= 3;
      const line = clamp0(it.price) * clamp0(it.qty);
      if (isAddon) add += line; else base += line;
    }
    return { base, add };
  }

  function baseKeyOf(key){ return String(key).split(":").slice(0,2).join(":"); }
  function isAddonKey(key){ return String(key).split(":").length >= 3; }

  /* ========== Promo lock & catalogs ========== */
  const COUPON_KEY = "gufa_coupon";
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  if (!window.BANNERS) window.BANNERS = new Map(); // Map preferred; Array tolerated

  const getLock = () => { try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; } };
  const setLock = (obj) => { try { obj ? localStorage.setItem(COUPON_KEY, JSON.stringify(obj)) : localStorage.removeItem(COUPON_KEY); } catch {} };

  // Show only the true code; never invent defaults.
  function displayCode(locked) {
    try {
      if (!locked) return "";
      const raw = String(locked.code || "").trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
      if (raw && !isUuid) return raw.toUpperCase();

      const cid = String(locked?.scope?.couponId || "").trim();
      if (cid && (window.COUPONS instanceof Map)) {
        const meta = window.COUPONS.get(cid);
        if (meta?.code) return String(meta.code).toUpperCase();
      }
      return "";
    } catch { return ""; }
  }

  /* ========== Eligibility & gating ========== */
  function eligibleIdsFromBanners(scope) {
    const out = new Set();
    if (!scope) return out;

    const bid = String(scope.bannerId||"").trim();
    const cid = String(scope.couponId||"").trim();

    if (window.BANNERS instanceof Map) {
      const arr = window.BANNERS.get(bid) || window.BANNERS.get(`coupon:${cid}`);
      if (Array.isArray(arr)) arr.forEach(x => out.add(String(x).toLowerCase()));
      return out;
    }
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

  // explicit eligibleItemIds > banner-derived list > empty (strict)
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

  function modeAllowed(locked) {
    const m = activeMode();
    const v = locked?.valid;
    if (v && typeof v === "object" && (m in v)) return !!v[m];
    const cid = String(locked?.scope?.couponId||"");
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta && meta.targets && (m in meta.targets)) return !!meta.targets[m];
    return true;
  }

  /* ========== First-come/First-served promo (non-stackable) ========== */
  // Determine the first base item (by iteration order) that maps to any coupon via BANNERS lists.
  function findFirstApplicableCouponForCart(){
    const es = entries();
    if (!es.length) return null;

    // Build quick map: couponId -> eligible set
    const couponEligible = new Map();
    if (window.COUPONS instanceof Map) {
      for (const [couponId] of window.COUPONS) {
        const set = eligibleIdsFromBanners({ couponId });
        if (set.size) couponEligible.set(String(couponId), set);
      }
    }

    for (const [key, it] of es) {
      const parts = String(key).split(":");
      if (parts.length >= 3) continue; // skip add-ons
      const itemId  = String(it?.id ?? parts[0]).toLowerCase();
      const baseKey = parts.slice(0,2).join(":").toLowerCase();
      // scan coupons in defined order
      for (const [cid, set] of couponEligible) {
        if (set.has(itemId) || set.has(baseKey) || Array.from(set).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))) {
          const meta = window.COUPONS.get(cid) || {};
          return {
            scope: { couponId: cid, bannerId: undefined, eligibleItemIds: Array.from(set) },
            type:  String(meta?.type || "flat").toLowerCase(),
            value: Number(meta?.value || 0),
            minOrder: Number(meta?.minOrder || 0),
            valid: meta?.targets ? { delivery: !!meta.targets.delivery, dining: !!meta.targets.dining } : undefined,
            code: meta?.code ? String(meta.code).toUpperCase() : undefined,
          };
        }
      }
    }
    return null;
  }

  // Enforce FCFS lock: if there is no lock, or the current lock’s couponId/code doesn’t match the first applicable,
  // switch to the first applicable. Non-stackable: single promo only.
  function enforceFirstComeLock(){
    const current = getLock();
    const fcfs = findFirstApplicableCouponForCart();
    if (!fcfs) { return; }
    const curCid  = String(current?.scope?.couponId || "");
    const newCid  = String(fcfs?.scope?.couponId || "");
    const curCode = String(current?.code || "").toUpperCase();
    const newCode = String(fcfs?.code || "").toUpperCase();

    if (!current || (newCid && curCid !== newCid) || (newCode && curCode !== newCode)) {
      setLock(fcfs);
    }
  }

  /* ========== Discount (eligible base only) ========== */
  function computeDiscount(locked, baseSubtotal) {
    if (!locked) return { discount:0 };
    if (!modeAllowed(locked)) return { discount:0 };

    const minOrder = Number(locked?.minOrder || 0);
    if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0 };

    const elig = resolveEligibilitySet(locked);
    if (!elig.size) return { discount:0 };

    let eligibleBase = 0;
    for (const [key, it] of entries()) {
      const parts = String(key).split(":");
      if (parts.length >= 3) continue; // skip add-ons
      const itemId  = String(it?.id ?? parts[0]).toLowerCase();
      const baseK   = parts.slice(0,2).join(":").toLowerCase();
      if (elig.has(itemId) || elig.has(baseK) || Array.from(elig).some(x => !x.includes(":") && baseK.startsWith(x + ":"))) {
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

  /* ========== Grouping for left list ========== */
  function buildGroups() {
    const gs = new Map(); // baseKey -> { base:{key,it}, addons:[{key,it,name}] }
    for (const [key, it] of entries()) {
      const parts = String(key).split(":");
      const bKey = parts.slice(0,2).join(":");  // itemId:variant
      const addonName = parts[2];               // third part means addon
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

  /* ========== Add-on auto-remove helpers ========== */
  function removeAllAddonsOf(baseKey){
    const bag = window?.Cart?.get?.() || {};
    for (const k of Object.keys(bag)) {
      if (isAddonKey(k) && baseKeyOf(k) === baseKey) {
        window.Cart.setQty(k, 0);
      }
    }
  }

  // === Add-on row with steppers ===
  function addonRow(baseKey, add) {
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

  function baseRow(baseKey, it) {
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
      if (next === 0) removeAllAddonsOf(baseKey); // auto-remove add-ons
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    const remove = document.createElement("button");
    remove.className = "remove-link";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      window.Cart.setQty(baseKey, 0);
      removeAllAddonsOf(baseKey); // auto-remove add-ons
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    mid.append(title, sub);
    right.append(stepper, lineSub, remove);
    li.append(mid, right);
    return li;
  }

  /* ========== Layout ========== */
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
      promoAmt:   document.querySelector(CFG.promoAmt || null), // right-column amount
      promoInput: document.querySelector(CFG.promoInput || null),
      promoApply: document.querySelector(CFG.promoApply || null),
      badge:      document.querySelector('#cart-count'),
    };
    if (!R.items) console.warn("[cart] Missing layout anchors — checkout.html");
    return !!R.items;
  }

  function renderInvoiceLists(groups) {
    const food = [], adds = [];
    for (const [, g] of groups) {
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
  }

  /* ========== Render ========== */
  function render(){
    if (!R.items && !resolveLayout()) return;

    // Enforce FCFS promo (non-stackable) before computing totals
    enforceFirstComeLock();

    const n = itemCount();
    if (R.badge)   R.badge.textContent = String(n);
    if (R.count)   R.count.textContent = `(${n} ${n===1?"item":"items"})`;
    if (R.proceed) R.proceed.disabled  = n === 0;
    if (R.empty)   R.empty.hidden      = n > 0;
    if (R.items)   R.items.hidden      = n === 0;

    // Left list
    if (R.items) {
      R.items.innerHTML = "";
      const gs = buildGroups();
      for (const [, g] of gs) {
        if (!g.base && g.addons.length) {
          // synthesize base shell so add-ons anchor correctly
          const first = g.addons[0];
          g.base = { key: first.key.split(":").slice(0,2).join(":"), it: { ...(first.it||{}), qty: 0 } };
        }
        if (g.base) {
          const row = baseRow(g.base.key, g.base.it);
          if (g.addons.length) {
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
    const total  = preTax + tax;

    renderInvoiceLists(buildGroups());

    if (R.subtotal)   R.subtotal.textContent   = INR(base + add);
    if (R.servicetax) R.servicetax.textContent = INR(tax);
    if (R.total)      R.total.textContent      = INR(total);

    // Promo label (left) + amount (right column)
    const codeText = locked ? displayCode(locked) : "";
    if (R.promoLbl) R.promoLbl.textContent = codeText ? `Promotion (${codeText}):` : `Promotion (): none`;
    if (R.promoAmt) R.promoAmt.textContent = codeText ? `− ${INR(discount)}` : `− ${INR(0)}`;

    // Apply Coupon (manual) — do NOT auto-fill input from any lock
    if (R.promoApply && !R.promoApply._wired) {
      R.promoApply._wired = true;
      R.promoApply.addEventListener("click", () => {
        const code = (R.promoInput?.value||"").trim().toUpperCase();
        if (!code) {
          setLock(null);
        } else {
          // Keep scope if present; user-entered code overrides FCFS
          const prev = getLock() || {};
          const scope = prev.scope || {};
          setLock({ ...prev, code, scope });
        }
        window.dispatchEvent(new CustomEvent("cart:update"));
      }, false);
    }
  }

  /* ========== Boot & subscriptions ========== */
  function boot(){
    resolveLayout();
    render();

    window.addEventListener("cart:update", render, false);
    window.addEventListener("serviceMode:changed", render, false);
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === "gufa_cart" || e.key === COUPON_KEY) render();
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

  /* ========== Debug helper (kept) ========== */
  window.CartDebug = window.CartDebug || {};
  window.CartDebug.eval = function(){
    const lock = getLock();
    const { base, add } = splitBaseVsAddons();
    const elig = Array.from(lock ? resolveEligibilitySet(lock) : new Set());
    const { discount } = computeDiscount(lock, base);
    return { lock, mode:activeMode(), base, add, elig, discount };
  };
})();
