// app.track.js — live order tracker with Cloud Function fallback
import { db } from "./firebase.client.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FUNCTIONS_BASE = "https://us-central1-gufa-restaurant.cloudfunctions.net";

function qs(name){ return new URLSearchParams(location.search).get(name); }

const orderId = qs("order");
const header = document.getElementById("trackHeader");
const tl = document.getElementById("timeline");

function render(order) {
  if (!order) { header.textContent = "Order not found."; return; }
  header.innerHTML = `
    <div><strong>Order:</strong> <code>${order.number || orderId}</code></div>
    <div><strong>Payment:</strong> ${order.payment?.method} – <em>${order.payment?.status}</em></div>
    <div><strong>Status:</strong> ${order.status}</div>
    <div><strong>Total:</strong> ₹${order.total}</div>
  `;
  const steps = ["pending","accepted","preparing","ready","completed","cancelled"];
  tl.innerHTML = steps.map(s => `<span class="badge ${order.status===s ? "ok" : ""}">${s}</span>`).join("");
}

async function fetchPublic() {
  try {
    const resp = await fetch(`${FUNCTIONS_BASE}/getOrderPublic?orderId=${encodeURIComponent(orderId)}`);
    if (!resp.ok) throw new Error("not ok");
    const data = await resp.json();
    render(data.order || null);
  } catch {
    render(null);
  }
}

if (!orderId) {
  header.textContent = "No order specified.";
} else {
  try {
    onSnapshot(
      doc(db, "orders", orderId),
      (snap) => render(snap.exists() ? snap.data() : null),
      // PERMISSION DENIED? → fallback to HTTPS
      () => fetchPublic()
    );
  } catch {
    fetchPublic();
  }
}
