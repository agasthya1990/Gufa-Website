// customer/coupon-engine.js
// Pure, framework-free engine. No DOM. No storage.
// Input:
//   cart:    { lines: [{id, qty, price}] }  // lowercase ids recommended
//   coupons: [{ id, code, type, value, targets, eligibleItemIds }]
//   mode:    "delivery" | "dining"
//   priority(a,b): optional comparator; if omitted, preserve input order
//
// Output (or null):
//   { couponId, code, type, value, elig: [itemIds present in cart], discount, reason?:string }

(function (g) {
  function clamp0(n){ n = Number(n)||0; return n < 0 ? 0 : n; }

  // compute per-coupon discount strictly on eligible base lines
  function computeDiscountFor(cart, coupon) {
    const type = String(coupon.type||"flat").toLowerCase();
    const v    = Number(coupon.value||0);
    const elig = new Set((coupon.eligibleItemIds||[]).map(s=>String(s).toLowerCase()));

    if (!elig.size) return { discount:0, eligHits:[] };

    let eligibleBase = 0;
    let eligibleQty  = 0;
    const hits = [];
    for (const L of (cart.lines||[])) {
      const id = String(L.id||"").toLowerCase();
      const q  = clamp0(L.qty);
      const p  = clamp0(L.price);
      if (!q || !p) continue;
      if (elig.has(id)) {
        eligibleBase += p * q;
        eligibleQty  += q;
        if (!hits.includes(id)) hits.push(id);
      }
    }
    if (eligibleBase <= 0) return { discount:0, eligHits:[] };

    let d = 0;
    if (type === "percent") d = Math.round(eligibleBase * (v/100));
    else if (type === "flat") d = Math.min(v * eligibleQty, eligibleBase); // flat per unit, cap at subtotal
    return { discount: clamp0(Math.round(d)), eligHits: hits };
  }

  function nextLock(cart, coupons, mode, priority) {
    const list = Array.isArray(coupons) ? coupons.slice() : [];
    if (!list.length || !Array.isArray(cart?.lines) || !cart.lines.length) return null;

    // mode gate
    const filtered = list.filter(c => {
      const t = c?.targets || {};
      if (mode === "dining")   return (t.dining   ?? true);
      if (mode === "delivery") return (t.delivery ?? true);
      return true;
    });

    // optional ordering (FCFS “first-seen” can be supplied by caller)
    if (typeof priority === "function") {
      filtered.sort(priority);
    }

    // pick first coupon that yields a non-zero discount
    for (const c of filtered) {
      const { discount, eligHits } = computeDiscountFor(cart, c);
      if (discount > 0 && eligHits.length) {
        return {
          couponId: c.id,        // id can be an internal id or the code itself
          code: (c.code||"").toString().toUpperCase(),
          type: (c.type||"flat").toLowerCase(),
          value: Number(c.value||0),
          elig: eligHits.slice(),
          discount
        };
      }
    }
    return null;
  }

  g.CouponEngine = { nextLock };
})(window);
