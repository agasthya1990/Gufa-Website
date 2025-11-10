// functions/index.js  — banner-aware validation (Option B)
// -------------------------------------------------------
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ---------------- helpers ----------------
const norm = (s) => String(s || "").trim();
const up = (s) => norm(s).toUpperCase();

function calcSubtotal(items = []) {
  return items.reduce((sum, i) => sum + (Number(i.price) * Number(i.qty || 1)), 0);
}
function baseItemIds(items = []) {
  // assumes addons carry isAddon flag; if you don’t have that, remove the filter
  return Array.from(new Set(items.filter(x => !x?.isAddon).map(x => norm(x.id))));
}
function computeDiscount(subtotal, coupon) {
  if (!coupon) return 0;
  const v = Number(coupon.value || 0);
  if (coupon.type === "percent") return Math.floor((subtotal * v) / 100);
  if (coupon.type === "flat")    return Math.floor(v);
  return 0;
}

async function fetchCouponByCode(code) {
  if (!code) return null;
  const q = await db.collection("promotions")
    .where("kind", "==", "coupon")
    .where("active", "==", true)
    .where("code", "==", code)
    .limit(1).get();
  if (q.empty) return null;
  const d = q.docs[0];
  return { id: d.id, ...d.data() };
}

async function fetchCouponById(promotionId) {
  const snap = await db.collection("promotions").doc(promotionId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.kind !== "coupon" || data.active === false) return null;
  return { id: snap.id, ...data };
}

async function fetchBanner(bannerId) {
  if (!bannerId) return null;
  const snap = await db.collection("promotions").doc(bannerId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (d.kind !== "banner" || d.active === false) return null;
  return { id: snap.id, ...d };
}

async function fetchLink(bannerId, promotionId) {
  const ref = db.collection("promotions").doc(bannerId)
                .collection("couponLinks").doc(promotionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.active === false) return null;
  return { id: snap.id, ref, ...data };
}

function channelAllowed({ coupon, banner, link, channel }) {
  const c = channel === "dining" ? "dining" : "delivery";
  const yes = (obj) => (obj == null) ? true : (obj[c] == null ? true : !!obj[c]);
  // allow if all three layers allow (missing means “don’t restrict”)
  return yes({[c]: coupon?.channels?.[c] !== false && coupon?.channels?.[c] !== 0}) &&
         yes(banner?.channels) &&
         yes(link?.channels);
}

function effectiveMinOrder({ coupon, link, banner, channel }) {
  const c = channel === "dining" ? "dining" : "delivery";
  const byChan = (coupon?.minOrderByChannel && coupon.minOrderByChannel[c] != null)
    ? Number(coupon.minOrderByChannel[c]) : null;
  const base = byChan != null ? byChan :
               (coupon?.minOrder != null ? Number(coupon.minOrder) : 0);
  const override = (link?.minOrderOverride != null) ? Number(link.minOrderOverride) : null;

  // Optional banner-wide floors (if you add them later)
  const floorByChan = (banner?.minOrderFloorByChannel && banner.minOrderFloorByChannel[c] != null)
    ? Number(banner.minOrderFloorByChannel[c]) : null;
  const floor = floorByChan != null ? floorByChan :
                (banner?.minOrderFloor != null ? Number(banner.minOrderFloor) : 0);

  const candidate = override != null ? override : base;
  return Math.max(Number(candidate || 0), Number(floor || 0));
}

function intersects(a = [], b = []) {
  const S = new Set(a);
  return b.some(x => S.has(x));
}

async function readUsageByCode(code) {
  const ref = db.collection("couponUsages").doc(code);
  const snap = await ref.get();
  return { ref, data: snap.exists ? snap.data() : { total: 0, users: {} } };
}

/**
 * Validate a coupon (or auto-assign) under a specific banner+channel.
 * Returns { ok, reason?, discount, subtotal, total, applied? }
 */
async function validateForBanner({ items, couponCode, bannerId, channel, phone, autoAssign }) {
  const cleanBannerId = norm(bannerId);
  const ch = (channel === "dining") ? "dining" : "delivery";
  const subtotal = calcSubtotal(items);
  const itemIds = baseItemIds(items);

  const banner = await fetchBanner(cleanBannerId);
  if (!banner) return { ok: false, reason: "Invalid or inactive banner" };

  // Helper to validate a specific coupon id (promotionId)
  const validateCouponId = async (promotionId, resolvedCode) => {
    const [coupon, link] = await Promise.all([
      fetchCouponById(promotionId),
      fetchLink(cleanBannerId, promotionId),
    ]);
    if (!coupon || !link) return { ok: false, reason: "Coupon not allowed for this banner" };
    if (!channelAllowed({ coupon, banner, link, channel: ch }))
      return { ok: false, reason: "Coupon not available for this channel" };
    if (!intersects(link.itemIds?.map(String) || [], itemIds))
      return { ok: false, reason: "Coupon not eligible for selected items" };

    const minNeed = effectiveMinOrder({ coupon, link, banner, channel: ch });
    if (subtotal < minNeed) return { ok: false, reason: `Min order ₹${minNeed}` };

    const code = resolvedCode || coupon.code || "";
    const { data: usage } = await readUsageByCode(up(code));
    if (coupon.usageLimit != null && Number(usage.total || 0) >= Number(coupon.usageLimit))
      return { ok: false, reason: "Coupon fully used" };
    if (phone && coupon.perUserLimit != null) {
      const uCount = Number((usage.users || {})[phone] || 0);
      if (uCount >= Number(coupon.perUserLimit)) return { ok: false, reason: "Limit reached for this user" };
    }

    const discount = Math.min(computeDiscount(subtotal, coupon), subtotal);
    const total = Math.max(0, subtotal - discount);
    return {
      ok: true,
      subtotal, discount, total,
      applied: { code: up(code), promotionId: coupon.id, type: coupon.type, value: coupon.value }
    };
  };

  // Branch A: explicit coupon code
  if (couponCode) {
    const c = await fetchCouponByCode(up(couponCode));
    if (!c) return { ok: false, reason: "Code not found" };
    return await validateCouponId(c.id, c.code);
  }

  // Branch B: auto-assign best eligible coupon from this banner (optional)
  if (autoAssign) {
    const linksSnap = await db.collection("promotions").doc(cleanBannerId)
      .collection("couponLinks").where("active", "==", true).get();
    const candidates = linksSnap.docs.map(d => ({ promotionId: d.id, ...d.data() }));
    let best = null;

    for (const cand of candidates) {
      const r = await validateCouponId(cand.promotionId);
      if (r.ok) {
        if (!best) best = r;
        else if (r.discount > best.discount) best = r;       // maximize discount
        else if (r.discount === best.discount && r.applied && best.applied) {
          // tie-break by link priority if needed
          const pA = Number(cand.priority || 0);
          const pB = Number((linksSnap.docs.find(x => x.id === best.applied.promotionId)?.data()?.priority) || 0);
          if (pA < pB) best = r;
        }
      }
    }
    return best || { ok: false, reason: "No eligible coupon for current items" };
  }

  return { ok: false, reason: "couponCode required (or set autoAssign=true)" };
}

// ---------------- endpoints ----------------

/** POST /validateCoupon
 *  body: { items: [{id, price, qty, isAddon?}], couponCode?, bannerId, channel, customer: {phone}, autoAssign? }
 */
exports.validateCoupon = functions.https.onRequest((req, res) =>
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ valid: false, reason: "POST required" });

      const { items = [], couponCode = "", customer = {}, bannerId = "", channel = "delivery", autoAssign = false } = req.body || {};
      const phone = norm(customer?.phone);
      const result = await validateForBanner({ items, couponCode: up(couponCode), bannerId, channel, phone, autoAssign });

      if (!result.ok) return res.status(400).json({ valid: false, reason: result.reason });
      const { subtotal, discount, total, applied } = result;
      return res.json({ valid: true, subtotal, discount, total, coupon: applied });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ valid: false, reason: "Server error" });
    }
  })
);

