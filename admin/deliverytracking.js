// /admin/deliverytracking.js
import { db } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  onSnapshot, serverTimestamp, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * deliveries/{id}
 * { orderId, driver:{ id?, name?, phone? }, status:"unassigned"|"assigned"|"picked_up"|"in_transit"|"delivered"|"failed",
 *   notes?, location?: { lat, lng, updatedAt }, createdAt, updatedAt }
 *
 * drivers/{id} { name, phone, active:boolean }
 */
export const DELIVERY_STATUSES = ["unassigned","assigned","picked_up","in_transit","delivered","failed"];

export async function createDeliveryShell(orderId){
  const ref = await addDoc(collection(db,"deliveries"), {
    orderId, status:"unassigned", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return ref.id;
}
export async function assignDriver(deliveryId, driver){
  await updateDoc(doc(db,"deliveries",deliveryId), { driver, status:"assigned", updatedAt: serverTimestamp() });
}
export async function updateDeliveryStatus(deliveryId, status, patch={}){
  if (!DELIVERY_STATUSES.includes(status)) throw new Error("Invalid status");
  await updateDoc(doc(db,"deliveries",deliveryId), { status, updatedAt: serverTimestamp(), ...patch });
}

function ensureDeliveriesUI(){
  let root = document.getElementById("deliveriesRoot");
  if (root) return root;
  root = document.createElement("section");
  root.id = "deliveriesRoot";
  root.innerHTML = `
    <div class="adm-card" style="margin:12px 0">
      <div class="adm-row">
        <input id="delSearch" class="adm-input adm-grow" placeholder="Search order id or driver..." />
        <select id="delStatus" class="adm-select">
          <option value="">All statuses</option>
          ${DELIVERY_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join("")}
        </select>
        <button id="drvAddBtn" class="adm-btn">+ Driver</button>
      </div>
    </div>
    <div class="adm-card">
      <table class="adm-table">
        <thead><tr><th>Order</th><th>Driver</th><th>Status</th><th>Location</th><th></th></tr></thead>
        <tbody id="deliveriesBody"></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function ensureAssignModal(){
  let modal = document.getElementById("assignModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "assignModal"; modal.className = "adm-modal";
  modal.innerHTML = `
    <div class="adm-modal__dialog">
      <div class="adm-modal__head">
        <strong>Assign Driver</strong>
        <button id="amClose" class="adm-btn adm-btn--ghost">Close</button>
      </div>
      <div class="adm-modal__body">
        <div class="adm-form-grid">
          <select id="amDriver" class="adm-select full"></select>
          <div class="adm-muted full">Or add new driver below</div>
          <input id="amNewName" class="adm-input" placeholder="Driver name" />
          <input id="amNewPhone" class="adm-input" placeholder="Phone" />
          <button id="amAddNew" class="adm-btn">Add Driver</button>
        </div>
      </div>
      <div class="adm-modal__foot">
        <button id="amAssign" class="adm-btn adm-btn--primary">Assign</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#amClose").onclick = ()=> modal.style.display = "none";
  return modal;
}

export function initDeliveries(){
  const root = ensureDeliveriesUI();
  const tbody = root.querySelector("#deliveriesBody");
  const search = root.querySelector("#delSearch");
  const statusSel = root.querySelector("#delStatus");
  const addDriverBtn = root.querySelector("#drvAddBtn");
  const state = { all: [], q:"", status:"" };

  addDriverBtn.onclick = ()=> openAssignModal(null); // just to add drivers

  onSnapshot(query(collection(db,"deliveries"), orderBy("createdAt","desc")), (snap)=>{
    state.all = []; snap.forEach(d=> state.all.push({ id:d.id, data:d.data() })); render();
  });

  const debounce = (fn,ms=250)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} };
  search.addEventListener("input", debounce(()=>{ state.q = (search.value||"").toLowerCase().trim(); render(); }));
  statusSel.onchange = ()=>{ state.status = statusSel.value; render(); };

  function render(){
    const rows = state.all.filter(({data:v})=>{
      if (state.status && v.status !== state.status) return false;
      if (!state.q) return true;
      const hay = `${v.orderId||""} ${v.driver?.name||""} ${v.driver?.phone||""}`.toLowerCase();
      return hay.includes(state.q);
    });

    tbody.innerHTML = "";
    rows.forEach(({id, data:v})=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${v.orderId}</td>
        <td>${v.driver?.name || "-"} <span class="adm-muted">${v.driver?.phone||""}</span></td>
        <td>
          <select class="adm-select dStatus" data-id="${id}">
            ${DELIVERY_STATUSES.map(s=>`<option value="${s}" ${v.status===s?"selected":""}>${s}</option>`).join("")}
          </select>
        </td>
        <td>${v.location ? `${v.location.lat.toFixed(4)}, ${v.location.lng.toFixed(4)}` : "-"}</td>
        <td>
          <button class="adm-btn dAssign" data-id="${id}">${v.driver ? "Reassign" : "Assign"}</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".dStatus").forEach(sel=>{
      sel.onchange = async e=>{
        const id = e.target.dataset.id; const val = e.target.value;
        try { await updateDeliveryStatus(id, val); } catch(err){ alert(err.message); }
      };
    });
    tbody.querySelectorAll(".dAssign").forEach(btn=>{
      btn.onclick = ()=> openAssignModal(btn.dataset.id);
    });
  }
}

/* ---------- Assign driver modal ---------- */
async function loadDriversSelect(sel){
  const snap = await getDocs(collection(db,"drivers"));
  sel.innerHTML = `<option value="">-- Select driver --</option>`;
  snap.forEach(d=>{
    const v = d.data();
    if (v.active !== false) sel.innerHTML += `<option value="${d.id}">${v.name} (${v.phone||""})</option>`;
  });
}

export async function openAssignModal(deliveryId){
  const modal = ensureAssignModal();
  const sel = modal.querySelector("#amDriver");
  await loadDriversSelect(sel);

  modal.querySelector("#amAddNew").onclick = async ()=>{
    const name = modal.querySelector("#amNewName").value.trim();
    const phone = modal.querySelector("#amNewPhone").value.trim();
    if (!name) return alert("Enter driver name");
    const ref = await addDoc(collection(db,"drivers"), { name, phone, active:true, createdAt: serverTimestamp() });
    await loadDriversSelect(sel);
    sel.value = ref.id;
  };

  modal.querySelector("#amAssign").onclick = async ()=>{
    if (!deliveryId) { modal.style.display = "none"; return; }
    const drvId = sel.value;
    if (!drvId) return alert("Select a driver or add a new one");
    const dSnap = await getDoc(doc(db,"drivers",drvId));
    const d = dSnap.data();
    await assignDriver(deliveryId, { id: drvId, name: d.name, phone: d.phone || "" });
    modal.style.display = "none";
  };

  modal.style.display = "block";
}

/* Auto-init */
(function(){ if (document.getElementById("deliveriesRoot") || document.getElementById("deliveriesBody")) initDeliveries(); })();

