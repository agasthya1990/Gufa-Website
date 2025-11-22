/******************************************************
 * GUFA CART — FULL REWRITE (vNEXT)
 * Stable Architecture • No Patchwork • FCFS + Manual
 ******************************************************/

// ================== Local Storage / Utils ==================
const LS = {
  read(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }
};

function emit(evt, detail = {}) {
  window.dispatchEvent(new CustomEvent(evt, { detail }));
}

// CART SNAPSHOT
function CartBag() {
  return window?.Cart?.get?.() || {};
}

// ================== Coupon Lock Basics ==================
const COUPON_KEY = "gufa_coupon";

function getLock() {
  return LS.read(COUPON_KEY, null);
}

function setLock(obj) {
  if (!obj) return LS.remove(COUPON_KEY);
  LS.write(COUPON_KEY, obj);
  emit("promo:lock", { payload: obj });
}

// ================== Mode / Banner / Target helpers ==================
function activeMode() {
  const ms = (localStorage.getItem("gufa:serviceMode") || "").toLowerCase();
  const m  = (localStorage.getItem("gufa_mode") || "").toLowerCase();
  if (ms === "dining" || ms === "delivery") return ms;
  if (m  === "dining" || m  === "delivery") return m;
  return "delivery";
}

const lockIsBanner = (lock) => lock?.origin?.type === "banner";
const lockIsGlobal = (lock)  => !lockIsBanner(lock);

function isKnownBannerOrigin(origin) {
  const s = String(origin || "");
  return s.startsWith("banner:");
}

// ================== Lock Writer ==================
function writeCouponLock(couponId, meta = {}, origin = null) {
  if (!couponId || typeof meta !== "object") return false;
  const mode = activeMode();
  const t = meta.targets || { delivery:true, dining:true };

  const allowed = (mode === "delivery") ? !!t.delivery : !!t.dining;
  if (!allowed) return false;

  const eligibleIds = Array.isArray(meta.eligibleItemIds)
    ? meta.eligibleItemIds.map(String)
    : [];

  const payload = {
    code:  String(meta.code || couponId).toUpperCase(),
    type:  String(meta.type || "").toLowerCase(),
    value: Number(meta.value || 0),
    valid: { delivery: !!t.delivery, dining: !!t.dining },
    scope: { couponId: String(couponId), eligibleItemIds: eligibleIds },
    origin: origin || meta?.origin || null,
    source: meta?.source || "manual",
    lockedAt: Date.now()
  };

  setLock(payload);
  emit("cart:update", { reason:"lock-written", payload });
  return true;
}

// ================== Hydration Gate ==================
function promotionHydrationReady() {
  if (!(window.COUPONS instanceof Map)) return false;
  if (window.COUPONS.size === 0) return false;
  if (!Array.isArray(window.ITEMS) || window.ITEMS.length === 0) return false;
  return true;
}

// ================== Stale Lock Guard ==================
function guardStaleCouponLock() {
  try {
    const lock = getLock();
    if (!lock) return;

    if (!promotionHydrationReady()) return;

    const bag = CartBag();
    if (!bag || typeof bag !== "object") return;

    const bannerOnly = lockIsBanner(lock);
    const globalOnly = lockIsGlobal(lock);

    // Resolve eligibility
    let elig = (typeof resolveEligibilitySet === "function")
      ? resolveEligibilitySet(lock)
      : new Set();

    if (!elig || elig.size === 0) {
      const seed = Array.isArray(lock?.scope?.eligibleItemIds)
        ? lock.scope.eligibleItemIds
        : [];
      elig = new Set(seed.map(String));
    }

    if (!elig || elig.size === 0) {
      setLock(null);
      emit("cart:update", { reason:"stale:empty-elig" });
      return;
    }

    const baseKeys = Object.keys(bag)
      .filter(k => k.split(":").length < 3)
      .map(k => k.split(":")[0].toLowerCase());

    const validMatch = baseKeys.some(id => elig.has(id));
    if (!validMatch) {
      setLock(null);
      emit("cart:update", { reason:"stale:invalid-base" });
      return;
    }
  } catch (e) {
    console.warn("[guardStaleCouponLock] failed", e);
  }
}

