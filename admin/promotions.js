// /admin/promotions.js
// Promotions Admin: Coupons (Dining|Delivery) + Banners + Link Coupon(s)
// Requires firebase.js exports { db, storage }

// promotions.js  — no self-imports, safe to include with <script type="module">
import { db } from "./firebase.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ==== DOM helpers (works even if elements are missing) ====
const el  = (id) => document.getElementById(id);
const qs  = (s, c=document) => c.querySelector(s);
const qsa = (s, c=document) => Array.from(c.querySelectorAll(s));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };

let PROMOS = []; // [{id, data}]

// ==== Render list ====
function renderList() {
  const tbody = el("promotionsBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  PROMOS.forEach(({id, data}) => {
    const typeTxt = data.type === "percent" ? `${data.value}% off` : `₹${data.value} off`;
    const chanTxt = data.channel === "dining" ? "Dining" : "Delivery";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${data.code || "—"}</td>
      <td>${chanTxt}</td>
      <td>${typeTxt}</td>
      <td>${data.kind || "coupon"}</td>
      <td>
        <button class="pr-edit" data-id="${id}">Edit</button>
        <button class="pr-delete" data-id="${id}">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  // Wire edit/delete
  qsa(".pr-delete", tbody).forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Delete this promotion?")) return;
    try { await deleteDoc(doc(db, "promotions", id)); }
    catch (e) { console.error(e); alert("Failed to delete"); }
  });

  qsa(".pr-edit", tbody).forEach(b => b.onclick = () => openEditModal(b.dataset.id));
}

// ==== Live snapshot ====
function attachSnapshot() {
  const col = collection(db, "promotions");
  // show newest first by createdAt if present
  const q = query(col, orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    PROMOS = [];
    snap.forEach(d => PROMOS.push({ id: d.id, data: d.data() || {} }));
    renderList();
  }, (err) => {
    console.error("promotions snapshot", err?.code, err?.message);
    PROMOS = []; renderList();
  });
}

// ==== Add form ====
function wireCreateForm() {
  const form = el("promotionForm");
  if (!form) return;

  const code     = el("promoCode");
  const channel  = el("promoChannel");  // "dining" | "delivery"
  const type     = el("promoType");     // "percent" | "flat"
  const valueEl  = el("promoValue");
  const kindEl   = el("promoKind");     // keep "coupon" default

  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = num(valueEl?.value);
    const payload = {
      code: (code?.value || "").trim(),
      channel: channel?.value || "delivery",
      type: type?.value || "percent",
      value: Number.isFinite(v) ? v : 0,
      kind: (kindEl?.value || "coupon"),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (!payload.value || payload.value <= 0) return alert("Enter a valid value");
    try {
      await addDoc(collection(db, "promotions"), payload);
      form.reset();
    } catch (err) {
      console.error(err);
      alert("Failed to create");
    }
  };
}

// ==== Edit modal ====
function openEditModal(id) {
  const row = PROMOS.find(p => p.id === id);
  if (!row) return alert("Not found");

  // create lightweight inline modal
  let ov = el("promoEditModal");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "promoEditModal";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:8vh;z-index:9999;";
    ov.innerHTML = `
      <div style="background:#fff;border:2px solid #111;border-radius:12px;box-shadow:6px 6px 0 #111;max-width:520px;width:min(520px,92vw);padding:16px;">
        <h3 style="margin:0 0 10px">Edit Promotion</h3>
        <form id="promoEditForm" style="display:grid;gap:8px">
          <input id="peCode" placeholder="Code (optional)"/>
          <select id="peChannel">
            <option value="dining">Dining</option>
            <option value="delivery">Delivery</option>
          </select>
          <select id="peType">
            <option value="percent">% off</option>
            <option value="flat">Flat ₹ off</option>
          </select>
          <input id="peValue" type="number" placeholder="Value"/>
          <select id="peKind">
            <option value="coupon">coupon</option>
          </select>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button type="submit">Save</button>
            <button type="button" id="peCancel">Cancel</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(ov);
    qs("#peCancel", ov).onclick = () => ov.remove();
  }

  const d = row.data || {};
  el("peCode").value = d.code || "";
  el("peChannel").value = d.channel || "delivery";
  el("peType").value = d.type || "percent";
  el("peValue").value = d.value ?? "";
  el("peKind").value = d.kind || "coupon";

  qs("#promoEditForm", ov).onsubmit = async (e) => {
    e.preventDefault();
    const v = num(el("peValue").value);
    if (!Number.isFinite(v) || v <= 0) return alert("Enter a valid value");
    try {
      await updateDoc(doc(db, "promotions", id), {
        code: (el("peCode").value || "").trim(),
        channel: el("peChannel").value || "delivery",
        type: el("peType").value || "percent",
        value: v,
        kind: el("peKind").value || "coupon",
        updatedAt: serverTimestamp(),
      });
      ov.remove();
    } catch (err) {
      console.error(err);
      alert("Failed to update");
    }
  };
}

// ==== Public init ====
export function initPromotions() {
  // wire create form, attach live list
  wireCreateForm();
  attachSnapshot();
}

// ==== Auto-init (safe): only if page provides the promotions area ====
document.addEventListener("DOMContentLoaded", () => {
  const hasUI = el("promotionForm") || el("promotionsBody");
  if (hasUI) initPromotions();
});
