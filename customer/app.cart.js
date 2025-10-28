// customer/app.cart.js — Checkout UI with strict, menu-aligned promotions
;(function(){
  /* =========================
   * Money / math helpers
   * ========================= */
  const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
  const SERVICE_TAX_RATE  = 0.05;
  const SERVICE_TAX_LABEL = "Service Tax";

  const clamp0 = (n) => Math.max(0, Number(n)||0);
  const taxOn  = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

  /* =========================
   * Mode helpers (Delivery/Dining)
   * ========================= */
  function activeMode() {
    // Prefer new key; fall back to legacy
    const a = (localStorage.getItem("gufa:serviceMode") || localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
    return a === "dining" ? "dining" : "delivery";
  }

  /* =========================
   * Cart accessors (flat)
   * ========================= */
  function entries() {
    try {
      const bag = (window?.Cart?.get?.() || {});
      if (bag && typeof bag === "object") return Object.entries(bag);
    } catch {}
    try {
      const raw = localStorage.getItem("gufa_cart");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const flat = (parsed && typeof parsed === "object")
        ? (parsed.items && typeof parsed.items === "object" ? parsed.items : parsed)
        : {};
      return Object.entries(flat || {});
    } catch { return []; }
  }

  function splits() {
    let base = 0, add = 0;
    for (const [, it] of entries()) {
      const keyParts = String(it?.id ? `${it.id}:${it.variant||""}` : "").split(":");
      const isAddon  = !it || !it.id || !it.variant || /:/.test((Object.keys(window.Cart?.get?.()||{}).find(k => (window.Cart.get()[k]===it))||"")) && String(keyParts.join(":")).length===0;
      // simpler, reliable: infer add-on by key shape
    }
    // Re-do using key shape to be exact:
    base = 0; add = 0;
    for (const [key, it] of entries()) {
      const isAddon = String(key).split(":").length >= 3;
      const line = clamp0(it.price) * clamp0(it.qty);
      if (isAddon) add += line; else base += line;
    }
    return { base, add };
  }

  function countItems() {
    return entries().reduce((n, [,it]) => n + (Number(it?.qty)||0), 0);
  }

  /* =========================
   * Coupon lock + hydration
   * ========================= */
  const COUPON_KEY = "gufa_coupon";
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  // BANNERS may be Map (preferred) or Array (legacy). We'll read both safely.
  if (!window.BANNERS) window.BANNERS = new Map();

  function getLock() {
    try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; }
  }
  function setLock(obj) {
    try {
      if (!obj) localStorage.removeItem(COUPON_KEY);
      else localStorage.setItem(COUPON_KEY, JSON.stringify(obj));
    } catch {}
  }

  function displayCode(locked) {
    try {
      const raw = String(locked?.code || "").trim();
      if (raw && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw.toUpperCase();
      const cid = String(locked?.scope?.couponId||"").trim();
      const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
      return (meta?.code ? String(meta.code).toUpperCase() : (raw || cid.toUpperCase()));
    } catch { return String(locked?.code||"").toUpperCase(); }
  }

  // Pull an eligibility list from BANNERS by bannerId/couponId, if present.
  function eligibleIdsFromBanners(scope) {
    const out = new Set();
    if (!scope) return out;

    const bid = String(scope.bannerId||"").trim();
    const cid = String(scope.couponId||"").trim();

    // Case 1: Map
    if (window.BANNERS instanceof Map) {
      const a = window.BANNERS.get(bid) || window.BANNERS.get(`coupon:${cid}`);
      if (Array.isArray(a)) a.forEach(x => out.add(String(x).toLowerCase()));
      return out;
    }

    // Case 2: Array of banner objects
    if (Array.isArray(window.BANNERS)) {
      const found = window.BANNERS.find(b => (String(b?.id||"").trim() === bid));
      const arr = found?.items || found?.eligibleItemIds || found?.itemIds || [];
      if (Array.isArray(arr)) arr.forEach(x => out.add(String(x).toLowerCase()));
      // Also allow a synthetic "coupon:<id>" index
      if (!out.size && cid) {
        const byCoupon = window.BANNERS.find(b => Array.isArray(b?.linkedCouponIds) && b.linkedCouponIds.includes(cid));
        const carr = byCoupon?.items || byCoupon?.eligibleItemIds || byCoupon?.itemIds || [];
        if (Array.isArray(carr)) carr.forEach(x => out.add(String(x).toLowerCase()));
      }
      return out;
    }

    return out;
  }

  // Final eligibility set (strict): scope.eligibleItemIds > banner-derived > empty
  function resolveEligibilitySet(locked) {
    const scope = locked?.scope || {};
    const ids = (
      Array.isArray(scope.eligibleItemIds) ? scope.eligibleItemIds :
      Array.isArray(scope.eligibleIds)     ? scope.eligibleIds     :
      Array.isArray(scope.itemIds)         ? scope.itemIds         :
      []
    ).map(s => String(s).toLowerCase());

    if (ids.length) return new Set(ids);

    // Try banner/coupon derived list
    const byBanner = eligibleIdsFromBanners(scope);
    if (byBanner.size) return byBanner;

    // Strict: no list => not eligible
    return new Set();
  }

  function modeAllowed(locked) {
    const t = locked?.valid || {};
    const m = activeMode();
    if (m in t) return !!t[m];
    // If meta exists in COUPONS use it
    const cid = String(locked?.scope?.couponId||"");
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta && meta.targets && (m in meta.targets)) return !!meta.targets[m];
    return true;
  }

  /* =========================
   * Discount core (strict)
   * ========================= */
  function computeDiscount(locked, baseSubtotal) {
    if (!locked) return { discount:0, reason:null };

    // Mode constraint
    if (!modeAllowed(locked)) return { discount:0, reason:"mode" };

    // Min-order (applies to base only)
    const minOrder = Number(locked?.minOrder || 0);
    if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0, reason:"min" };

    // Eligibility set
    const elig = resolveEligibilitySet(locked); // Set of itemIds (lowercase) or baseKeys accepted
    if (!elig.size) return { discount:0, reason:"scope" };

    // Compute eligible base
    let eligibleBase = 0;
    for (const [key, it] of entries()) {
      const parts = String(key).split(":");
      if (parts.length >= 3) continue; // skip add-ons
      const itemId  = String(it?.id ?? parts[0]).toLowerCase();
      const baseKey = parts.slice(0,2).join(":").toLowerCase();

      // Accept exact itemId, exact baseKey, or prefix match "<itemId>:"
      if (elig.has(itemId) || elig.has(baseKey) || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))) {
        eligibleBase += clamp0(it.price) * clamp0(it.qty);
      }
    }

    if (eligibleBase <= 0) return { discount:0, reason:"scope" };

    // Amount
    const t = String(locked?.type||"").toLowerCase();
    const v = Number(locked?.value||0);
    if (t === "percent") return { discount: Math.round(eligibleBase * (v/100)), reason:null };
    if (t === "flat")    return { discount: Math.min(v, eligibleBase), reason:null };
    return { discount:0, reason:null };
  }

  /* =========================
   * UI rendering (left: groups; right: invoice)
   * ========================= */
  function groupLines() {
    const gs = new Map(); // baseKey -> { base:{key,it}, addons:[{key,it,name}] }
    for (const [key, it] of entries()) {
      const parts = String(key).split(":");
      const baseKey = parts.slice(0,2).join(":");
      const addonName = parts[2];
      if (!gs.has(baseKey)) gs.set(baseKey, { base:null, addons:[] });
      if (addonName) {
        const name = (it?.addons?.[0]?.name) || addonName;
        gs.get(baseKey).addons.push({ key, it, name });
      } else {
        gs.get(baseKey).base = { key, it };
      }
    }
    return gs;
  }

  function addonRow(baseKey, add) {
    const { key, it, name } = add;
    const row = document.createElement("div");
    row.className = "addon-row";

    const label = document.createElement("div");
    label.className = "addon-label muted";
    label.textContent = `+ ${name}`;

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    lineSub.textContent = INR(clamp0(it.price) * clamp0(it.qty));

    // (Optional) steppers for add-ons — keep minimal to avoid overlap issues
    // If you want live steppers here, uncomment block below.
    /*
    const stepper = document.createElement("div");
    stepper.className = "stepper sm";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);
    plus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[key]?.qty)||0) + 1;
      window.Cart.setQty(key, next, it);
    });
    minus.addEventListener("click", () => {
      const prev = Number(window.Cart.get()?.[key]?.qty)||0;
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(key, next, it);
    });
    row.append(label, lineSub, stepper);
    */
    row.append(label, lineSub);
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

    // Minimal stepper for base
    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it?.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    plus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[baseKey]?.qty)||0) + 1;
      window.Cart.setQty(baseKey, next, it);
    });
    minus.addEventListener("click", () => {
      const prev = Number(window.Cart.get()?.[baseKey]?.qty)||0;
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(baseKey, next, it);
    });

    const remove = document.createElement("button");
    remove.className = "remove-link";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => window.Cart.setQty(baseKey, 0));

    mid.append(title, sub);
    right.append(stepper, lineSub, remove);
    li.append(mid, right);
    return li;
  }

  /* =========================
   * Layout wires
   * ========================= */
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
      countTop:   document.querySelector('#cart-count'),
    };
    if (!R.items) {
      console.warn("[cart] Missing layout anchors — check checkout.html");
      return false;
    }
    return true;
  }

  function renderInvoiceLists(groups) {
    const food = [];
    const adds = [];
    for (const [, g] of groups) {
      if (g.base) {
        const it = g.base.it || {};
        const qty = clamp0(it.qty);
        const name = it.name || "";
        const price = INR(clamp0(it.price) * qty);
        food.push(`<div class="inv-row"><div>${name} × ${qty}</div><strong>${price}</strong></div>`);
      }
      for (const a of g.addons) {
        const it = a.it || {};
        const qty = clamp0(it.qty);
        const name = a.name || "";
        const price = INR(clamp0(it.price) * qty);
        adds.push(`<div class="inv-row"><div>${name} × ${qty}</div><strong>${price}</strong></div>`);
      }
    }
    if (R.invFood)   R.invFood.innerHTML   = food.join("") || `<div class="muted">—</div>`;
    if (R.invAddons) R.invAddons.innerHTML = adds.join("") || `<div class="muted">—</div>`;
  }

  /* =========================
   * Main render
   * ========================= */
  function render(){
    if (!R.items && !resolveLayout()) return;

    const n = countItems();
    if (R.countTop) R.countTop.textContent = String(n);
    if (R.count)    R.count.textContent    = `(${n} ${n===1?"item":"items"})`;
    if (R.proceed)  R.proceed.disabled     = n === 0;
    if (R.empty)    R.empty.hidden         = n > 0;
    if (R.items)    R.items.hidden         = n === 0;

    // Left list
    if (R.items) {
      R.items.innerHTML = "";
      const gs = groupLines();
      for (const [baseKey, g] of gs) {
        // edge-case: only add-ons present for a baseKey
        if (!g.base && g.addons.length) {
          const first = g.addons[0];
          g.base = { key: baseKey, it: { ...(first.it||{}), qty: 0 } };
        }
        if (g.base) {
          const row = baseRow(g.base.key, g.base.it);
          if (g.addons.length) {
            const list = document.createElement("div");
            list.className = "addon-list";
            g.addons.sort((a,b)=>a.name.localeCompare(b.name)).forEach(a => list.appendChild(addonRow(baseKey, a)));
            row.appendChild(list);
          }
          R.items.appendChild(row);
        }
      }
    }

    // Totals math
    const { base, add } = splits();
    const locked = getLock();
    const { discount, reason } = computeDiscount(locked, base);
    const preTax = clamp0(base + add - discount);
    const tax    = taxOn(preTax);
    const total  = preTax + tax;

    // Right invoice breakdown lists
    renderInvoiceLists(groupLines());

    // Totals panel
    if (R.subtotal)   R.subtotal.textContent   = INR(base + add);
    if (R.servicetax) R.servicetax.textContent = INR(tax);
    if (R.total)      R.total.textContent      = INR(total);

    // Proceed guard also respects minOrder on base
    if (R.proceed && locked?.minOrder) {
      const ok = base >= Number(locked.minOrder||0);
      R.proceed.disabled = R.proceed.disabled || !ok;
    }

    // Promotion label (honest & strict)
    const modeNow  = activeMode();
    const codeText = displayCode(locked);
    const label = (function(){
      if (!locked || !codeText) return "Promotion () — Not Eligible";
      if (reason === "mode")  return `Promotion (${codeText}) — Not valid for ${modeNow==="dining"?"Dining":"Delivery"}`;
      if (reason === "min")   return `Promotion (${codeText}) — Min order not met`;
      if (reason === "scope") return `Promotion (${codeText}) — Not Eligible`;
      return `Promotion (${codeText})`;
    })();
    const amtText = (locked && reason==null) ? ("− " + INR(discount)) : ("− " + INR(0));
    if (R.promoLbl) R.promoLbl.textContent = label;
    if (R.promoAmt) R.promoAmt.textContent = amtText;

    // Promo input wiring (2cm bar)
    if (R.promoApply && !R.promoApply._wired) {
      R.promoApply._wired = true;
      R.promoApply.addEventListener("click", () => {
        const code = (R.promoInput?.value||"").trim().toUpperCase();
        if (!code) {
          setLock(null);
        } else {
          // Store minimal lock (keeps any existing scope fields if present)
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

  /* =========================
   * Boot & subscriptions
   * ========================= */
  function boot(){
    resolveLayout();
    render();
    // Re-render on cart or storage changes
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

  /* =========================
   * Debug probe (optional)
   * ========================= */
  window.CartDebug = window.CartDebug || {};
  window.CartDebug.eval = function(){
    const lock = getLock();
    const { base, add } = splits();
    const m = activeMode();
    const elig = Array.from(resolveEligibilitySet(lock));
    const out = computeDiscount(lock, base);
    return { lock, mode:m, base, add, elig, out };
  };
})();
