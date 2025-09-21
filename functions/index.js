const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function calcTotals(items) {
  const subtotal = items.reduce((s, i) => s + (Number(i.price) * Number(i.qty)), 0);
  const discount = 0; // coupons later
  const total = Math.max(0, subtotal - discount);
  return { subtotal, discount, total };
}

exports.placeOrder = functions.https.onRequest((req, res) =>
  cors(req, res, async () => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { items, customer, method } = req.body || {};
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Empty cart" });
      if (!customer?.name || !customer?.phone || !customer?.address) {
        return res.status(400).json({ error: "Missing customer details" });
      }
      if (method !== "COD") return res.status(400).json({ error: "Only COD supported in this phase" });

      const totals = calcTotals(items);
      const orderRef = db.collection("orders").doc();
      await orderRef.set({
        number: "GF-" + Math.floor(Math.random() * 1e6),
        items,
        subtotal: totals.subtotal,
        discount: totals.discount,
        total: totals.total,
        customer,
        payment: { method: "COD", status: "pending" },
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.json({ orderId: orderRef.id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Server error" });
    }
  })
);