/******************************************************
 * FCFS ENGINE — NEXT ELIGIBLE & AUTO APPLY
 ******************************************************/

function splitBaseVsAddons() {
  const bag = CartBag();
  const base = {};
  const addons = [];

  Object.keys(bag || {}).forEach(k => {
    const parts = k.split(":");
    if (parts.length < 3) {
      base[k] = bag[k];
    } else {
      const parent = parts[0];
      const qty = Number(parts[2] || 0);
      addons.push({ parent, key:k, qty, meta:bag[k] });
    }
  });

  return { base, addons };
}

// --- Compute discount preview (no mutation)
function computeDiscount(lockMeta, baseBag) {
  if (!lockMeta || !lockMeta.scope || !lockMeta.scope.eligibleItemIds) {
    return { discount:0, elig:[] };
  }

  const eligible = lockMeta.scope.eligibleItemIds.map(String);
  let total = 0;

  Object.keys(baseBag || {}).forEach(k => {
    const id = k.split(":")[0];
    if (eligible.includes(id)) {
      total += Number(baseBag[k]?.price || 0) * Number(baseBag[k]?.qty || 0);
    }
  });

  if (total <= 0) return { discount:0, elig:[] };

  if (lockMeta.type === "flat") {
    return { discount:Number(lockMeta.value), elig:eligible };
  }

  if (lockMeta.type === "percent") {
    return { discount: total * (Number(lockMeta.value) / 100), elig:eligible };
  }

  return { discount:0, elig:eligible };
}


// --- FCFS next applicable coupon engine
function enforceFirstComeLock() {
  const existing = getLock();
  const { base } = splitBaseVsAddons();

  // Manual always overrides auto
  if (existing && existing.source === "manual") {
    const p = computeDiscount(existing, base);
    if (p.discount > 0) return;
    setLock(null);
    return;
  }

  // If existing banner lock still produces discount -> keep
  if (existing && lockIsBanner(existing)) {
    const t = computeDiscount(existing, base);
    if (t.discount > 0) return;
    setLock(null);
  }

  // Find next FCFS
  if (typeof findFirstApplicableCouponForCart === "function") {
    const fcfs = findFirstApplicableCouponForCart();
    if (!fcfs) return;

    const t = computeDiscount(fcfs, base);
    if (t.discount > 0) {
      fcfs.source = "auto:fcfs";
      setLock(fcfs);
      emit("promo:unlocked", { reason:"fcfs-upgrade", coupon:fcfs });
    }
  }
}


/******************************************************
 * STORAGE EVENT SYNC — CROSS TAB + HYDRATION ORDER
 ******************************************************/
window.addEventListener("storage", (ev) => {
  if (ev.key === COUPON_KEY) {
    emit("cart:update", { reason:"storage-sync" });
  }
});

window.addEventListener("cart:changed", () => {
  guardStaleCouponLock();
  enforceFirstComeLock();
});

window.addEventListener("cart:update", () => {
  guardStaleCouponLock();
  enforceFirstComeLock();
});

/******************************************************
 * UI RENDER ENGINE — ITEM ROWS, ADD-ONS, TOTALS, PROMO BAR
 ******************************************************/

function resolveLayout() {
  return {
    root:       document.querySelector("#cart-root"),
    list:       document.querySelector("#cart-items"),
    totalRow:   document.querySelector("#cart-total-row"),
    promoBox:   document.querySelector("#promo-box"),
    promoInput: document.querySelector("#promo-input"),
    promoApply: document.querySelector("#promo-apply"),
    promoLbl:   document.querySelector("#promo-label")
  };
}