/** POST /placeOrder
 *  body: { items, customer:{phone}, method, couponCode?, bannerId, channel, autoAssign? }
 */
exports.placeOrder = functions.https.onRequest((req, res) =>
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

      const { items = [], customer = {}, method = "COD", couponCode = null, bannerId = "", channel = "delivery", autoAssign = false } = req.body || {};
      const phone = norm(customer?.phone);
      const subtotal = calcSubtotal(items);

      // Validate + (optionally) auto-assign
      const result = await validateForBanner({ items, couponCode: couponCode ? up(couponCode) : "", bannerId, channel, phone, autoAssign });
      if (!result.ok) return res.status(400).json({ error: result.reason });

      const { discount, total, applied } = result;

      // usage accounting (by CODE; compatible with your current data)
      if (applied?.code) {
        const codeKey = up(applied.code);
        const usageRef = db.collection("couponUsages").doc(codeKey);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(usageRef);
          const usage = snap.exists ? snap.data() : { total: 0, users: {} };

          const next = {
            total: Number(usage.total || 0) + 1,
            users: { ...(usage.users || {}) }
          };
          if (phone) next.users[phone] = Number(next.users[phone] || 0) + 1;
          tx.set(usageRef, next, { merge: true });
        });
      }

      const order = {
        number: `GF-${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`,
        items, subtotal, discount, total,
        coupon: applied, customer,
        payment: { method, status: method === "COD" ? "pending" : "created" },
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Keep traceability:
        bannerId: norm(bannerId),
        channel: (channel === "dining") ? "dining" : "delivery",
      };

      const orderRef = await db.collection("orders").add(order);
      return res.json({ orderId: orderRef.id });
    } catch (e) {
      console.error(e);
      return res.status(400).json({ error: e.message || "Server error" });
    }
  })
);

