// app.cart.js — strict promo sync, Delivery/Dining aware, no image rendering, no auto-fill for banner coupons
;(function(){
  /* ===== Currency & math ===== */
  const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
  const SERVICE_TAX_RATE = 0.05;
  const clamp0 = (n) => Math.max(0, Number(n)||0);
  const taxOn  = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

  /* ===== Mode ===== */
  function activeMode() {
    const raw = (localStorage.getItem("gufa:serviceMode") || localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
    return raw === "dining" ? "dining" : "delivery";
  }

  /* ===== Cart I/O ===== */
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
  const countItems = () => entries().reduce((n, [,it]) => n + (Number(it?.qty)||0), 0);

  function splitBaseVsAddons() {
    let base = 0, add = 0;
    for (const [key, it] of entries()) {
      const isAddon = String(key).split(":").length >= 3;
      const line = clamp0(it.price) * clamp0(it.qty);
      if (isAddon) add += line; else base += line;
    }
    return { base, add };
  }

  /* ===== Promo lock + catalogs ===== */
  const COUPON_KEY = "gufa_coupon";
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  if (!window.BANNERS) window.BANNERS = new Map(); // Map preferred; Array tolerated

  const getLock = () => { try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; } };
  const setLock = (obj) => { try { obj ? localStorage.setItem(COUPON_KEY, JSON.stringify(obj)) : localStorage.removeItem(COUPON_KEY); } catch {} };

  function displayCode(locked) {
    try {
      const raw = String(locked?.code || "").trim();
      if (raw && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw.toUpperCase();
      const cid = String(locked?.scope?.couponId||"").trim();
      const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
      return (meta?.code ? String(meta.code).toUpperCase() : (raw || cid.toUpperCase()));
    } catch { return String(locked?.code||"").toUpperCase(); }
  }

  /* ===== Eligibility ===== */
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
    return new Set(); // strict: no list ⇒ no discount
  }

  function modeAllowed(locked) {
    const m = activeMode();
    const t = locked?.valid;
    if (t && typeof t === "object" && (m in t)) return !!t[m];
    const cid = String(locked?.scope?.couponId||"");
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta && meta.targets && (m in meta.targets)) return !!meta.targets[m];
    return true;
  }

  /* ===== Discount core (percent/flat; base-only) ===== */
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
      if (parts.length >= 3) continue; // add-ons excluded
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

  /* ===== Left list (no images) ===== */
  function buildGroups() {
    const gs = new Map(); // baseKey -> { base, addons[] }
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
    label.className = "addon-label"; // stronger styling via CSS
    label.textContent = `+ ${name}`;
    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    lineSub.textContent = INR(clamp0(it.price) * clamp0(it.qty));
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
      const prev = (Number(window.Cart.get()?.[baseKey]?.qty)||0);
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

  /* ===== Layout anchors ===== */
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
    }
    return !!R.items;
  }

  function renderInvoiceLists(gs) {
    const food = [], adds = [];
    for (const [, g] of gs) {
      if (g.base) {
        const it = g.base.it || {};
        const qty = clamp0(it.qty);
        if (qty > 0) {
          food.push(`<div class="inv-row"><div>${it.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
        }
      }
      for (const a of g.addons) {
        const it = a.it || {};
        const qty = clamp0(it.qty);
        if (qty > 0) {
          adds.push(`<div class="inv-row"><div>${a.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
        }
      }
    }
    if (R.invFood)   R.invFood.innerHTML   = food.length ? food.join("") : `<div class="muted">None</div>`;
    if (R.invAddons) R.invAddons.innerHTML = adds.length ? adds.join("") : `<div class="muted">None</div>`;
  }

  /* ===== Render ===== */
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
      const gs = buildGroups();
      for (const [, g] of gs) {
        if (!g.base && g.addons.length) {
          // Only add-ons present for a baseKey → create a shell so add-ons anchor correctly
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

    // Totals & promo
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

    // Label rules (no "Not Eligible" strings):
    // - no code: "Promotion (): none"
    // - with code: "Promotion (CODE):"
    const codeText = locked ? displayCode(locked) : "";
    const label = codeText ? `Promotion (${codeText}):` : `Promotion (): none`;
    if (R.promoLbl) R.promoLbl.textContent = label;

    // Amount always visible (percent or flat): − ₹X (₹0 if not applicable)
    if (R.promoAmt) R.promoAmt.textContent = `− ${INR(discount)}`;

    // Apply Coupon: DO NOT auto-fill input from banner lock
    // (We intentionally do NOT set R.promoInput.value from locked)
    if (R.promoApply && !R.promoApply._wired) {
      R.promoApply._wired = true;
      R.promoApply.addEventListener("click", () => {
        const code = (R.promoInput?.value||"").trim().toUpperCase();
        if (!code) {
          setLock(null);
        } else {
          const prev = getLock() || {};
          const scope = prev.scope || {}; // keep scope if it exists
          setLock({ ...prev, code, scope });
        }
        window.dispatchEvent(new CustomEvent("cart:update"));
      }, false);
    }
  }

  /* ===== Boot ===== */
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

  /* ===== Debug ===== */
  window.CartDebug = window.CartDebug || {};
  window.CartDebug.eval = function(){
    const lock = getLock();
    const { base, add } = splitBaseVsAddons();
    const elig = Array.from(lock ? resolveEligibilitySet(lock) : new Set());
    const { discount } = computeDiscount(lock, base);
    return { lock, mode:activeMode(), base, add, elig, discount };
  };
})();
