/**
 * PASTE into functions/index.js
 * Assumes you already have admin, express app, cors, and JSON middleware set up.
 */
const admin = require("firebase-admin");
const db = admin.firestore();

// --- helpers
function calcSubtotal(items) {
  return (items || []).reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
}
function normCode(code) {
  return String(code || "").trim().toUpperCase();
}
async function fetchActiveCoupon(code) {
  if (!code) return null;
  const q = await db.collection("promotions")
    .where("kind", "==", "coupon")
    .where("active", "==", true)
    .where("code", "==", code)
    .limit(1).get();
  return q.empty ? null : { id: q.docs[0].id, ...q.docs[0].data() };
}
function computeDiscount(subtotal, coupon) {
  if (!coupon) return 0;
  const v = Number(coupon.value || 0);
  if (coupon.type === "percent") {
    return Math.floor((subtotal * v) / 100);
  }
  if (coupon.type === "flat") {
    return Math.floor(v);
  }
  return 0;
}
async function readUsage(code) {
  const ref = db.collection("couponUsages").doc(code);
  const snap = await ref.get();
  return { ref, data: snap.exists ? snap.data() : { total: 0, users: {} } };
}

// --- NEW: validateCoupon (no writes)
app.post("/validateCoupon", async (req, res) => {
  try {
    const { items = [], couponCode = "", customer = {} } = req.body || {};
    const code = normCode(couponCode);
    const phone = String(customer?.phone || "").trim();
    const subtotal = calcSubtotal(items);

    const coupon = await fetchActiveCoupon(code);
    if (!coupon) return res.status(400).json({ valid: false, reason: "Code not found" });
    if (subtotal < Number(coupon.minOrder || 0)) {
      return res.status(400).json({ valid: false, reason: `Min order ₹${coupon.minOrder}` });
    }

    // Check limits (read-only)
    const { data: usage } = await readUsage(code);
    if (coupon.usageLimit != null && Number(usage.total || 0) >= Number(coupon.usageLimit)) {
      return res.status(400).json({ valid: false, reason: "Coupon fully used" });
    }
    if (phone && coupon.perUserLimit != null) {
      const uCount = Number((usage.users || {})[phone] || 0);
      if (uCount >= Number(coupon.perUserLimit)) {
        return res.status(400).json({ valid: false, reason: "Limit reached for this user" });
      }
    }

    const discount = Math.min(computeDiscount(subtotal, coupon), subtotal);
    const total = Math.max(0, subtotal - discount);
    return res.json({
      valid: true,
      subtotal, discount, total,
      coupon: { code, type: coupon.type, value: coupon.value }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ valid: false, reason: "Server error" });
  }
});

// --- UPDATE: placeOrder to apply coupon & increment usage atomically
app.post("/placeOrder", async (req, res) => {
  try {
    const { items = [], customer = {}, method = "COD", couponCode = null } = req.body || {};
    const phone = String(customer?.phone || "").trim();
    const code = normCode(couponCode);

    const subtotal = calcSubtotal(items);
    let discount = 0;
    let applied = null;

    // Validate coupon & increment usage in a transaction if provided
    if (code) {
      const coupon = await fetchActiveCoupon(code);
      if (!coupon) return res.status(400).json({ error: "Invalid coupon" });
      if (subtotal < Number(coupon.minOrder || 0)) {
        return res.status(400).json({ error: `Min order ₹${coupon.minOrder}` });
      }

      const usageRef = db.collection("couponUsages").doc(code);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(usageRef);
        const usage = snap.exists ? snap.data() : { total: 0, users: {} };

        // limits
        if (coupon.usageLimit != null && Number(usage.total || 0) >= Number(coupon.usageLimit)) {
          throw new Error("Coupon fully used");
        }
        if (phone && coupon.perUserLimit != null) {
          const uCount = Number((usage.users || {})[phone] || 0);
          if (uCount >= Number(coupon.perUserLimit)) throw new Error("Limit reached for this user");
        }

        // compute discount
        discount = Math.min(computeDiscount(subtotal, coupon), subtotal);
        applied = { code, type: coupon.type, value: coupon.value };

        // persist usage increments
        const next = {
          total: Number(usage.total || 0) + 1,
          users: { ...(usage.users || {}) }
        };
        if (phone) next.users[phone] = Number(next.users[phone] || 0) + 1;
        tx.set(usageRef, next, { merge: true });
      });
    }

    const total = Math.max(0, subtotal - discount);

    // Create order doc (you can also include coupon details for transparency)
    const order = {
      number: `GF-${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`,
      items,
      subtotal,
      discount,
      total,
      coupon: applied, // {code,type,value} or null
      customer,
      payment: { method, status: method === "COD" ? "pending" : "created" },
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const ref = await db.collection("orders").add(order);
    return res.json({ orderId: ref.id });
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e.message || "Order failed" });
  }
});
