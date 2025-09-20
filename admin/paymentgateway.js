// /admin/paymentgateway.js
import { db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  serverTimestamp, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * payments/{id}
 * { orderId, provider:"razorpay"|"stripe"|"cod", amount, currency:"INR",
 *   status:"created"|"authorized"|"captured"|"failed"|"refunded",
 *   providerOrderId?, providerPaymentId?, error?, createdAt, updatedAt }
 */

export async function recordPaymentCreate({ orderId, amount, provider="razorpay", currency="INR" }) {
  const ref = await addDoc(collection(db,"payments"), {
    orderId, provider, amount, currency, status:"created",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function markPaymentStatus(paymentId, status, patch={}) {
  await updateDoc(doc(db,"payments",paymentId), { status, updatedAt: serverTimestamp(), ...patch });
}

function ensurePaymentsUI(){
  let root = document.getElementById("paymentsRoot");
  if (root) return root;
  root = document.createElement("section");
  root.id = "paymentsRoot";
  root.innerHTML = `
    <div class="adm-card" style="margin:12px 0">
      <div class="adm-row">
        <select id="payProvider" class="adm-select">
          <option value="">All providers</option>
          <option value="razorpay">Razorpay</option>
          <option value="stripe">Stripe</option>
          <option value="cod">COD</option>
        </select>
        <select id="payStatus" class="adm-select">
          <option value="">All statuses</option>
          <option>created</option><option>authorized</option><option>captured</option>
          <option>failed</option><option>refunded</option>
        </select>
      </div>
    </div>
    <div class="adm-card">
      <table class="adm-table">
        <thead><tr><th>Order</th><th>Provider</th><th>Amount</th><th>Status</th><th>Provider ID</th><th></th></tr></thead>
        <tbody id="paymentsBody"></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

export function initPayments(){
  const root = ensurePaymentsUI();
  const body = root.querySelector("#paymentsBody");
  const provSel = root.querySelector("#payProvider");
  const statSel = root.querySelector("#payStatus");
  const state = { all: [], provider:"", status:"" };

  onSnapshot(query(collection(db,"payments"), orderBy("createdAt","desc")), (snap)=>{
    state.all = [];
    snap.forEach(d=> state.all.push({ id:d.id, data:d.data() }));
    render();
  });

  provSel.onchange = ()=>{ state.provider = provSel.value; render(); };
  statSel.onchange = ()=>{ state.status = statSel.value; render(); };

  function render(){
    const rows = state.all.filter(({data:p})=>{
      if (state.provider && p.provider !== state.provider) return false;
      if (state.status && p.status !== state.status) return false;
      return true;
    });

    body.innerHTML = "";
    rows.forEach(({id, data:p})=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.orderId || "-"}</td>
        <td>${p.provider}</td>
        <td>₹${p.amount}</td>
        <td><span class="adm-badge ${p.status==='captured'?'adm-badge--ok':p.status==='failed'?'adm-badge--danger':'adm-badge--muted'}">${p.status}</span></td>
        <td>${p.providerPaymentId || p.providerOrderId || "-"}</td>
        <td>
          <button class="adm-btn pg-capture" data-id="${id}" ${p.status!=='authorized'?'disabled':''}>Mark Captured</button>
          <button class="adm-btn adm-btn--danger pg-fail" data-id="${id}" ${p.status==='failed'?'disabled':''}>Mark Failed</button>
        </td>
      `;
      body.appendChild(tr);
    });

    body.querySelectorAll(".pg-capture").forEach(b=>{
      b.onclick = async ()=>{ await markPaymentStatus(b.dataset.id, "captured"); };
    });
    body.querySelectorAll(".pg-fail").forEach(b=>{
      b.onclick = async ()=>{ await markPaymentStatus(b.dataset.id, "failed"); };
    });
  }
}

/* Razorpay checkout helper (optional) */
export function openRazorpay({ key, amount, orderId, name, email, contact, onSuccess, onFailure }) {
  if (!window.Razorpay) { alert("Razorpay SDK not loaded"); return; }
  const rp = new window.Razorpay({
    key, amount: Math.round(amount*100), currency:"INR",
    name: "GUFA", order_id: orderId,
    prefill: { name, email, contact },
    handler: (resp)=> onSuccess?.(resp),
    modal: { ondismiss: ()=> onFailure?.({ error:{ description:"dismissed" }}) }
  });
  rp.open();
}

/* Auto-init */
(function(){ if (document.getElementById("paymentsRoot") || document.getElementById("paymentsBody")) initPayments(); })();

