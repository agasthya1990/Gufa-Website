// /customer/coupon-engine.js
// Tiny pure coupon engine: FCFS-ready, mode-gated, banner-scoped.
// Exports: CouponEngine.computeDiscount(cart, couponMeta, mode)
//          CouponEngine.nextLock(cart, coupons[], mode, priorityFn?)

(function (root) {
  "use strict";

  // ---------- utils (pure) ----------
  const clamp0 = (n) => Math.max(0, Number(n) || 0);

  function normalizeMode(mode) {
    const m = String(mode || "delivery").toLowerCase();
    return m === "dining" ? "dining" : "delivery";
  }

  // Iterate base lines from a variety of cart shapes
  // Supports:
  //   - { lines: [{id, price, qty, key}] }
  //   - { items: { "<baseKey>": {id, price, qty, ...}, ... } }
  //   - { "<baseKey>": {id, price, qty, ...}, ... }
  function iterBase(cart) {
    if (!cart) return [];
    // lines array
    if (Array.isArray(cart.lines)) {
      return cart.lines
        .filter((L) => clamp0(L.qty) > 0 && !isAddonKey(L.key))
        .map((L) => ({
          itemId: String(L.id ?? String(L.key || "").split(":")[0]).toLowerCase(),
          baseKey: String(L.key || `${L.id}:${L.variant || ""}`).toLowerCase(),
          qty: clamp0(L.qty),
          price: clamp0(L.price),
        }));
    }

    // items object
    const bag = typeof cart.items === "object" && cart.items ? cart.items : cart;
    return Object.entries(bag || {})
      .filter(([k, it]) => clamp0(it?.qty) > 0 && !isAddonKey(k))
      .map(([k, it]) => ({
        itemId: String(it?.id ?? String(k).split(":")[0]).toLowerCase(),
        baseKey: String(k).toLowerCase(),
        qty: clamp0(it?.qty),
        price: clamp0(it?.price),
      }));
  }

  function isAddonKey(key) {
    return String(key).split(":").length >= 3;
  }

  function modeAllowed(meta, mode) {
    const t = meta?.targets || {};
    if (t.delivery === true || t.dining === true) {
      return mode === "delivery" ? !!t.delivery : !!t.dining;
    }
    // default permissive if targets not specified
    return true;
  }

  // Build eligibility set (lowercased) from coupon meta
  // Expects meta.eligibleItemIds (preferred) OR caller pre-merges banner map into it.
  function buildElig(meta) {
    const arr =
      Array.isArray(meta?.eligibleItemIds) ? meta.eligibleItemIds :
      Array.isArray(meta?.eligibleIds) ? meta.eligibleIds :
      Array.isArray(meta?.itemIds) ? meta.itemIds : [];
    const s = new Set();
    for (const x of arr) {
      const v = String(x || "").trim().toLowerCase();
      if (v) s.add(v);
    }
    return s;
  }

  // Compute discount for one coupon against current cart (base-only)
  function computeDiscount(cart, couponMeta, mode) {
    if (!couponMeta) return { discount: 0, eligibleBase: 0, eligibleQty: 0 };

    const m = normalizeMode(mode);
    if (!modeAllowed(couponMeta, m)) return { discount: 0, eligibleBase: 0, eligibleQty: 0 };

    const minOrder = clamp0(couponMeta.minOrder);
    const elig = buildElig(couponMeta);
    if (!elig.size) return { discount: 0, eligibleBase: 0, eligibleQty: 0 };

    let eligibleBase = 0;
    let eligibleQty = 0;

    for (const L of iterBase(cart)) {
      const match =
        elig.has(L.itemId) ||
        elig.has(L.baseKey) ||
        // allow prefix match when elig contains bare itemId and baseKey is "id:variant"
        Array.from(elig).some((x) => x && !x.includes(":") && L.baseKey.startsWith(x + ":"));

      if (match) {
        eligibleBase += L.price * L.qty;
        eligibleQty += L.qty;
      }
    }

    if (eligibleBase <= 0) return { discount: 0, eligibleBase: 0, eligibleQty: 0 };
    if (minOrder > 0 && eligibleBase < minOrder) return { discount: 0, eligibleBase, eligibleQty };

    const type = String(couponMeta.type || "flat").toLowerCase();
    const value = clamp0(couponMeta.value);
    let d = 0;

    if (type === "percent") {
      d = Math.round(eligibleBase * (value / 100));
    } else if (type === "flat") {
      // flat per unit, capped by eligible base total
      d = Math.min(value * eligibleQty, eligibleBase);
    }

    return { discount: Math.max(0, Math.round(d)), eligibleBase, eligibleQty };
  }

  // Pick first applicable coupon by provided priority
  // coupons: array of { id, code, type, value, targets, eligibleItemIds[] }
  // priorityFn(aMeta, bMeta) => number (ascending). If omitted, natural order.
  function nextLock(cart, coupons, mode, priorityFn) {
    const m = normalizeMode(mode);
    const list = Array.isArray(coupons) ? coupons.slice() : [];

    // Filter to those that can possibly apply (mode + has elig)
    const candidates = list.filter((c) => modeAllowed(c, m) && buildElig(c).size > 0);

    if (typeof priorityFn === "function") {
      candidates.sort((a, b) => {
        try { return priorityFn(a, b); } catch { return 0; }
      });
    }

    for (const meta of candidates) {
      const res = computeDiscount(cart, meta, m);
      if (res.discount > 0) {
        const elig = Array.from(buildElig(meta));
        return {
          couponId: meta.id,
          code: (meta.code || meta.id || "").toString().toUpperCase(),
          type: (meta.type || "flat").toLowerCase(),
          value: clamp0(meta.value),
          elig,
          discount: res.discount,
        };
      }
    }
    return null;
  }

  // export
  root.CouponEngine = {
    computeDiscount,
    nextLock,
  };
})(typeof window !== "undefined" ? window : globalThis);