/** GET /getOrderPublic?orderId=...  (unchanged) */
exports.getOrderPublic = functions.https.onRequest((req, res) =>
  cors(req, res, async () => {
    try {
      const orderId = norm(req.query.orderId);
      if (!orderId) return res.status(400).json({ ok: false, error: "orderId required" });
      const snap = await db.collection("orders").doc(orderId).get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: "not found" });
      const o = snap.data();
      const pub = {
        number: o.number, status: o.status, total: o.total,
        payment: o.payment ? { method: o.payment.method, status: o.payment.status } : null
      };
      return res.json({ ok: true, order: pub });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: "server error" });
    }
  })
);

// Mirror from /menuItems/{itemId}/bannerLinks/{bannerId}
// -> /promotions/{bannerId}/couponLinks/{couponId}.itemIds[] (+ propagate overrides)
exports.syncBannerLinks = onDocumentWritten("menuItems/{itemId}/bannerLinks/{bannerId}", async (e) => {
  const { itemId, bannerId } = e.params;
  const before = e.data?.before?.data() || {};
  const after  = e.data?.after?.data()  || {};

  const prev = new Set(Array.isArray(before.bannerCouponIds) ? before.bannerCouponIds.map(String) : []);
  const next = new Set(Array.isArray(after.bannerCouponIds)  ? after.bannerCouponIds.map(String)  : []);

  // correct diff
  const removed = [...prev].filter(x => !next.has(x));
  const added   = [...next].filter(x => !prev.has(x));

  // optional fields to propagate onto couponLinks
  const extra = {};
  if (after.minOrderOverride != null) extra.minOrderOverride = Number(after.minOrderOverride);
  if (after.minOrderByChannel)        extra.minOrderByChannel = after.minOrderByChannel;
  if (after.minOrder != null)         extra.minOrder = Number(after.minOrder);
  if (after.channels)                 extra.channels = after.channels; // {delivery, dining}

  // Add this item to newly added coupons under the banner
  for (const couponId of added) {
    const linkRef = db.doc(`promotions/${bannerId}/couponLinks/${couponId}`);
    await linkRef.set({
      promotionId: couponId,
      active: true,
      itemIds: admin.firestore.FieldValue.arrayUnion(itemId),
      ...extra
    }, { merge: true });
  }

  // Remove this item from coupons that were removed
  for (const couponId of removed) {
    const linkRef = db.doc(`promotions/${bannerId}/couponLinks/${couponId}`);
    await linkRef.set({
      itemIds: admin.firestore.FieldValue.arrayRemove(itemId)
    }, { merge: true });
  }
});

// === AUTO-MIRROR: when an item's promotions change, sync /bannerLinks/* ===
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } = require("firebase-admin/firestore");

exports.mirrorBannerLinksOnPromotionChange = onDocumentWritten("menuItems/{itemId}", async (event) => {
  const after = event.data.after?.data();
  const before = event.data.before?.data();
  if (!after) return; // deleted

  const itemId = event.params.itemId;
  const afterIds = Array.isArray(after.promotions) ? after.promotions.map(String) : [];
  const beforeIds = Array.isArray(before?.promotions) ? before.promotions.map(String) : [];

  // Only work when promotions actually change
  if (afterIds.join("|") === beforeIds.join("|")) return;

  const db = getFirestore();

  // Build couponId -> bannerId map from active banners
  const couponToBanner = {};
  const bannersSnap = await db.collection("promotions").where("kind","==","banner").where("active","==",true).get();
  for (const bDoc of bannersSnap.docs) {
    const bid = bDoc.id;
    const b   = bDoc.data() || {};
    const linked = Array.isArray(b.linkedCouponIds) ? b.linkedCouponIds : [];
    linked.forEach(cid => { couponToBanner[String(cid)] = bid; });

    // optional subcollection /couponLinks
    const linkSnap = await db.collection(`promotions/${bid}/couponLinks`).get().catch(()=>null);
    if (linkSnap) linkSnap.forEach(d => { couponToBanner[String(d.id)] = bid; });
  }

  // Group selected coupons by banner
  const buckets = new Map(); // bannerId -> Set<couponId>
  for (const cid of afterIds) {
    const bid = couponToBanner[String(cid)];
    if (!bid) continue;
    if (!buckets.has(bid)) buckets.set(bid, new Set());
    buckets.get(bid).add(String(cid));
  }

  const itemRef = db.doc(`menuItems/${itemId}`);

  // Upsert /bannerLinks/{bannerId}
  for (const [bannerId, setOfCids] of buckets.entries()) {
    const blRef = itemRef.collection("bannerLinks").doc(bannerId);
    await blRef.set({
      bannerId,
      bannerCouponIds: Array.from(setOfCids),
      channels: { delivery: true, dining: true } // tweak later if you need per-mode
    }, { merge: true });
  }

  // Prune orphans (bannerLinks that no longer have any coupons via promotions)
  const existing = await itemRef.collection("bannerLinks").get();
  for (const d of existing.docs) {
    if (!buckets.has(d.id)) await d.ref.delete();
  }
});
