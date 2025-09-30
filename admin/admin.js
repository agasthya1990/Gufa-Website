# Rewriting and saving a complete, clean admin.js for direct copy-drop replacement.
code = r"""/* =========================================================================
   admin.js — COMPLETE CLEAN REWRITE (single file, copy–paste ready)
   =========================================================================
   Features included (end-to-end, no duplicates, brace-safe):
   - Auth (login/logout) + inline status
   - Helpers: debounce, modal styles, body scroll lock, “genie” animation
   - Live Firestore snapshot for menuItems + table rendering
   - Create item flow (200x200 image resize, upload, addDoc)
   - Bulk toolbar: Bulk Edit, Bulk Delete, Bulk Promotions, Bulk Add-ons
   - Modals (animated + scroll-locked):
       * Bulk Edit (Category, Course, Type, Stock, Qty/Price, Promotions, Add-ons)
       * Bulk Promotions
       * Bulk Add-ons
       * Single-item Assign Promotions / Assign Add-ons
       * Simple Edit Item
   - Filters (Category/Course/Type) + Search + Select All
   - Safe fallbacks if optional helper modules are missing

   Assumptions:
   - You have a firebase.js that exports { auth, db, storage } initialised.
   - Optional modules (if present): ./categoryCourse.js, ./promotions.js.
     This file guards their usage so it still works if they’re absent.

   HOW TO USE:
   - Replace your existing admin.js with this file.
   - Ensure your HTML has the element IDs referenced throughout (login, table, form).
   ========================================================================= */

/* =========================
   Imports
   ========================= */
import { auth, db, storage } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* Optional utilities — guarded usage */
let CatCourse = {};
let initPromotions = null;
try {
  // If available, import dynamically so missing files don’t break the page
  const cc = await import("./categoryCourse.js");
  CatCourse = cc || {};
} catch {}
try {
  const pm = await import("./promotions.js");
  initPromotions = pm?.initPromotions || null;
} catch {}

/* =========================
   Global State & DOM refs
   ========================= */
let PROMOS_BY_ID = {};            // { promoId: {...} }
let allItems = [];                // [{id, data}]
let selectedIds = new Set();      // Set<string>

// Top-level DOM (if missing, code guards will skip)
const loginBox      = document.getElementById("loginBox");
const adminContent  = document.getElementById("adminContent");
const email         = document.getElementById("email");
const password      = document.getElementById("password");
const loginBtn      = document.getElementById("loginBtn");
const logoutBtn     = document.getElementById("logoutBtn");
const loginStatus   = document.getElementById("loginStatus");

const form          = document.getElementById("menuForm");
const statusMsg     = document.getElementById("statusMsg");
const menuBody      = document.getElementById("menuBody");

const itemName            = document.getElementById("itemName");
const itemDescription     = document.getElementById("itemDescription");
const itemImage           = document.getElementById("itemImage");
const itemPrice           = document.getElementById("itemPrice");
const halfPrice           = document.getElementById("halfPrice");
const fullPrice           = document.getElementById("fullPrice");
const qtyTypeSelect       = document.getElementById("qtyType");

const categoryDropdown    = document.getElementById("itemCategory");
const newCategoryInput    = document.getElementById("newCategoryInput");
const addCategoryBtn      = document.getElementById("addCategoryBtn");

const foodCourseDropdown  = document.getElementById("foodCourse");
const newCourseInput      = document.getElementById("newCourseInput");
const addCourseBtn        = document.getElementById("addCourseBtn");

const foodTypeSelect      = document.getElementById("foodType");

// Add-ons (create form — multi select)
const addonsSelect        = document.getElementById("addonsSelect");
const newAddonInput       = document.getElementById("newAddonInput");
const newAddonPrice       = document.getElementById("newAddonPrice");
const addAddonBtn         = document.getElementById("addAddonBtn");

// Filters/search
const searchInput         = document.getElementById("searchInput");
const filterCategory      = document.getElementById("filterCategory");
const filterCourse        = document.getElementById("filterCourse");
const filterType          = document.getElementById("filterType");

/* =========================
   Small helpers (one copy only)
   ========================= */
function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), wait);
  };
}

// Body scroll lock
function lockBodyScroll(){ document.body.classList.add("adm-lock"); }
function unlockBodyScroll(){ document.body.classList.remove("adm-lock"); }

// Modal base styles + animation (one-time)
function ensureModalStyles() {
  if (document.getElementById("admModalStyles")) return;
  const css = `
    .adm-lock { overflow: hidden !important; }
    .adm-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.55); display: none; }
    .adm-modal { background:#fff; color:#111; border-radius:14px; border:2px solid #111; box-shadow:6px 6px 0 #111;
                 max-width:720px; width:min(720px,92vw); margin:6vh auto 0; padding:16px; max-height:80vh; overflow:auto;
                 transform-origin: var(--adm-origin, 50% 0%); }
    @keyframes admGenieIn { from { opacity:0; transform: translate(var(--adm-dx,0), var(--adm-dy,0)) scale(.96); }
                            to   { opacity:1; transform: translate(0,0) scale(1);} }
    @keyframes admGenieOut{ from { opacity:1; transform: translate(0,0) scale(1); }
                            to   { opacity:0; transform: translate(var(--adm-dx,0), var(--adm-dy,0)) scale(.96);} }
    .adm-anim-in  { animation: admGenieIn 220ms ease-out both; }
    .adm-anim-out { animation: admGenieOut 180ms ease-in both; }
    .adm-btn{border:1px solid #111;border-radius:10px;padding:8px 12px;background:#fff;cursor:pointer;box-shadow:3px 3px 0 #111;}
    .adm-btn--primary{background:#111;color:#fff}
    .adm-muted{color:#666}
    .adm-pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #ddd;font-size:12px}
    .adm-pill--dining{background:#f3fff3;border-color:#bde0bd}
    .adm-pill--delivery{background:#f3f7ff;border-color:#bed2ff}
    .adm-toolbar{display:flex;gap:8px;align-items:center;margin:8px 0}
    .adm-toolbar button{min-width:140px}
    .adm-field{display:grid;gap:6px;margin:6px 0}
    .adm-grid{display:grid;gap:10px}
  `;
  const style = document.createElement("style");
  style.id = "admModalStyles";
  style.textContent = css;
  document.head.appendChild(style);
}

// Optional “genie” origin from button
function setGenieFrom(triggerEl, overlayEl, modalEl) {
  try {
    if (!triggerEl || !overlayEl || !modalEl) return;
    const r = triggerEl.getBoundingClientRect();
    const cx = r.left + r.width/2;
    const vw = Math.max(1, window.innerWidth);
    modalEl.style.setProperty("--adm-origin", `${(cx / vw) * 100}% 0%`);
    modalEl.style.setProperty("--adm-dx", "0px");
    modalEl.style.setProperty("--adm-dy", "6px");
  } catch {}
}

/* Hidden value helpers for native <select> */
function setHiddenValue(selectEl, val) {
  if (!selectEl) return;
  if (val && ![...selectEl.options].some(o => o.value === val)) {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = val;
    selectEl.appendChild(opt);
  }
  selectEl.value = val || "";
  selectEl.dispatchEvent(new Event("change"));
}
function setMultiHiddenValue(selectEl, values = []) {
  if (!selectEl) return;
  const set = new Set(values);
  [...selectEl.options].forEach(o => { o.selected = set.has(o.value); });
  selectEl.dispatchEvent(new Event("change"));
}

/* =========================
   Auth
   ========================= */
if (loginBtn) {
  loginBtn.type = "button";
  loginBtn.onclick = (e) => {
    e?.preventDefault?.();
    const em = (email?.value || "").trim();
    const pw = (password?.value || "");
    if (!em || !pw) { alert("Please enter both email and password."); return; }

    const old = loginBtn.textContent;
    loginBtn.disabled = true; loginBtn.setAttribute("aria-busy","true"); loginBtn.textContent = "Signing in…";
    if (loginStatus) loginStatus.textContent = `Attempting login for ${em}…`;

    signInWithEmailAndPassword(auth, em, pw)
      .then(() => {
        if (loginStatus) loginStatus.textContent = "Login successful.";
        email && (email.value = ""); password && (password.value = "");
      })
      .catch(err => {
        const msg = `Login failed: ${err?.code || ""} ${err?.message || ""}`.trim();
        if (loginStatus) loginStatus.textContent = msg; alert(msg);
      })
      .finally(() => {
        loginBtn.disabled = false; loginBtn.removeAttribute("aria-busy"); loginBtn.textContent = old;
      });
  };
}
if (logoutBtn) logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    loginBox && (loginBox.style.display = "none");
    adminContent && (adminContent.style.display = "block");

    // Load dropdown masters (guarded if file not present)
    try { await CatCourse.loadCategories?.(categoryDropdown); } catch {}
    try { await CatCourse.loadCourses?.(foodCourseDropdown); } catch {}
    try { await CatCourse.loadAddons?.(addonsSelect); } catch {}

    // Render filters if present
    await populateFilterDropdowns();
    wireSearchAndFilters();

    // Attach primary snapshot
    attachSnapshot();

    // Live promotions map → coupon chips
    onSnapshot(
      collection(db, "promotions"),
      (snap) => {
        const map = {};
        snap.forEach((d) => {
          const p = d.data();
          if (p?.kind === "coupon") map[d.id] = p;
        });
        PROMOS_BY_ID = map; renderTable();
      },
      (err) => { console.error("promotions snapshot error", err?.code, err?.message); PROMOS_BY_ID = {}; renderTable(); }
    );

    // Optional promotions UI init
    try { initPromotions?.(); } catch (e) { console.warn("initPromotions skipped:", e?.message || e); }
  } else {
    loginBox && (loginBox.style.display = "block");
    adminContent && (adminContent.style.display = "none");
  }
});

/* =========================
   Pricing toggle (create form)
   ========================= */
if (qtyTypeSelect) {
  qtyTypeSelect.onchange = () => {
    const value = qtyTypeSelect.value;
    itemPrice && (itemPrice.style.display = value === "Not Applicable" ? "block" : "none");
    const showHF = value === "Half & Full";
    halfPrice && (halfPrice.style.display = showHF ? "block" : "none");
    fullPrice && (fullPrice.style.display = showHF ? "block" : "none");
  };
}

/* =========================
   Add Category/Course/Add-on (create form)
   ========================= */
if (addCategoryBtn) addCategoryBtn.onclick = async () => {
  try { await CatCourse.addCategory?.(newCategoryInput, () => CatCourse.loadCategories?.(categoryDropdown)); }
  catch (e) { alert(e?.message || e); }
  await populateFilterDropdowns();
};
if (addCourseBtn) addCourseBtn.onclick = async () => {
  try { await CatCourse.addCourse?.(newCourseInput, () => CatCourse.loadCourses?.(foodCourseDropdown)); }
  catch (e) { alert(e?.message || e); }
  await populateFilterDropdowns();
};
if (addAddonBtn) addAddonBtn.onclick = async () => {
  try { await CatCourse.addAddon?.(newAddonInput, newAddonPrice, () => CatCourse.loadAddons?.(addonsSelect)); }
  catch (e) { alert(e?.message || e); }
};

/* =========================
   Image resize (200x200 JPEG)
   ========================= */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 200; canvas.height = 200;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 200, 200);
        canvas.toBlob(resolve, "image/jpeg", 0.8);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* =========================
   Create item
   ========================= */
if (form) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    statusMsg && (statusMsg.innerText = "Adding…");

    const name        = (itemName?.value || "").trim();
    const description = (itemDescription?.value || "").trim();
    const category    = categoryDropdown?.value;
    const foodCourse  = foodCourseDropdown?.value;
    const foodType    = foodTypeSelect?.value;
    const qtyTypeVal  = qtyTypeSelect?.value;
    const imageFile   = itemImage?.files?.[0];

    const addonNames  = Array.from(addonsSelect?.selectedOptions || []).map(o => o.value);
    const addons = await Promise.all(addonNames.map(async (nm) => {
      const snap = await getDoc(doc(db, "menuAddons", nm));
      const v = snap.exists() ? snap.data() : { name: nm, price: 0 };
      return { name: v.name || nm, price: Number(v.price || 0) };
    }));

    if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeVal || !imageFile) {
      statusMsg && (statusMsg.innerText = "❌ Fill all fields"); return;
    }

    let qtyType = {};
    if (qtyTypeVal === "Not Applicable") {
      const price = parseFloat(itemPrice?.value);
      if (isNaN(price) || price <= 0) { statusMsg && (statusMsg.innerText = "❌ Invalid price"); return; }
      qtyType = { type: qtyTypeVal, itemPrice: price };
    } else if (qtyTypeVal === "Half & Full") {
      const half = parseFloat(halfPrice?.value), full = parseFloat(fullPrice?.value);
      if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) {
        statusMsg && (statusMsg.innerText = "❌ Invalid Half/Full price"); return;
      }
      qtyType = { type: qtyTypeVal, halfPrice: half, fullPrice: full };
    }

    try {
      const resizedBlob = await resizeImage(imageFile);
      const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);
      await uploadBytes(imageRef, resizedBlob);
      const imageUrl = await getDownloadURL(imageRef);

      await addDoc(collection(db, "menuItems"), {
        name, description, category, foodCourse, foodType, qtyType, addons, imageUrl,
        inStock: true, createdAt: serverTimestamp(),
      });

      form.reset();
      qtyTypeSelect?.dispatchEvent(new Event("change"));
      setMultiHiddenValue(addonsSelect, []);
      statusMsg && (statusMsg.innerText = "✅ Added!");
    } catch (err) {
      console.error(err);
      statusMsg && (statusMsg.innerText = "❌ Error: " + (err?.message || err));
    }
  };
}

/* =========================
   Live snapshot + render
   ========================= */
function attachSnapshot() {
  onSnapshot(
    collection(db, "menuItems"),
    (snapshot) => {
      allItems = [];
      snapshot.forEach((docSnap) => allItems.push({ id: docSnap.id, data: docSnap.data() }));
      ensureSelectAllHeader();
      renderTable();
      updateBulkBar();
    },
    (err) => {
      console.error("menuItems snapshot error", err?.code, err?.message);
      allItems = [];
      ensureSelectAllHeader();
      renderTable();
      updateBulkBar();
    }
  );
}

function ensureSelectAllHeader() {
  const thead = document.querySelector("#menuTable thead tr");
  if (!thead) return;
  if (!thead.querySelector("#selectAll")) {
    const th = document.createElement("th");
    th.innerHTML = `<input type="checkbox" id="selectAll" title="Select all" />`;
    thead.insertBefore(th, thead.firstElementChild);
    const allCb = document.getElementById("selectAll");
    if (allCb) allCb.onchange = (e) => {
      const checked = e.target.checked;
      if (checked) selectedIds = new Set(allItems.map((i) => i.id)); else selectedIds.clear();
      renderTable(); updateBulkBar();
    };
  }
}

function applyFilters(items) {
  const q = (searchInput?.value || "").toLowerCase().trim();
  const cat = filterCategory?.value || "";
  const crs = filterCourse?.value || "";
  const typ = filterType?.value || "";
  return items.filter(({ data: d }) => {
    const byQ = !q || (d.name || "").toLowerCase().includes(q) || (d.description || "").toLowerCase().includes(q);
    const byC = !cat || d.category === cat;
    const byR = !crs || d.foodCourse === crs;
    const byT = !typ || d.foodType === typ;
    return byQ && byC && byR && byT;
  });
}

function renderTable() {
  if (!menuBody) return;
  menuBody.innerHTML = "";
  const items = applyFilters(allItems);

  items.forEach(({ id, data: d }) => {
    const qty = d.qtyType || {};
    const priceText =
      qty.type === "Half & Full" ? `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}` : `₹${qty.itemPrice}`;

    const addonsText = Array.isArray(d.addons)
      ? d.addons.map(a => (typeof a === "string" ? a : `${a.name} (₹${a.price})`)).join(", ")
      : "";

    const promoIds = Array.isArray(d.promotions) ? d.promotions : [];
    const promoChips = promoIds.map((pid) => {
      const info = PROMOS_BY_ID[pid]; if (!info) return `<span class="adm-pill">${pid.slice(0,5)}…</span>`;
      const pillClass = info.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery";
      const code = info.code || pid; const title = info.type === "percent" ? `${info.value}% off` : `₹${info.value} off`;
      return `<span class="adm-pill ${pillClass}" title="${title}">${code}</span>`;
    }).join(" ");

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="rowSelect" data-id="${id}" ${selectedIds.has(id) ? "checked" : ""}></td>
      <td>${d.name}</td>
      <td>${d.description}</td>
      <td>${d.category || ""}</td>
      <td>${d.foodCourse || ""}</td>
      <td>${d.foodType || ""}</td>
      <td>${qty.type || ""}</td>
      <td>${priceText || ""}</td>
      <td>${addonsText || '<span class="adm-muted">—</span>'}</td>
      <td>${promoChips || '<span class="adm-muted">—</span>'}</td>
      <td><img src="${d.imageUrl}" width="50" height="50" style="object-fit:cover;border-radius:6px;border:1px solid #eee"/></td>
      <td>
        <select class="stockToggle" data-id="${id}">
          <option value="true" ${d.inStock ? "selected" : ""}>In Stock</option>
          <option value="false" ${!d.inStock ? "selected" : ""}>Out of Stock</option>
        </select>
      </td>
      <td>
        <button class="promoBtn" data-id="${id}">Promotions</button>
        <button class="addonBtn" data-id="${id}">Add-On</button>
        <button class="editBtn" data-id="${id}">Edit</button>
        <button class="deleteBtn" data-id="${id}">Delete</button>
      </td>
    `;
    menuBody.appendChild(row);
  });

  // Row select
  document.querySelectorAll(".rowSelect").forEach((cb) => {
    cb.onchange = (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkBar();
      syncSelectAllHeader(items);
    };
  });

  // Stock toggle
  document.querySelectorAll(".stockToggle").forEach((el) => {
    el.onchange = async (e) => {
      const id = e.target.dataset.id; const val = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", id), { inStock: val });
    };
  });

  // Delete
  document.querySelectorAll(".deleteBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      if (confirm("Delete this item?")) {
        await deleteDoc(doc(db, "menuItems", id));
        selectedIds.delete(id);
        updateBulkBar();
      }
    };
  });

  // Edit
  document.querySelectorAll(".editBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      const snap = await getDoc(doc(db, "menuItems", id));
      if (!snap.exists()) return alert("Item not found!");
      openEditItemModal(id, snap.data());
    };
  });

  // Assign Add-ons
  document.querySelectorAll(".addonBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id; const snap = await getDoc(doc(db, "menuItems", id));
      if (!snap.exists()) return alert("Item not found!");
      openAssignAddonsModal(id, Array.isArray(snap.data().addons) ? snap.data().addons : []);
    };
  });

  // Assign Promotions
  document.querySelectorAll(".promoBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id; const snap = await getDoc(doc(db, "menuItems", id));
      if (!snap.exists()) return alert("Item not found!");
      openAssignPromotionsModal(id, Array.isArray(snap.data().promotions) ? snap.data().promotions : []);
    };
  });

  syncSelectAllHeader(items);
}

function syncSelectAllHeader(itemsRendered) {
  const cb = document.getElementById("selectAll");
  if (!cb) return;
  if (!itemsRendered.length) { cb.checked = false; cb.indeterminate = false; return; }
  const total = itemsRendered.length;
  let selected = 0;
  for (const { id } of itemsRendered) if (selectedIds.has(id)) selected++;
  cb.checked = selected === total;
  cb.indeterminate = selected > 0 && selected < total;
}

/* =========================
   Bulk bar (four buttons)
   ========================= */
function ensureBulkBar() {
  if (document.getElementById("bulkBar")) return;
  const bar = document.createElement("div");
  bar.id = "bulkBar";
  bar.className = "adm-toolbar";
  bar.innerHTML = `
    <button id="bulkEditBtn" type="button" disabled>Edit Selected (0)</button>
    <button id="bulkDeleteBtn" type="button" disabled>Delete Selected (0)</button>
    <button id="bulkPromosBulkBtn" type="button" disabled>Bulk Promotions</button>
    <button id="bulkAddonsBulkBtn" type="button" disabled>Bulk Add-ons</button>
  `;
  const table = document.getElementById("menuTable");
  if (table && table.parentNode) table.parentNode.insertBefore(bar, table);

  const bulkEditBtn = document.getElementById("bulkEditBtn");
  const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
  const bulkPromosBulkBtn = document.getElementById("bulkPromosBulkBtn");
  const bulkAddonsBulkBtn = document.getElementById("bulkAddonsBulkBtn");

  if (bulkEditBtn) bulkEditBtn.onclick = (e) => {
    e?.preventDefault?.();
    if (!selectedIds.size) return alert("Select at least one item.");
    openBulkEditModal(e?.currentTarget || e?.target || null);
  };
  if (bulkDeleteBtn) bulkDeleteBtn.onclick = async (e) => {
    e?.preventDefault?.();
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} item(s)?`)) return;
    const ops = [];
    selectedIds.forEach((id) => ops.push(deleteDoc(doc(db, "menuItems", id))));
    await Promise.all(ops);
    selectedIds.clear();
    updateBulkBar();
  };
  if (bulkPromosBulkBtn) bulkPromosBulkBtn.onclick = (e) => {
    e?.preventDefault?.();
    if (!selectedIds.size) return alert("Select at least one item.");
    openBulkPromosModal(e?.currentTarget || e?.target || null);
  };
  if (bulkAddonsBulkBtn) bulkAddonsBulkBtn.onclick = (e) => {
    e?.preventDefault?.();
    if (!selectedIds.size) return alert("Select at least one item.");
    openBulkAddonsModal(e?.currentTarget || e?.target || null);
  };
}

function updateBulkBar() {
  ensureBulkBar();
  const n = selectedIds.size;
  const editBtn   = document.getElementById("bulkEditBtn");
  const delBtn    = document.getElementById("bulkDeleteBtn");
  const promosBtn = document.getElementById("bulkPromosBulkBtn");
  const addonsBtn = document.getElementById("bulkAddonsBulkBtn");
  if (editBtn)   { editBtn.textContent = `Edit Selected (${n})`;   editBtn.disabled = n === 0; }
  if (delBtn)    { delBtn.textContent  = `Delete Selected (${n})`; delBtn.disabled  = n === 0; }
  if (promosBtn) { promosBtn.disabled  = n === 0; }
  if (addonsBtn) { addonsBtn.disabled  = n === 0; }
}

/* =========================
   Bulk Modals (genie + scroll lock)
   ========================= */
function closeOverlay(ov) {
  const box = ov.querySelector(".adm-modal");
  if (box) { box.classList.remove("adm-anim-in"); box.classList.add("adm-anim-out"); }
  setTimeout(() => { ov.style.display = "none"; unlockBodyScroll(); }, 180);
}

// Bulk Promotions
async function openBulkPromosModal(triggerEl) {
  ensureModalStyles();
  let ov = document.getElementById("bulkPromosModal");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "bulkPromosModal"; ov.className = "adm-overlay";
    ov.innerHTML = `
      <div class="adm-modal">
        <h3 style="margin:0 0 10px">Bulk Promotions (<span id="bpCount">0</span> items)</h3>
        <label style="display:flex; align-items:center; gap:6px; margin:8px 0 6px;">
          <input type="checkbox" id="bpClear"/> <span>Clear promotions</span>
        </label>
        <select id="bpSelect" multiple size="8" style="width:100%;"></select>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button id="bpApply" class="adm-btn adm-btn--primary">Apply</button>
          <button id="bpCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#bpCancel").onclick = () => closeOverlay(ov);
    ov.querySelector("#bpApply").onclick = async () => {
      if (!selectedIds.size) { alert("No items selected."); return; }
      const clear = ov.querySelector("#bpClear").checked;
      const sel = ov.querySelector("#bpSelect");
      const ids = clear ? [] : [...sel.selectedOptions].map(o=>o.value).filter(Boolean);
      try {
        ov.querySelector("#bpApply").disabled = true;
        const ops = []; selectedIds.forEach((id)=> ops.push(updateDoc(doc(db,"menuItems",id), { promotions: ids })));
        await Promise.all(ops);
        closeOverlay(ov);
      } catch(e){ console.error(e); alert("Failed to update promotions: " + (e?.message || e)); }
      finally { ov.querySelector("#bpApply").disabled = false; }
    };
  }

  // Load options
  const sel = ov.querySelector("#bpSelect"); sel.innerHTML = "";
  const snap = await getDocs(collection(db,"promotions"));
  const rows = [];
  snap.forEach(d => {
    const p = d.data();
    if (p?.kind === "coupon") {
      const typeTxt = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
      const chan = p.channel === "dining" ? "Dining" : "Delivery";
      rows.push({ id: d.id, label: `${p.code || "(no code)"} • ${chan} • ${typeTxt}` });
    }
  });
  if (!rows.length) sel.innerHTML = `<option value="">(No promotions found)</option>`;
  rows.forEach(r => { const o=document.createElement("option"); o.value=r.id; o.textContent=r.label; sel.appendChild(o); });
  ov.querySelector("#bpCount").textContent = String(selectedIds.size);

  lockBodyScroll();
  ov.style.display = "block";
  setGenieFrom(triggerEl, ov, ov.querySelector(".adm-modal"));
  const box = ov.querySelector(".adm-modal"); box.classList.remove("adm-anim-out"); box.classList.add("adm-anim-in");
}

// Bulk Add-ons
async function openBulkAddonsModal(triggerEl) {
  ensureModalStyles();
  let ov = document.getElementById("bulkAddonsModal");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "bulkAddonsModal"; ov.className = "adm-overlay";
    ov.innerHTML = `
      <div class="adm-modal">
        <h3 style="margin:0 0 10px">Bulk Add-ons (<span id="baCount">0</span> items)</h3>
        <label style="display:flex; align-items:center; gap:6px; margin:8px 0 6px;">
          <input type="checkbox" id="baClear"/> <span>Clear add-ons</span>
        </label>
        <div id="baList" style="max-height:48vh; overflow:auto; border:1px solid #eee; border-radius:8px; padding:8px;"></div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button id="baApply" class="adm-btn adm-btn--primary">Apply</button>
          <button id="baCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#baCancel").onclick = () => closeOverlay(ov);
    ov.querySelector("#baApply").onclick = async () => {
      if (!selectedIds.size) { alert("No items selected."); return; }
      const clear = ov.querySelector("#baClear").checked;
      const chosen = clear ? [] : [...ov.querySelectorAll('.ba-row input[type="checkbox"]:checked')]
        .map(i => ({ name: i.value, price: Number(i.dataset.price || 0) }));
      try {
        ov.querySelector("#baApply").disabled = true;
        const ops = []; selectedIds.forEach((id)=> ops.push(updateDoc(doc(db,"menuItems",id), { addons: chosen })));
        await Promise.all(ops);
        closeOverlay(ov);
      } catch(e){ console.error(e); alert("Failed to update add-ons: " + (e?.message || e)); }
      finally { ov.querySelector("#baApply").disabled = false; }
    };
  }

  // Load add-ons
  const list = ov.querySelector("#baList"); list.innerHTML = "";
  const snap = await getDocs(collection(db, "menuAddons"));
  const rows = [];
  snap.forEach(d => { const v = d.data() || {}; rows.push({ name: v.name || d.id, price: Number(v.price || 0) }); });
  if (!rows.length) list.innerHTML = `<div class="adm-muted">(No add-ons found)</div>`;
  rows.forEach(a => {
    const row = document.createElement("label");
    row.className = "ba-row";
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 4px;";
    row.innerHTML = `<input type="checkbox" value="${a.name}" data-price="${a.price}"/><span>${a.name} (₹${a.price})</span>`;
    list.appendChild(row);
  });
  ov.querySelector("#baCount").textContent = String(selectedIds.size);

  lockBodyScroll();
  ov.style.display = "block";
  setGenieFrom(triggerEl, ov, ov.querySelector(".adm-modal"));
  const box = ov.querySelector(".adm-modal"); box.classList.remove("adm-anim-out"); box.classList.add("adm-anim-in");
}

// Bulk Edit (multi-field)
function openBulkEditModal(triggerEl) {
  ensureModalStyles();
  let ov = document.getElementById("bulkEditModal");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "bulkEditModal"; ov.className = "adm-overlay";
    ov.innerHTML = `
      <div class="adm-modal">
        <h3 style="margin:0 0 10px">Bulk Edit (<span id="bulkCount">0</span> items)</h3>
        <form id="bulkForm">
          <div class="adm-grid">
            <div class="adm-field">
              <label><input type="checkbox" id="bulkCatEnable"/> Category</label>
              <select id="bulkCategory" disabled><option value="">-- Select Category --</option></select>
            </div>

            <div class="adm-field">
              <label><input type="checkbox" id="bulkCourseEnable"/> Food Course</label>
              <select id="bulkCourse" disabled><option value="">-- Select Food Course --</option></select>
            </div>

            <div class="adm-field">
              <label><input type="checkbox" id="bulkTypeEnable"/> Food Type</label>
              <select id="bulkType" disabled>
                <option value="">-- Select Type --</option>
                <option value="Veg">Veg</option>
                <option value="Non-Veg">Non-Veg</option>
              </select>
            </div>

            <div class="adm-field">
              <label><input type="checkbox" id="bulkStockEnable"/> Stock Status</label>
              <select id="bulkStock" disabled>
                <option value="">-- Select Stock --</option>
                <option value="true">In Stock</option>
                <option value="false">Out of Stock</option>
              </select>
            </div>

            <div class="adm-field">
              <label><input type="checkbox" id="bulkQtyEnable"/> Quantity & Price</label>
              <select id="bulkQtyType" disabled>
                <option value="">-- Select Qty Type --</option>
                <option value="Not Applicable">Not Applicable</option>
                <option value="Half & Full">Half & Full</option>
              </select>
              <input type="number" id="bulkItemPrice" placeholder="Price" style="display:none;" disabled />
              <div id="bulkHFWrap" style="display:none; gap:8px;">
                <input type="number" id="bulkHalfPrice" placeholder="Half Price" disabled />
                <input type="number" id="bulkFullPrice" placeholder="Full Price" disabled />
              </div>
            </div>

            <div style="border-top:1px dashed #ddd; padding-top:12px;" class="adm-grid">
              <div class="adm-field">
                <label><input type="checkbox" id="bulkPromosEnable"/> Promotions</label>
                <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" id="bulkClearPromos" disabled/><span>Clear promotions</span></label>
                <select id="bulkPromosSelect" multiple size="6" disabled><option value="">-- Select Promotion(s) --</option></select>
                <small class="adm-muted">Tip: hold Ctrl/⌘ to select multiple</small>
              </div>
              <div class="adm-field">
                <label><input type="checkbox" id="bulkAddonsEnable"/> Add-ons</label>
                <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" id="bulkClearAddons" disabled/><span>Clear add-ons</span></label>
                <select id="bulkAddonsSelect" multiple size="6" disabled><option value="">-- Select Add-on(s) --</option></select>
                <small class="adm-muted">Tip: hold Ctrl/⌘ to select multiple</small>
              </div>
            </div>
          </div>
          <div style="margin-top:14px; display:flex; gap:8px; justify-content:flex-end;">
            <button type="submit" id="bulkApplyBtn" class="adm-btn adm-btn--primary">Apply</button>
            <button type="button" id="bulkCancelBtn" class="adm-btn">Cancel</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(ov);

    // Wire close
    ov.querySelector("#bulkCancelBtn").onclick = () => closeOverlay(ov);

    // Refs
    const bulkCategory  = ov.querySelector("#bulkCategory");
    const bulkCourse    = ov.querySelector("#bulkCourse");
    const bulkType      = ov.querySelector("#bulkType");
    const bulkStock     = ov.querySelector("#bulkStock");
    const bulkQtyType   = ov.querySelector("#bulkQtyType");
    const bulkItemPrice = ov.querySelector("#bulkItemPrice");
    const bulkHFWrap    = ov.querySelector("#bulkHFWrap");
    const bulkHalfPrice = ov.querySelector("#bulkHalfPrice");
    const bulkFullPrice = ov.querySelector("#bulkFullPrice");

    const bulkCatEnable    = ov.querySelector("#bulkCatEnable");
    const bulkCourseEnable = ov.querySelector("#bulkCourseEnable");
    const bulkTypeEnable   = ov.querySelector("#bulkTypeEnable");
    const bulkStockEnable  = ov.querySelector("#bulkStockEnable");
    const bulkQtyEnable    = ov.querySelector("#bulkQtyEnable");

    // Toggles
    bulkCatEnable.onchange    = () => { bulkCategory.disabled = !bulkCatEnable.checked; };
    bulkCourseEnable.onchange = () => { bulkCourse.disabled   = !bulkCourseEnable.checked; };
    bulkTypeEnable.onchange   = () => { bulkType.disabled     = !bulkTypeEnable.checked; };
    bulkStockEnable.onchange  = () => { bulkStock.disabled    = !bulkStockEnable.checked; };
    bulkQtyEnable.onchange    = () => { const on = bulkQtyEnable.checked; bulkQtyType.disabled = !on; toggleBulkQtyInputs(); };

    function toggleBulkQtyInputs() {
      const vt = bulkQtyType.value; const on = bulkQtyEnable.checked;
      const showSingle = on && vt === "Not Applicable";
      const showHF = on && vt === "Half & Full";
      bulkItemPrice.style.display = showSingle ? "block" : "none";
      bulkHFWrap.style.display = showHF ? "grid" : "none";
      bulkItemPrice.disabled = !showSingle; bulkHalfPrice.disabled = !showHF; bulkFullPrice.disabled = !showHF;
    }
    bulkQtyType.onchange = toggleBulkQtyInputs;

    // Promotions/Add-ons selectors
    const promosEnable = ov.querySelector("#bulkPromosEnable");
    const promosClear  = ov.querySelector("#bulkClearPromos");
    const promosSelect = ov.querySelector("#bulkPromosSelect");
    const addonsEnable = ov.querySelector("#bulkAddonsEnable");
    const addonsClear  = ov.querySelector("#bulkClearAddons");
    const addonsSelect = ov.querySelector("#bulkAddonsSelect");

    async function loadPromotionsOptions() {
      promosSelect.innerHTML = `<option value="">-- Select Promotion(s) --</option>`;
      const snap = await getDocs(collection(db, "promotions"));
      const rows = [];
      snap.forEach(d=>{
        const p = d.data();
        if (p?.kind==="coupon"){
          const typeTxt = p.type==="percent" ? `${p.value}% off` : `₹${p.value} off`;
          const chan = p.channel==="dining" ? "Dining" : "Delivery";
          rows.push({ id:d.id, label:`${p.code || "(no code)"} • ${chan} • ${typeTxt}` });
        }
      });
      rows.forEach(r=>{ const o=document.createElement("option"); o.value=r.id; o.textContent=r.label; promosSelect.appendChild(o); });
    }
    async function loadAddonsOptions() {
      addonsSelect.innerHTML = `<option value="">-- Select Add-on(s) --</option>`;
      const snap = await getDocs(collection(db,"menuAddons"));
      const rows = [];
      snap.forEach(d=>{ const v=d.data()||{}; const name=v.name||d.id; const price=Number(v.price||0); rows.push({ name, price }); });
      rows.forEach(a=>{ const o=document.createElement("option"); o.value=a.name; o.textContent=`${a.name} (₹${a.price})`; o.dataset.price=String(a.price); addonsSelect.appendChild(o); });
    }

    function togglePromosInputs(){ const on = !!promosEnable.checked; promosSelect.disabled = !on; promosClear.disabled = !on; if (on) loadPromotionsOptions().catch(console.error); }
    function toggleAddonsInputs(){ const on = !!addonsEnable.checked; addonsSelect.disabled = !on; addonsClear.disabled = !on; if (on) loadAddonsOptions().catch(console.error); }

    promosEnable.onchange = togglePromosInputs; addonsEnable.onchange = toggleAddonsInputs; togglePromosInputs(); toggleAddonsInputs();

    // Submit
    ov.querySelector("#bulkForm").onsubmit = async (e) => {
      e.preventDefault(); if (!selectedIds.size) { alert("No items selected."); return; }
      const updates = {};
      if (bulkCatEnable.checked)      { if (!bulkCategory.value) return alert("Select a Category.");     updates.category   = bulkCategory.value; }
      if (bulkCourseEnable.checked)   { if (!bulkCourse.value)   return alert("Select a Course.");       updates.foodCourse = bulkCourse.value; }
      if (bulkTypeEnable.checked)     { if (!bulkType.value)     return alert("Select a Food Type.");    updates.foodType   = bulkType.value; }
      if (bulkStockEnable.checked)    { if (!bulkStock.value)    return alert("Select Stock Status.");   updates.inStock    = (bulkStock.value === "true"); }
      if (bulkQtyEnable.checked) {
        const vt = bulkQtyType.value; if (!vt) return alert("Select Qty Type.");
        if (vt === "Not Applicable") {
          const p = parseFloat(bulkItemPrice.value);
          if (isNaN(p)||p<=0) return alert("Enter valid Price.");
          updates.qtyType = { type: vt, itemPrice: p };
        } else if (vt === "Half & Full") {
          const h = parseFloat(bulkHalfPrice.value);
          const f = parseFloat(bulkFullPrice.value);
          if (isNaN(h)||isNaN(f)||h<=0||f<=0) return alert("Enter valid Half/Full prices.");
          updates.qtyType = { type: vt, halfPrice: h, fullPrice: f };
        }
      }
      if (promosEnable.checked) {
        if (promosClear.checked) updates.promotions = [];
        else {
          const ids = [...promosSelect.selectedOptions].map(o=>o.value).filter(Boolean);
          updates.promotions = ids;
        }
      }
      if (addonsEnable.checked) {
        if (addonsClear.checked) updates.addons = [];
        else {
          const chosen = [...addonsSelect.selectedOptions].map(o=>({ name:o.value, price:Number(o.dataset.price||0) })).filter(a=>a.name);
          updates.addons = chosen;
        }
      }
      if (!Object.keys(updates).length) return alert("Tick at least one field to update.");

      try {
        ov.querySelector("#bulkApplyBtn").disabled = true;
        const ops = []; selectedIds.forEach((id)=> ops.push(updateDoc(doc(db,"menuItems",id), updates)));
        await Promise.all(ops);
        closeOverlay(ov);
      } catch(err){ console.error(err); alert("Bulk update failed: " + (err?.message || err)); }
      finally { ov.querySelector("#bulkApplyBtn").disabled = false; }
    };

    // Store for quick re-open
    ov._refs = { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQtyInputs };
  }

  // Refresh on open
  ov.querySelector("#bulkCount").textContent = String(selectedIds.size);
  const { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQtyInputs } = ov._refs;
  try { await CatCourse.loadCategories?.(bulkCategory); } catch {}
  try { await CatCourse.loadCourses?.(bulkCourse); } catch {}
  bulkType.value = ""; bulkQtyType.value = ""; toggleBulkQtyInputs();

  ov.querySelector("#bulkCatEnable").checked = false;
  ov.querySelector("#bulkCourseEnable").checked = false;
  ov.querySelector("#bulkTypeEnable").checked = false;
  ov.querySelector("#bulkStockEnable").checked = false;
  ov.querySelector("#bulkQtyEnable").checked = false;

  bulkCategory.disabled = true; bulkCourse.disabled = true; bulkType.disabled = true; ov.querySelector("#bulkStock").disabled = true; bulkQtyType.disabled = true;

  // Reset promos/addons region
  const promosEnable = ov.querySelector("#bulkPromosEnable"); const promosClear = ov.querySelector("#bulkClearPromos"); const promosSelect = ov.querySelector("#bulkPromosSelect");
  const addonsEnable = ov.querySelector("#bulkAddonsEnable"); const addonsClear = ov.querySelector("#bulkClearAddons"); const addonsSelect = ov.querySelector("#bulkAddonsSelect");
  promosEnable.checked = false; addonsEnable.checked = false; promosClear.checked = false; addonsClear.checked = false;
  promosSelect.innerHTML = `<option value="">-- Select Promotion(s) --</option>`; promosSelect.disabled = true;
  addonsSelect.innerHTML = `<option value="">-- Select Add-on(s) --</option>`;   addonsSelect.disabled = true;

  lockBodyScroll();
  ov.style.display = "block";
  setGenieFrom(triggerEl, ov, ov.querySelector(".adm-modal"));
  const box = ov.querySelector(".adm-modal"); box.classList.remove("adm-anim-out"); box.classList.add("adm-anim-in");
}

/* =========================
   Single-item assign modals
   ========================= */
function openAssignAddonsModal(itemId, current) {
  ensureModalStyles();
  let ov = document.getElementById("addonAssignModal");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "addonAssignModal"; ov.className = "adm-overlay";
    ov.innerHTML = `
      <div class="adm-modal" style="max-width:520px;">
        <h3 style="margin-top:0">Assign Add-ons</h3>
        <div id="assignAddonList" style="max-height:300px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px;"></div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button id="assignAddonSave" class="adm-btn adm-btn--primary">Save</button>
          <button id="assignAddonCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#assignAddonCancel").onclick = () => closeOverlay(ov);
  }

  (async () => {
    const list = ov.querySelector("#assignAddonList");
    let addons = [];
    try {
      addons = await CatCourse.fetchAddons?.() || [];
      if (!addons.length) {
        const snap = await getDocs(collection(db, "menuAddons"));
        snap.forEach(d => { const v=d.data()||{}; addons.push({ name:v.name||d.id, price:Number(v.price||0) }); });
      }
    } catch {
      const snap = await getDocs(collection(db, "menuAddons"));
      snap.forEach(d => { const v=d.data()||{}; addons.push({ name:v.name||d.id, price:Number(v.price||0) }); });
    }

    const cur = new Set((current || []).map(a => typeof a === "string" ? a : a.name));
    list.innerHTML = addons.map(a =>
      `<label style="display:flex; align-items:center; gap:8px; padding:6px 4px;">
        <input type="checkbox" value="${a.name}" ${cur.has(a.name) ? "checked" : ""} />
        <span>${a.name} (₹${a.price})</span>
      </label>`
    ).join("");

    ov.querySelector("#assignAddonSave").onclick = async () => {
      const chosen = addons.filter(a => list.querySelector(\`input[value="${a.name}"]\`)?.checked)
                           .map(a => ({ name: a.name, price: a.price }));
      try { await updateDoc(doc(db, "menuItems", itemId), { addons: chosen }); closeOverlay(ov); }
      catch (err) { console.error(err); alert("Failed to assign add-ons: " + (err?.message || err)); }
    };

    lockBodyScroll();
    ov.style.display = "block";
    const box = ov.querySelector(".adm-modal"); box.classList.remove("adm-anim-out"); box.classList.add("adm-anim-in");
  })();
}

async function openAssignPromotionsModal(itemId, currentIds) {
  ensureModalStyles();
  let ov = document.getElementById("promoAssignModal");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "promoAssignModal"; ov.className = "adm-overlay";
    ov.innerHTML = `
      <div class="adm-modal" style="max-width:520px;">
        <h3 style="margin-top:0">Assign Promotions</h3>
        <label style="display:flex; align-items:center; gap:6px; margin:8px 0 6px;">
          <input type="checkbox" id="ppClear"/> <span>Clear promotions</span>
        </label>
        <select id="ppSelect" multiple size="8" style="width:100%;"></select>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button id="ppSave" class="adm-btn adm-btn--primary">Save</button>
          <button id="ppCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#ppCancel").onclick = () => closeOverlay(ov);
  }

  const sel = ov.querySelector("#ppSelect"); sel.innerHTML = "";
  const rows = [];
  try {
    if (Object.keys(PROMOS_BY_ID).length) {
      for (const [id, p] of Object.entries(PROMOS_BY_ID)) {
        const typeTxt = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
        const chan = p.channel === "dining" ? "Dining" : "Delivery";
        rows.push({ id, label: `${p.code || "(no code)"} • ${chan} • ${typeTxt}` });
      }
    } else {
      const snap = await getDocs(collection(db, "promotions"));
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind === "coupon") {
          const typeTxt = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
          const chan = p.channel === "dining" ? "Dining" : "Delivery";
          rows.push({ id: d.id, label: `${p.code || "(no code)"} • ${chan} • ${typeTxt}` });
        }
      });
    }
  } catch (e) { console.error(e); }

  if (!rows.length) sel.innerHTML = `<option value="">(No promotions found)</option>`;
  rows.forEach(r => { const o=document.createElement("option"); o.value=r.id; o.textContent=r.label; sel.appendChild(o); });

  // Preselect current
  const cur = new Set(currentIds || []); Array.from(sel.options).forEach(o => o.selected = cur.has(o.value));

  ov.querySelector("#ppSave").onclick = async () => {
    const clear = ov.querySelector("#ppClear").checked;
    const ids = clear ? [] : [...sel.selectedOptions].map(o=>o.value).filter(Boolean);
    try { await updateDoc(doc(db, "menuItems", itemId), { promotions: ids }); closeOverlay(ov); }
    catch (err) { console.error(err); alert("Failed to assign promotions: " + (err?.message || err)); }
  };

  lockBodyScroll();
  ov.style.display = "block";
  const box = ov.querySelector(".adm-modal"); box.classList.remove("adm-anim-out"); box.classList.add("adm-anim-in");
}

/* =========================
   Simple Edit modal (single item)
   ========================= */
function openEditItemModal(id, d) {
  ensureModalStyles();
  let ov = document.getElementById("editItemModal");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "editItemModal"; ov.className = "adm-overlay";
    ov.innerHTML = `
      <div class="adm-modal">
        <h3 style="margin-top:0">Edit Item</h3>
        <div class="adm-grid">
          <input id="eiName" placeholder="Name"/>
          <input id="eiDesc" placeholder="Description"/>
          <input id="eiPrice" type="number" placeholder="Flat Price (if Not Applicable)"/>
          <div class="adm-grid" style="grid-template-columns:1fr 1fr">
            <input id="eiHalf" type="number" placeholder="Half Price"/>
            <input id="eiFull" type="number" placeholder="Full Price"/>
          </div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button id="eiSave" class="adm-btn adm-btn--primary">Save</button>
          <button id="eiCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#eiCancel").onclick = () => closeOverlay(ov);
  }

  ov.querySelector("#eiName").value = d.name || "";
  ov.querySelector("#eiDesc").value = d.description || "";
  ov.querySelector("#eiPrice").value = d?.qtyType?.type === "Not Applicable" ? (d?.qtyType?.itemPrice || "") : "";
  ov.querySelector("#eiHalf").value  = d?.qtyType?.halfPrice || "";
  ov.querySelector("#eiFull").value  = d?.qtyType?.fullPrice || "";

  ov.querySelector("#eiSave").onclick = async () => {
    const name = ov.querySelector("#eiName").value.trim();
    const description = ov.querySelector("#eiDesc").value.trim();
    const price = parseFloat(ov.querySelector("#eiPrice").value);
    const half  = parseFloat(ov.querySelector("#eiHalf").value);
    const full  = parseFloat(ov.querySelector("#eiFull").value);
    const updates = { name, description };
    if (!isNaN(price) && price > 0) updates.qtyType = { type: "Not Applicable", itemPrice: price };
    else if (!isNaN(half) && !isNaN(full) && half > 0 && full > 0) updates.qtyType = { type: "Half & Full", halfPrice: half, fullPrice: full };
    try { await updateDoc(doc(db, "menuItems", id), updates); closeOverlay(ov); }
    catch (err) { console.error(err); alert("Failed to save: " + (err?.message || err)); }
  };

  lockBodyScroll();
  ov.style.display = "block";
  const box = ov.querySelector(".adm-modal"); box.classList.remove("adm-anim-out"); box.classList.add("adm-anim-in");
}

/* =========================
   Filters / Search
   ========================= */
async function populateFilterDropdowns() {
  try {
    const cats = await CatCourse.fetchCategories?.() || [];
    if (filterCategory) {
      const prev = filterCategory.value;
      filterCategory.innerHTML = `<option value="">All Categories</option>` + cats.map(c => `<option>${c}</option>`).join("");
      filterCategory.value = prev || "";
    }
  } catch {}

  try {
    const courses = await CatCourse.fetchCourses?.() || [];
    if (filterCourse) {
      const prev = filterCourse.value;
      filterCourse.innerHTML = `<option value="">All Courses</option>` + courses.map(c => `<option>${c}</option>`).join("");
      filterCourse.value = prev || "";
    }
  } catch {}
}
function wireSearchAndFilters() {
  const rerender = debounce(() => { renderTable(); updateBulkBar(); }, 200);
  searchInput?.addEventListener("input", rerender);
  filterCategory?.addEventListener("change", rerender);
  filterCourse?.addEventListener("change", rerender);
  filterType?.addEventListener("change", rerender);
}

// Kick initial UI (in case auth is already satisfied in a warm session)
ensureModalStyles();
updateBulkBar();
"""
open("/mnt/data/admin.js","w",encoding="utf-8").write(code)
print("admin.js has been written to /mnt/data/admin.js")