// -------------- Base Item Row --------------
function buildBaseRow(id, meta, qty) {
  const row = document.createElement("div");
  row.className = "cart-row base-row";

  const name = document.createElement("span");
  name.className = "c-name";
  name.textContent = meta.name || id;

  const price = document.createElement("span");
  price.className = "c-price";
  price.textContent = Number(meta.price || 0).toFixed(2);

  const qtyBox = document.createElement("div");
  qtyBox.className = "c-qty";

  const minus = document.createElement("button");
  minus.textContent = "-";
  minus.onclick = () => window.Cart.dec(id);

  const count = document.createElement("span");
  count.textContent = qty;

  const plus = document.createElement("button");
  plus.textContent = "+";
  plus.onclick = () => window.Cart.inc(id);

  qtyBox.append(minus, count, plus);
  row.append(name, price, qtyBox);

  return row;
}

// -------------- Addon Row --------------
function buildAddonRow(addon, parent) {
  const row = document.createElement("div");
  row.className = "cart-row addon-row";

  const name = document.createElement("span");
  name.className = "c-add-name";
  name.textContent = addon.meta?.name || addon.key;

  const price = document.createElement("span");
  price.className = "c-price";
  price.textContent = Number(addon.meta?.price || 0).toFixed(2);

  const qtyBox = document.createElement("div");
  qtyBox.className = "c-qty";

  const minus = document.createElement("button");
  minus.textContent = "-";
  minus.onclick = () => window.Cart.dec(addon.key);

  const count = document.createElement("span");
  count.textContent = addon.qty;

  const plus = document.createElement("button");
  plus.textContent = "+";
  plus.onclick = () => window.Cart.inc(addon.key);

  qtyBox.append(minus, count, plus);
  row.append(name, price, qtyBox);

  return row;
}


// -------------- Totals + Discount -----------------
function buildTotalsRow(base) {
  const UI = resolveLayout();
  const row = UI.totalRow;
  if (!row) return;

  const lock = getLock();
  let subtotal = 0;

  Object.keys(base || {}).forEach(k => {
    subtotal += Number(base[k]?.price || 0) * Number(base[k]?.qty || 0);
  });

  let discount = 0;
  if (lock) {
    const test = computeDiscount(lock, base);
    discount = Number(test.discount || 0);
  }

  let total = subtotal - discount;
  if (total < 0) total = 0;

  row.innerHTML = `
    <div class="sum-row">
      <div class="sum-label">Subtotal</div>
      <div class="sum-value">${subtotal.toFixed(2)}</div>
    </div>
    <div class="sum-row">
      <div class="sum-label">Discount</div>
      <div class="sum-value">-${discount.toFixed(2)}</div>
    </div>
    <hr>
    <div class="sum-row total">
      <div class="sum-label">Total</div>
      <div class="sum-value">${total.toFixed(2)}</div>
    </div>
  `;
}


// -------------- Promo Input UI -----------------
function wireApplyCouponUI() {
  const UI = resolveLayout();
  const input = UI.promoInput;
  const btn   = UI.promoApply;

  if (!btn || !input) return;

  const apply = async () => {
    const code = input.value.trim();
    if (!code) return;

    if (!(window.COUPONS instanceof Map)) return;

    const found = [...window.COUPONS.entries()].find(
      ([cid, meta]) => meta.code?.toUpperCase() === code.toUpperCase() || cid === code
    );

    if (!found) {
      UI.promoLbl.textContent = "Invalid or inactive promotion";
      return;
    }

    const [couponId, meta] = found;
    meta.source = "manual";
    writeCouponLock(couponId, meta, meta?.origin || null);

    UI.promoLbl.textContent = `Applied: ${meta.code || couponId}`;
    emit("cart:update", { reason:"manual-apply", coupon:couponId });
  };

  btn.addEventListener("click", apply);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") apply();
  });
}

/******************************************************
 * CORE CART ENGINE RESTORE (temporary stable engine)
 ******************************************************/

// Fallback Cart API shim so UI does not crash
window.Cart = window.Cart || {
  _data: {},
  get() { return this._data; },
  inc(id) {
    const bag = this._data;
    if (!bag[id]) bag[id] = { qty:1, price:(window.ITEMS?.find(i=>i.id===id)?.price||0), name:(window.ITEMS?.find(i=>i.id===id)?.name||id) };
    else bag[id].qty++;
    emit("cart:changed");
  },
  dec(id) {
    const bag = this._data;
    if (!bag[id]) return;
    bag[id].qty--;
    if (bag[id].qty <= 0) delete bag[id];
    emit("cart:changed");
  }
};


