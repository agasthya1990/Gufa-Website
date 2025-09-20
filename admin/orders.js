// /admin/orders.js
import { auth, db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, getDoc, onSnapshot,
  serverTimestamp, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const ORDER_STATUSES = ["pending","accepted","preparing","ready","completed","cancelled"];

export async function updateOrderStatus(orderId, status) {
  if (!ORDER_STATUSES.includes(status)) throw new Error("Invalid status");
  await updateDoc(doc(db, "orders", orderId), { status, updatedAt: serverTimestamp() });
}

export async function createTestOrder() {
  const ref = await addDoc(collection(db, "orders"), {
    number: "GF-" + Math.floor(Math.random()*1e6),
    items: [
      { name: "Paneer Tikka", qty: 1, price: 220, addons: ["Extra Cheese"] },
      { name: "Butter Naan", qty: 2, price: 60 }
    ],
    subtotal: 340, tax: 0, deliveryFee: 0, total: 340,
    customer: { name: "Walk-in", phone: "", address:"" },
    payment: { method:"COD", status:"pending" },
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

function ensureOrdersUI() {
  let root = document.getElementById("ordersRoot");
  if (root) return root;

  // Auto-inject a minimal UI if not present
  root = document.createElement("section");
  root.id = "ordersRoot";
  root.innerHTML = `
    <div class="adm-card" style="margin:12px 0">
      <div class="adm-row">
        <input id="ordersSearch" class="adm-input adm-grow" placeholder="Search order #, customer, item..." />
        <select id="ordersStatus" class="adm-select">
          <option value="">All statuses</option>
          ${ORDER_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join("")}
        </select>
        <button id="ordersTestBtn" class="adm-btn">+ Test Order</button>
      </div>
    </div>
    <div class="adm-card">
      <table class="adm-table">
        <thead>
          <tr>
            <th>#</th><th>Items</th><th>Total</th><th>Customer</th><th>Payment</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody id="ordersBody"></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function renderBadge(status) {
  const map = {
    completed: "adm-badge--ok",
    ready: "adm-badge--ok",
    preparing: "adm-badge--muted",
    accepted: "adm-badge--muted",
    cancelled: "adm-badge--danger",
    pending: "adm-badge--warn"
  };
  const cls = map[status] || "adm-badge--muted";
  return `<span class="adm-badge ${cls}">${status}</span>`;
}

export function initOrders() {
  const root = ensureOrdersUI();
  const tbody = root.querySelector("#ordersBody");
  const search = root.querySelector("#ordersSearch");
  const statusFilter = root.querySelector("#ordersStatus");
  const testBtn = root.querySelector("#ordersTestBtn");
  const state = { all: [], q:"", status:"" };

  testBtn.onclick = async ()=> { await createTestOrder(); };

  const qRef = query(collection(db,"orders"), orderBy("createdAt","desc"));
  onSnapshot(qRef, (snap)=>{
    state.all = [];
    snap.forEach(d => state.all.push({ id:d.id, data:d.data() }));
    render();
  });

  const debounce = (fn,ms=250)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
  search.addEventListener("input", debounce(()=>{
    state.q = (search.value||"").toLowerCase().trim(); render();
  }));
  statusFilter.onchange = ()=>{ state.status = statusFilter.value; render(); };

  function render(){
    const rows = state.all.filter(({data:o})=>{
      if (state.status && o.status !== state.status) return false;
      if (!state.q) return true;
      const hay = `${o.number||""} ${o.customer?.name||""} ${o.customer?.phone||""} ${(o.items||[]).map(i=>i.name).join(" ")}`.toLowerCase();
      return hay.includes(state.q);
    });

    tbody.innerHTML = "";
    rows.forEach(({id, data:o})=>{
      const itemsText = (o.items||[]).map(i => {
        const add = i.addons?.length ? ` <span class="adm-muted">(${i.addons.join(", ")})</span>` : "";
        return `${i.qty}× ${i.name}${add}`;
      }).join("<br/>");
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${o.number || id}</td>
        <td>${itemsText}</td>
        <td>₹${(o.total??0).toFixed(2)}</td>
        <td>${o.customer?.name || "-"}<br><span class="adm-muted">${o.customer?.phone || ""}</span></td>
        <td>${o.payment?.method || "-"}<br>${renderBadge(o.payment?.status || "pending")}</td>
        <td>
          <select class="adm-select ordStatus" data-id="${id}">
            ${ORDER_STATUSES.map(s=>`<option value="${s}" ${o.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </td>
        <td><button class="adm-btn adm-btn--ghost ordView" data-id="${id}">View</button></td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".ordStatus").forEach(sel=>{
      sel.onchange = async e=>{
        const id = e.target.dataset.id;
        const val = e.target.value;
        try { await updateOrderStatus(id, val); } catch(err){ alert(err.message); }
      };
    });
    tbody.querySelectorAll(".ordView").forEach(btn=>{
      btn.onclick = ()=> openOrderModal(btn.dataset.id);
    });
  }
}

/* ========= Order detail modal ========= */
function ensureOrderModal(){
  let modal = document.getElementById("orderModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "orderModal";
  modal.className = "adm-modal";
  modal.innerHTML = `
    <div class="adm-modal__dialog">
      <div class="adm-modal__head">
        <strong id="omTitle">Order</strong>
        <button id="omClose" class="adm-btn adm-btn--ghost">Close</button>
      </div>
      <div class="adm-modal__body" id="omBody"></div>
      <div class="adm-modal__foot">
        <select id="omStatus" class="adm-select"></select>
        <button id="omSave" class="adm-btn adm-btn--primary">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#omClose").onclick = ()=> modal.style.display = "none";
  return modal;
}

export async function openOrderModal(orderId){
  const modal = ensureOrderModal();
  const body = modal.querySelector("#omBody");
  const title = modal.querySelector("#omTitle");
  const sel = modal.querySelector("#omStatus");
  sel.innerHTML = ORDER_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join("");

  const snap = await getDoc(doc(db,"orders",orderId));
  if (!snap.exists()) { alert("Order not found"); return; }
  const o = snap.data();
  title.textContent = `Order ${o.number || orderId}`;

  const itemsHtml = (o.items||[]).map(i=>{
    const add = i.addons?.length ? ` <span class="adm-muted">(${i.addons.join(", ")})</span>` : "";
    return `<div>${i.qty}× ${i.name}${add} — ₹${(i.price*i.qty).toFixed(2)}</div>`;
  }).join("");

  body.innerHTML = `
    <div class="adm-form-grid">
      <div class="full"><strong>Items</strong><div>${itemsHtml || "-"}</div></div>
      <div><strong>Subtotal</strong><div>₹${(o.subtotal??0).toFixed(2)}</div></div>
      <div><strong>Delivery</strong><div>₹${(o.deliveryFee??0).toFixed(2)}</div></div>
      <div><strong>Total</strong><div>₹${(o.total??0).toFixed(2)}</div></div>
      <div class="full"><strong>Customer</strong>
        <div>${o.customer?.name || "-"}<br/><span class="adm-muted">${o.customer?.phone||""}</span><br/>${o.customer?.address||""}</div>
      </div>
      <div><strong>Payment</strong><div>${o.payment?.method || "-"} / ${o.payment?.status || "pending"}</div></div>
    </div>
  `;
  sel.value = o.status || "pending";

  modal.querySelector("#omSave").onclick = async ()=>{
    try { await updateOrderStatus(orderId, sel.value); modal.style.display = "none"; }
    catch(err){ alert(err.message); }
  };

  modal.style.display = "block";
}

/* Auto-init if page has #ordersRoot or #ordersBody */
(function(){ if (document.getElementById("ordersRoot") || document.getElementById("ordersBody")) initOrders(); })();
