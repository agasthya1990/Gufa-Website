import { db } from "./firebase.client.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

function qs(name){ return new URLSearchParams(location.search).get(name); }

const orderId = qs("order");
const header = document.getElementById("trackHeader");
const tl = document.getElementById("timeline");

if (!orderId) {
  header.textContent = "No order specified.";
} else {
  onSnapshot(doc(db, "orders", orderId), (snap) => {
    if (!snap.exists()) {
      header.textContent = "Order not found.";
      return;
    }
    const o = snap.data();
    header.innerHTML = `
      <div><strong>Order:</strong> <code>${o.number || orderId}</code></div>
      <div><strong>Payment:</strong> ${o.payment?.method} – <em>${o.payment?.status}</em></div>
      <div><strong>Status:</strong> ${o.status}</div>
      <div><strong>Total:</strong> ₹${o.total}</div>
    `;

    tl.innerHTML = ["pending","accepted","preparing","ready","completed","cancelled"]
      .map(s => `<span class="badge ${o.status===s ? "ok" : ""}">${s}</span>`).join("");
  });
}