// === Eligibility Resolution Engine ===
function resolveEligibilitySet(lock) {
  if (!lock || !lock.scope?.eligibleItemIds) return new Set();
  return new Set(lock.scope.eligibleItemIds.map(String));
}


// === FCFS Finder ===
// Picks first coupon that generates >0 discount
function findFirstApplicableCouponForCart() {
  if (!(window.COUPONS instanceof Map)) return null;

  const { base } = splitBaseVsAddons();
  let best = null;

  for (const [cid, meta] of window.COUPONS.entries()) {
    if (!meta) continue;
    const eligible = meta.eligibleItemIds || [];
    if (!Array.isArray(eligible) || eligible.length === 0) continue;

    let total = 0;
    for (const k of Object.keys(base)) {
      const id = k.split(":")[0];
      if (eligible.includes(id)) {
        total += Number(base[k]?.price || 0) * Number(base[k]?.qty || 0);
      }
    }

    if (total > 0) {
      best = {
        code: meta.code || cid,
        type: meta.type,
        value: meta.value,
        scope: { couponId: cid, eligibleItemIds: eligible.map(String) },
        origin: meta.origin || null
      };
      break;
    }
  }

  return best;
}


// -------------- MAIN RENDER -----------------
function renderCart() {
  const UI = resolveLayout();
  if (!UI.root || !UI.list) return;

  const { base, addons } = splitBaseVsAddons();

  UI.list.innerHTML = "";
  Object.keys(base).forEach(k => {
    UI.list.append(buildBaseRow(k.split(":")[0], base[k], base[k].qty));
    addons.filter(a => a.parent === k.split(":")[0])
          .forEach(add => UI.list.append(buildAddonRow(add, k.split(":")[0])));
  });

  buildTotalsRow(base);
  wireApplyCouponUI();
}

/******************************************************
 * HYDRATION & SERVICE MODE SYNC
 ******************************************************/

// Hydrate existing coupon lock on load (no evaluation yet)
function hydrateExistingLock() {
  const raw = getLock();
  if (!raw) return;

  // wait for hydration readiness to validate
  const timer = setInterval(() => {
    if (promotionHydrationReady()) {
      clearInterval(timer);
      guardStaleCouponLock();
      enforceFirstComeLock();
      emit("cart:update", { reason:"hydrate-lock" });
    }
  }, 120);
}


// Service Mode Change Logic
function wireModeSync() {
  window.addEventListener("storage", (ev) => {
    if (ev.key === "gufa:serviceMode" || ev.key === "gufa_mode") {
      const lock = getLock();
      if (lock && !lock.valid?.[activeMode()]) {
        setLock(null);
        emit("cart:update", { reason:"mode-clear" });
      }
      renderCart();
    }
  });
}


/******************************************************
 * MASTER EVENT WIRING
 ******************************************************/
function wireCartEngine() {
  window.addEventListener("cart:changed", () => {
    guardStaleCouponLock();
    enforceFirstComeLock();
    renderCart();
  });

  window.addEventListener("cart:update", () => {
    guardStaleCouponLock();
    enforceFirstComeLock();
    renderCart();
  });

  window.addEventListener("promo:unlocked", () => {
    guardStaleCouponLock();
    enforceFirstComeLock();
    renderCart();
  });

  // Re-render on window focus
  window.addEventListener("focus", () => {
    guardStaleCouponLock();
    enforceFirstComeLock();
    renderCart();
  });
}


/******************************************************
 * BOOTSTRAP & INITIAL RENDER
 ******************************************************/
function bootCart() {
  hydrateExistingLock();
  wireApplyCouponUI();
  wireModeSync();
  wireCartEngine();
  renderCart();
}

// Kick off
document.addEventListener("DOMContentLoaded", bootCart);
