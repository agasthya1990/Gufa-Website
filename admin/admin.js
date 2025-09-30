/* =========================================================================
   admin.js — Comprehensive, fully documented rewrite (vanilla JS, ES module)
   -------------------------------------------------------------------------
   • No jQuery required. Uses <script type="module">.
   • Keeps every feature you outlined (nothing removed):
       - Auth (login/logout) with status
       - Categories / Courses / Add-ons (create + inline manage)
       - CRUD for Menu Items
       - Image resize (200×200) + upload to Firebase Storage
       - Quantity types (Not Applicable, Half & Full)
       - Filters (Category/Course/Type) + Search
       - Promotions (assign per-item + bulk)
       - Bulk bar: Edit, Delete, Promotions, Add-ons
       - Popovers/“comic genie” animations for dropdowns & modals
   • No "Slide/Function" demo buttons.
   • Strong input validation + defensive guards so the file runs even if an ID
     is missing from the DOM (it simply skips that feature instead of crashing).
   -------------------------------------------------------------------------
   EXPECTED ENVIRONMENT
   - firebase.js must export { auth, db, storage } (already initialized)
   - Firestore collections referenced:
       menuItems, menuCategories, foodCourses, menuAddons, promotions
   - Page provides these elements (IDs can be adjusted below if needed):
       loginBox, adminContent, email, password, loginBtn, logoutBtn, loginStatus
       menuForm, statusMsg, itemName, itemDescription, itemImage,
       qtyType, itemPrice, halfPrice, fullPrice, itemCategory, foodCourse, foodType,
       addonsSelect (multi-select for add-ons)
       searchInput, filterCategory, filterCourse, filterType
       menuTable (with <thead><tr> present) and menuBody (<tbody>)
       Optional: category button/panel = catBtn/catPanel; courseBtn/coursePanel;
                 addonBtn/addonPanel for comic popover pickers.
   -------------------------------------------------------------------------
   IMPORTANT: If any of the above IDs differ in your HTML, change the constants
   in the DOM refs section below. Nothing else should be modified.
   ========================================================================= */

/* =========================
   Imports (ES modules)
   ========================= */
import { auth, db, storage } from "./firebase.js";

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
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
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* =========================
   Global state & DOM refs
   ========================= */
// State
let PROMOS_BY_ID = {};                // { promoId: {...promo} }
let allItems = [];                    // [{ id, data }]
let selectedIds = new Set();          // Set<string>
let editingId = null;                 // currently editing single item

// DOM (change IDs here if your HTML uses different ones)
const el = (id) => document.getElementById(id);

const loginBox      = el("loginBox");
const adminContent  = el("adminContent");
const email         = el("email");
const password      = el("password");
const loginBtn      = el("loginBtn");
const logoutBtn     = el("logoutBtn");
const loginStatus   = el("loginStatus");

const menuForm      = el("menuForm");
const statusMsg     = el("statusMsg");
const menuBody      = el("menuBody");

const itemName            = el("itemName");
const itemDescription     = el("itemDescription");
const itemImage           = el("itemImage");
const qtyTypeSelect       = el("qtyType");
const itemPrice           = el("itemPrice");
const halfPrice           = el("halfPrice");
const fullPrice           = el("fullPrice");
const categoryDropdown    = el("itemCategory");
const foodCourseDropdown  = el("foodCourse");
const foodTypeSelect      = el("foodType");

const addonsSelect        = el("addonsSelect"); // multi-select

const searchInput         = el("searchInput");
const filterCategory      = el("filterCategory");
const filterCourse        = el("filterCourse");
const filterType          = el("filterType");

// Optional “comic dropdown” trigger+panel elements (if you use custom popovers)
const catBtn     = el("categoryDropdownBtn");
const catPanel   = el("categoryDropdownPanel");
const courseBtn  = el("courseDropdownBtn");
const coursePanel= el("courseDropdownPanel");
const addonBtn   = el("addonDropdownBtn");
const addonPanel = el("addonDropdownPanel");


/* =========================
   Utilities & helpers (single source of truth)
   ========================= */
const qs  = (sel, ctx=document) => ctx.querySelector(sel);
const qsa = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

function debounce(fn, wait = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }

// Scroll lock on body while modals/popovers are open
function lockBodyScroll(){ document.body.classList.add("adm-lock"); }
function unlockBodyScroll(){ document.body.classList.remove("adm-lock"); }

// Modal & popover base styles + animation (inserted once)
function ensureModalStyles() {
  if (document.getElementById("admModalStyles")) return;
  const css = `
    .adm-lock { overflow: hidden !important; }
    .adm-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.55); display: none; }
    .adm-modal { background:#fff; color:#111; border-radius:14px; border:2px solid #111; box-shadow:6px 6px 0 #111;
                 max-width:760px; width:min(760px,92vw); margin:6vh auto 0; padding:16px; max-height:80vh; overflow:auto;
                 transform-origin: var(--adm-origin, 50% 0%); }
    .adm-popover { position: absolute; z-index: 9999; background:#fff; color:#111; border-radius:10px; border:2px solid #111;
                   box-shadow:4px 4px 0 #111; padding:8px; display:none; transform-origin: var(--adm-origin, 50% 0%); }
    @keyframes admGenieIn { from{opacity:0; transform:translate(var(--adm-dx,0), var(--adm-dy,0)) scale(.96);} to{opacity:1; transform:translate(0,0) scale(1);} }
    @keyframes admGenieOut{ from{opacity:1; transform:translate(0,0) scale(1);} to{opacity:0; transform:translate(var(--adm-dx,0), var(--adm-dy,0)) scale(.96);} }
    .adm-anim-in  { animation: admGenieIn 220ms ease-out both; }
    .adm-anim-out { animation: admGenieOut 180ms ease-in both; }

    .adm-btn{border:2px solid #111;border-radius:10px;padding:8px 12px;background:#fff;cursor:pointer;box-shadow:3px 3px 0 #111;}
    .adm-btn--primary{background:#111;color:#fff}
    .adm-muted{color:#666}
    .adm-pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #ddd;font-size:12px}
    .adm-pill--dining{background:#f3fff3;border-color:#bde0bd}
    .adm-pill--delivery{background:#f3f7ff;border-color:#bed2ff}
    .adm-toolbar{display:flex;gap:8px;align-items:center;margin:8px 0}

    .adm-list-row{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px dashed #eee}
    .adm-list-row:last-child{border-bottom:0}
    
/* Hide Edit/Delete icons while a row is in editing mode */
.adm-list-row.is-editing [data-role="edit"],
.adm-list-row.is-editing [data-role="delete"] {
  display: none !important;
}
   
  `;
  const style = document.createElement("style"); style.id = "admModalStyles"; style.textContent = css; document.head.appendChild(style);
}

// Compute the animation origin (genie) from a trigger button
function setGenieFrom(triggerEl, overlayEl, modalEl) {
  try {
    if (!triggerEl || !overlayEl || !modalEl) return;
    const r = triggerEl.getBoundingClientRect();
    const cx = r.left + r.width/2; const vw = Math.max(1, window.innerWidth);
    modalEl.style.setProperty("--adm-origin", `${(cx/vw)*100}% 0%`);
    modalEl.style.setProperty("--adm-dx", "0px");
    modalEl.style.setProperty("--adm-dy", "6px");
  } catch {}
}

// Guarded number parsing
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };

// Hidden value helpers for native <select>
function setHiddenValue(selectEl, val) {
  if (!selectEl) return;
  if (val && ![...selectEl.options].some(o => o.value === val)) {
    const opt = document.createElement("option"); opt.value = val; opt.textContent = val; selectEl.appendChild(opt);
  }
  selectEl.value = val || ""; selectEl.dispatchEvent(new Event("change"));
}
function setMultiHiddenValue(selectEl, values = []) {
  if (!selectEl) return; const set = new Set(values);
  [...selectEl.options].forEach(o => { o.selected = set.has(o.value); });
  selectEl.dispatchEvent(new Event("change"));
}

// Button label for the custom Add-ons popover trigger
function updateAddonBtnLabel() {
  if (!addonBtn || !addonsSelect) return;
  const chosen = Array.from(addonsSelect.selectedOptions || []).map(o => o.value);
  addonBtn.textContent = chosen.length ? `Add-ons (${chosen.length}) ▾` : 'Select Add-ons ▾';
}

// Image resize (200×200 JPEG @ 0.85)
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => { const img = new Image(); img.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 200;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 200, 200);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image blob failed")), "image/jpeg", 0.85);
    }; img.onerror = reject; img.src = e.target.result; };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

/* =========================
   Auth (login/logout + gate UI)
   ========================= */
if (loginBtn) {
  loginBtn.type = "button";
  loginBtn.onclick = async (e) => {
    e?.preventDefault?.();
    const em = (email?.value || "").trim(); const pw = (password?.value || "");
    if (!em || !pw) { alert("Please enter both email and password."); return; }
    const old = loginBtn.textContent; loginBtn.disabled = true; loginBtn.textContent = "Signing in…";
    try { await signInWithEmailAndPassword(auth, em, pw); loginStatus && (loginStatus.textContent = "Login successful."); }
    catch (err) { const msg = `Login failed: ${err?.code || ""} ${err?.message || ""}`.trim(); loginStatus && (loginStatus.textContent = msg); alert(msg); }
    finally { loginBtn.disabled = false; loginBtn.textContent = old; }
  };
}
if (logoutBtn) logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
if (loginBox) loginBox.style.display = "none";
if (adminContent) adminContent.style.display = "block";
ensureModalStyles();

// inject slim pill/button + icon polish (idempotent)
(function injectAdminPolish(){
  if (document.getElementById("adm-polish")) return;
  const css = `
    /* --- subtle, slim pill buttons --- */
    .adm-chip-btn {
      display:inline-flex; align-items:center; gap:6px;
      padding:2px 10px; border:1px solid #ddd; border-radius:9999px;
      background:#fff; font-size:12px; line-height:18px; height:22px;
      cursor:pointer; box-shadow:none;
    }
    .adm-chip-btn:hover { background:#f9f9f9; border-color:#ccc; }
    .adm-chip-btn:active { background:#f2f2f2; }

    /* --- inline icons (not capsulated) --- */
    .adm-icon {
      display:inline-flex; align-items:center; justify-content:center;
      width:18px; height:18px; margin-left:8px;
      font-size:14px; opacity:.7; cursor:pointer; user-select:none;
    }
    .adm-icon:hover { opacity:1; }
    .adm-icon[aria-label="Delete"] { color:#b02a37; }
    .adm-icon[aria-label="Edit"] { color:#000; }
    .adm-icon[aria-label="Save"] { color: #2e7d32; }   /* green tick */
    .adm-icon[aria-label="Cancel"] { color: #b02a37; } /* red X */


    /* row layout ensures name is never covered */
    .adm-list-row {
      display:flex; align-items:center; gap:8px; padding:6px 0;
      border-bottom:1px solid #f3f3f3;
    }
    .adm-list-row ._name { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  `;
  const style = document.createElement("style");
  style.id = "adm-polish"; style.textContent = css;
  document.head.appendChild(style);
})();
     
// Wire inline “add” controls (IDs from admin.html)
     
const addCategoryBtn  = document.getElementById("addCategoryBtn");
const newCategoryInput= document.getElementById("newCategoryInput");
addCategoryBtn && (addCategoryBtn.onclick = async () => {
  await addCategoryFromInput(newCategoryInput);
  await loadCategories(categoryDropdown);
   
  // re-render custom list
   
  renderCustomCategoryDropdown();
});

const addCourseBtn  = document.getElementById("addCourseBtn");
const newCourseInput= document.getElementById("newCourseInput");
addCourseBtn && (addCourseBtn.onclick = async () => {
  await addCourseFromInput(newCourseInput);
  await loadCourses(foodCourseDropdown);
  renderCustomCourseDropdown();
});

const addAddonBtn   = document.getElementById("addAddonBtn");
const newAddonInput = document.getElementById("newAddonInput");
const newAddonPrice = document.getElementById("newAddonPrice");
addAddonBtn && (addAddonBtn.onclick = async () => {
  await addAddonFromInputs(newAddonInput, newAddonPrice);
  await loadAddons(addonsSelect);
  renderCustomAddonDropdown();
});

    // Initialize masters → dropdowns
    await Promise.all([
      loadCategories(categoryDropdown),
      loadCourses(foodCourseDropdown),
      loadAddons(addonsSelect),

    ]);
   renderCustomCategoryDropdown?.();
   renderCustomCourseDropdown?.();
    await populateFilterDropdowns();
    wireSearchAndFilters();

    // Start snapshots (menuItems + promotions)
    attachMenuSnapshot();
    attachPromotionsSnapshot();

  } else {
    if (loginBox) loginBox.style.display = "block";
    if (adminContent) adminContent.style.display = "none";
  }
});

/* =========================
   Masters: Categories, Courses, Add-ons
   ========================= */
export async function fetchCategories() {
  const out = []; const snap = await getDocs(collection(db, "menuCategories"));
  snap.forEach(d => { const v=d.data(); if (v?.name) out.push(v.name); }); return out.sort((a,b)=>a.localeCompare(b));
}
export async function fetchCourses() {
  const out = []; const snap = await getDocs(collection(db, "menuCourses"));
  snap.forEach(d => { const v=d.data(); if (v?.name) out.push(v.name); }); return out.sort((a,b)=>a.localeCompare(b));
}
export async function fetchAddons() {
  const out = []; const snap = await getDocs(collection(db, "menuAddons"));
  snap.forEach(d => { const v=d.data()||{}; out.push({ name: v.name || d.id, price: Number(v.price || 0) }); });
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}

export async function loadCategories(select) {
  if (!select) return; const prev = select.value; const cats = await fetchCategories();
  select.innerHTML = `<option value="">-- Select Category --</option>` + cats.map(c=>`<option>${c}</option>`).join("");
  select.value = prev || "";
}
export async function loadCourses(select) {
  if (!select) return; const prev = select.value; const courses = await fetchCourses();
  select.innerHTML = `<option value="">-- Select Food Course --</option>` + courses.map(c=>`<option>${c}</option>`).join("");
  select.value = prev || "";
}
export async function loadAddons(select) {
  if (!select) return; const prevVals = new Set(Array.from(select.selectedOptions||[]).map(o=>o.value));
  const addons = await fetchAddons();
select.innerHTML = addons
  .map(a => `<option value="${a.name}" data-price="${a.price}">${a.name} (₹${a.price})</option>`)
  .join("");

  Array.from(select.options).forEach(o => { o.selected = prevVals.has(o.value); });
}

// Category/Course/Add-on creators (used by small "+" UI next to selects, if present)
export async function addCategoryFromInput(inputEl) {
  const name = (inputEl?.value || "").trim(); if (!name) { alert("Enter category name"); return; }
  await addDoc(collection(db, "menuCategories"), { name }); inputEl.value = "";
}
export async function addCourseFromInput(inputEl) {
  const name = (inputEl?.value || "").trim(); if (!name) { alert("Enter course name"); return; }
  await addDoc(collection(db, "menuCourses"), { name }); inputEl.value = "";
}
export async function addAddonFromInputs(nameEl, priceEl) {
  const name = (nameEl?.value || "").trim(); const price = num(priceEl?.value);
  if (!name) { alert("Enter add-on name"); return; }
  if (!Number.isFinite(price) || price < 0) { alert("Enter valid price"); return; }
  await addDoc(collection(db, "menuAddons"), { name, price }); nameEl.value = ""; if (priceEl) priceEl.value = "";
}

/* =========================
   Filters / Search
   ========================= */
async function populateFilterDropdowns() {
  try {
    const cats = await fetchCategories(); if (filterCategory) {
      const prev = filterCategory.value;
      filterCategory.innerHTML = `<option value="">All Categories</option>` + cats.map(c=>`<option>${c}</option>`).join("");
      filterCategory.value = prev || "";
    }
  } catch {}
  try {
    const courses = await fetchCourses(); if (filterCourse) {
      const prev = filterCourse.value;
      filterCourse.innerHTML = `<option value="">All Courses</option>` + courses.map(c=>`<option>${c}</option>`).join("");
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
function applyFilters(items) {
  const q = (searchInput?.value || "").toLowerCase().trim();
  const fc = (filterCategory?.value || "").trim();
  const fo = (filterCourse?.value || "").trim();
  const ft = (filterType?.value || "").trim();
  return items.filter(({ data: d }) => {
    if (fc && (d.category || "") !== fc) return false;
    if (fo && (d.foodCourse || "") !== fo) return false;
    if (ft && d.foodType !== ft) return false;
    if (q) {
      const addonHay = Array.isArray(d.addons) ? d.addons.map(a => (typeof a === 'string' ? a : a.name)).join(' ') : '';
      const hay = `${d.name} ${d.description} ${d.category || ''} ${d.foodCourse || ''} ${addonHay}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* =========================
   Qty type toggles (create form)
   ========================= */
if (qtyTypeSelect) qtyTypeSelect.onchange = () => {
  const v = qtyTypeSelect.value;
  if (itemPrice) itemPrice.style.display = v === "Not Applicable" ? "block" : "none";
  const showHF = v === "Half & Full";
  if (halfPrice) halfPrice.style.display = showHF ? "block" : "none";
  if (fullPrice) fullPrice.style.display = showHF ? "block" : "none";
};

/* =========================
   Create item (image resize + upload)
   ========================= */
if (menuForm) menuForm.onsubmit = async (e) => {
  e.preventDefault(); statusMsg && (statusMsg.innerText = "Adding…");
  const name        = (itemName?.value || "").trim();
  const description = (itemDescription?.value || "").trim();
  const category    = categoryDropdown?.value;
  const foodCourse  = foodCourseDropdown?.value;
  const foodType    = foodTypeSelect?.value;
  const qtyTypeVal  = qtyTypeSelect?.value;
  const imageFile   = itemImage?.files?.[0];
  const addonNames  = Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value);

  if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeVal || !imageFile) {
    statusMsg && (statusMsg.innerText = "❌ Fill all fields"); return;
  }

  let qtyType = {};
  if (qtyTypeVal === "Not Applicable") {
    const p = num(itemPrice?.value); if (!Number.isFinite(p) || p <= 0) { statusMsg && (statusMsg.innerText = "❌ Invalid price"); return; }
    qtyType = { type: qtyTypeVal, itemPrice: p };
  } else if (qtyTypeVal === "Half & Full") {
    const h = num(halfPrice?.value), f = num(fullPrice?.value);
    if (!Number.isFinite(h) || !Number.isFinite(f) || h <= 0 || f <= 0) { statusMsg && (statusMsg.innerText = "❌ Invalid Half/Full price"); return; }
    qtyType = { type: qtyTypeVal, halfPrice: h, fullPrice: f };
  }

  // resolve add-ons to objects
const addons = Array.from(addonsSelect?.selectedOptions || []).map(o => ({
  name: o.value,
  price: Number(o.dataset.price || 0),
}));

  try {
    const resized = await resizeImage(imageFile);
    const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);
    await uploadBytes(imageRef, resized);
    const imageUrl = await getDownloadURL(imageRef);

    await addDoc(collection(db, "menuItems"), {
      name, description, category, foodCourse, foodType, qtyType, addons, imageUrl,
      promotions: [], inStock: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });

    menuForm.reset(); qtyTypeSelect?.dispatchEvent(new Event("change")); setMultiHiddenValue(addonsSelect, []);
    statusMsg && (statusMsg.innerText = "✅ Added!");
  } catch (err) {
    console.error(err); statusMsg && (statusMsg.innerText = "❌ Error: " + (err?.message || err));
  }
};

/* =========================
   Live snapshots: menuItems & promotions
   ========================= */
function attachMenuSnapshot() {
  onSnapshot(collection(db, "menuItems"), (snap) => {
    allItems = []; snap.forEach(d => allItems.push({ id: d.id, data: d.data() }));
    ensureSelectAllHeader(); renderTable(); updateBulkBar(); populateFilterDropdowns().catch(()=>{});
  }, (err) => { console.error("menuItems snapshot", err?.code, err?.message); allItems = []; renderTable(); updateBulkBar(); });
}
function attachPromotionsSnapshot() {
  onSnapshot(collection(db, "promotions"), (snap) => {
  const map = {}; snap.forEach(d => { const p = d.data() || {}; map[d.id] = p; });
  PROMOS_BY_ID = map; renderTable();
}, (err) => { console.error("promotions snapshot", err?.code, err?.message); PROMOS_BY_ID = {}; renderTable(); });

}

/* =========================
   Table render + row handlers
   ========================= */
function ensureSelectAllHeader() {
  const headRow = qs("#menuTable thead tr"); if (!headRow) return;
  if (!el("selectAll")) { const th = document.createElement("th"); th.innerHTML = `<input type="checkbox" id="selectAll" title="Select all"/>`; headRow.insertBefore(th, headRow.firstElementChild); }
  const allCb = el("selectAll"); if (allCb && !allCb._wired) { allCb._wired = true; allCb.onchange = () => { if (allCb.checked) selectedIds = new Set(allItems.map(i=>i.id)); else selectedIds.clear(); renderTable(); updateBulkBar(); }; }
}

function renderTable() {
  if (!menuBody) return; menuBody.innerHTML = ""; const items = applyFilters(allItems);

  items.forEach(({ id, data: d }) => {
    const qty = d.qtyType || {}; const price = qty.type === "Half & Full" ? `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}` : `₹${qty.itemPrice}`;
    const addonsText = Array.isArray(d.addons) ? d.addons.map(a => (typeof a === 'string' ? a : `${a.name} (₹${a.price})`)).join(', ') : '';
    const promoIds = Array.isArray(d.promotions) ? d.promotions : [];
    const promoChips = promoIds.map(pid => { const p = PROMOS_BY_ID[pid]; if (!p) return `<span class="adm-pill">${pid.slice(0,6)}…</span>`; const pill = p.channel === 'dining' ? 'adm-pill--dining' : 'adm-pill--delivery'; const title = p.type === 'percent' ? `${p.value}% off` : `₹${p.value} off`; return `<span class="adm-pill ${pill}" title="${title}">${p.code || pid}</span>`; }).join(' ');

    const tr = document.createElement("tr"); tr.innerHTML = `
      <td><input type="checkbox" class="rowSelect" data-id="${id}" ${selectedIds.has(id) ? 'checked' : ''}></td>
      <td>${d.name}</td>
      <td>${d.description}</td>
      <td>${d.category || ''}</td>
      <td>${d.foodCourse || ''}</td>
      <td>${d.foodType || ''}</td>
      <td>${qty.type || ''}</td>
      <td>${price || ''}</td>
      <td>${addonsText || '<span class="adm-muted">—</span>'}</td>
      <td>${promoChips || '<span class="adm-muted">—</span>'}</td>
      <td>${d.imageUrl ? `<img src="${d.imageUrl}" width="50" height="50" style="object-fit:cover;border-radius:6px;border:1px solid #eee"/>` : '<span class="adm-muted">—</span>'}</td>
      <td>
        <select class="stockToggle" data-id="${id}">
          <option value="true" ${d.inStock ? 'selected' : ''}>In Stock</option>
          <option value="false" ${!d.inStock ? 'selected' : ''}>Out of Stock</option>
        </select>
      </td>
      <td>
        <button class="promoBtn" data-id="${id}">Promotions</button>
        <button class="addonBtn" data-id="${id}">Add-On</button>
        <button class="editBtn" data-id="${id}">Edit</button>
        <button class="deleteBtn" data-id="${id}">Delete</button>
      </td>`;
    menuBody.appendChild(tr);
  });

  // Row checkbox
  qsa(".rowSelect").forEach(cb => cb.onchange = (e) => { const id = e.target.dataset.id; if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id); updateBulkBar(); syncSelectAllHeader(items); });

  // Stock toggle
  qsa(".stockToggle").forEach(el => el.onchange = async (e) => { const id = e.target.dataset.id; const val = e.target.value === 'true'; try { await updateDoc(doc(db, 'menuItems', id), { inStock: val, updatedAt: serverTimestamp() }); } catch(err) { console.error(err); alert('Failed to update stock'); }});

  // Delete
  qsa(".deleteBtn").forEach(el => el.onclick = async (e) => { const id = el.dataset.id; if (!confirm('Delete this item?')) return; try { await deleteDoc(doc(db, 'menuItems', id)); selectedIds.delete(id); updateBulkBar(); } catch(err) { console.error(err); alert('Delete failed'); }});

  // Edit
  qsa(".editBtn").forEach(el => el.onclick = async () => { const id = el.dataset.id; const snap = await getDoc(doc(db, 'menuItems', id)); if (!snap.exists()) return alert('Item not found'); openEditItemModal(id, snap.data(), el); });

  // Assign add-ons
  qsa(".addonBtn").forEach(el => el.onclick = async () => { const id = el.dataset.id; const snap = await getDoc(doc(db, 'menuItems', id)); if (!snap.exists()) return alert('Item not found'); openAssignAddonsModal(id, Array.isArray(snap.data().addons) ? snap.data().addons : [], el); });

  // Assign promotions
  qsa(".promoBtn").forEach(el => el.onclick = async () => { const id = el.dataset.id; const snap = await getDoc(doc(db, 'menuItems', id)); if (!snap.exists()) return alert('Item not found'); openAssignPromotionsModal(id, Array.isArray(snap.data().promotions) ? snap.data().promotions : [], el); });

  syncSelectAllHeader(items);
}

function syncSelectAllHeader(itemsRendered) {
  const cb = el("selectAll"); if (!cb) return;
  if (!itemsRendered.length) { cb.checked = false; cb.indeterminate = false; return; }
  const total = itemsRendered.length; let selected = 0; for (const { id } of itemsRendered) if (selectedIds.has(id)) selected++;
  cb.checked = selected === total; cb.indeterminate = selected > 0 && selected < total;
}

/* =========================
   Bulk bar (Edit, Delete, Promotions, Add-ons)
   ========================= */
function ensureBulkBar() {
  if (el("bulkBar")) return; const bar = document.createElement("div"); bar.id = "bulkBar"; bar.className = "adm-toolbar";
  bar.innerHTML = `
    <button id="bulkEditBtn" type="button" disabled>Edit Selected (0)</button>
    <button id="bulkDeleteBtn" type="button" disabled>Delete Selected (0)</button>
    <button id="bulkPromosBulkBtn" type="button" disabled>Bulk Promotions</button>
    <button id="bulkAddonsBulkBtn" type="button" disabled>Bulk Add-ons</button>`;
  const table = el("menuTable"); if (table && table.parentNode) table.parentNode.insertBefore(bar, table);

  el("bulkEditBtn").onclick = (e) => {
  if (!selectedIds.size) return alert('Select at least one item');
  try { openBulkEditModal(e.currentTarget); }
  catch (err) {
    console.error("[BulkEdit] open failed:", err?.message || err, err);
    alert("Could not open Bulk Edit: " + (err?.message || err));
  }
};

  el("bulkDeleteBtn").onclick = async () => { if (!selectedIds.size) return; if (!confirm(`Delete ${selectedIds.size} item(s)?`)) return; const ops=[]; selectedIds.forEach(id => ops.push(deleteDoc(doc(db, 'menuItems', id)))); await Promise.all(ops); selectedIds.clear(); updateBulkBar(); };
  el("bulkPromosBulkBtn").onclick = (e) => { if (!selectedIds.size) return alert('Select at least one item'); openBulkPromosModal(e.currentTarget); };
  el("bulkAddonsBulkBtn").onclick = (e) => { if (!selectedIds.size) return alert('Select at least one item'); openBulkAddonsModal(e.currentTarget); };
}
function updateBulkBar() {
  ensureBulkBar(); const n = selectedIds.size;
  const editBtn = el("bulkEditBtn"), delBtn = el("bulkDeleteBtn"), promosBtn = el("bulkPromosBulkBtn"), addonsBtn = el("bulkAddonsBulkBtn");
  if (editBtn)  { editBtn.textContent = `Edit Selected (${n})`;   editBtn.disabled = n===0; }
  if (delBtn)   { delBtn.textContent  = `Delete Selected (${n})`; delBtn.disabled  = n===0; }
  if (promosBtn){ promosBtn.disabled  = n===0; }
  if (addonsBtn){ addonsBtn.disabled  = n===0; }
}

/* =========================
   Overlays (modals) — open/close helpers
   ========================= */
function closeOverlay(ov) { const box = qs('.adm-modal', ov); if (box) { box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); }
  setTimeout(() => { ov.style.display = 'none'; unlockBodyScroll(); }, 180); }

/* =========================
   Bulk: Promotions
   ========================= */
async function openBulkPromosModal(triggerEl) {
  ensureModalStyles(); let ov = el('bulkPromosModal');
  if (!ov) { ov = document.createElement('div'); ov.id = 'bulkPromosModal'; ov.className = 'adm-overlay'; ov.innerHTML = `
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
    </div>`; document.body.appendChild(ov);
    qs('#bpCancel', ov).onclick = () => closeOverlay(ov);
    qs('#bpApply', ov).onclick = async () => {
      if (!selectedIds.size) return alert('No items selected'); const clear = el('bpClear').checked; const sel = el('bpSelect');
      const ids = clear ? [] : [...sel.selectedOptions].map(o=>o.value).filter(Boolean);
      try { qs('#bpApply', ov).disabled = true; const ops = []; selectedIds.forEach(id => ops.push(updateDoc(doc(db,'menuItems',id), { promotions: ids, updatedAt: serverTimestamp() }))); await Promise.all(ops); closeOverlay(ov); }
      catch(e){ console.error(e); alert('Failed to update promotions'); }
      finally{ qs('#bpApply', ov).disabled = false; }
    };
  }
  // load options
  const sel = el('bpSelect'); sel.innerHTML = ''; const rows = [];
if (Object.keys(PROMOS_BY_ID).length) {
  for (const [id, p] of Object.entries(PROMOS_BY_ID)) {
    if (p?.kind !== 'coupon') continue;
    const typeTxt = p.type === 'percent' ? `${p.value}% off` : `₹${p.value} off`;
    const chan = p.channel === 'dining' ? 'Dining' : 'Delivery';
    rows.push({ id, label: `${p.code || '(no code)'} • ${chan} • ${typeTxt}` });
  }
} else {
  const snap = await getDocs(collection(db,'promotions'));
  snap.forEach(d => {
    const p = d.data() || {};
    if (p?.kind !== 'coupon') return;
    const typeTxt = p.type === 'percent' ? `${p.value}% off` : (p.value !== undefined ? `₹${p.value} off` : 'promo');
    const chan = p.channel ? (p.channel === 'dining' ? 'Dining' : 'Delivery') : '';
    const label = [p.code || '(no code)', chan, typeTxt].filter(Boolean).join(' • ');
    rows.push({ id: d.id, label });
  });
}

  if (!rows.length) sel.innerHTML = `<option value="">(No promotions found)</option>`; else rows.forEach(r => { const o=document.createElement('option'); o.value=r.id; o.textContent=r.label; sel.appendChild(o); });
  qs('#bpCount', ov).textContent = String(selectedIds.size);

  lockBodyScroll(); ov.style.display = 'block'; setGenieFrom(triggerEl, ov, qs('.adm-modal', ov)); const box = qs('.adm-modal', ov); box.classList.remove('adm-anim-out'); box.classList.add('adm-anim-in');
}

/* =========================
   Bulk: Add-ons
   ========================= */
async function openBulkAddonsModal(triggerEl) {
  ensureModalStyles(); let ov = el('bulkAddonsModal');
  if (!ov) { ov = document.createElement('div'); ov.id = 'bulkAddonsModal'; ov.className = 'adm-overlay'; ov.innerHTML = `
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
    </div>`; document.body.appendChild(ov);
    qs('#baCancel', ov).onclick = () => closeOverlay(ov);
    qs('#baApply', ov).onclick = async () => {
      if (!selectedIds.size) return alert('No items selected'); const clear = el('baClear').checked;
      const chosen = clear ? [] : [...qs('#baList', ov).querySelectorAll('input[type="checkbox"]:checked')].map(i => ({ name: i.value, price: Number(i.dataset.price || 0) }));
      try { qs('#baApply', ov).disabled = true; const ops=[]; selectedIds.forEach(id => ops.push(updateDoc(doc(db,'menuItems',id), { addons: chosen, updatedAt: serverTimestamp() }))); await Promise.all(ops); closeOverlay(ov); }
      catch(e){ console.error(e); alert('Failed to update add-ons'); }
      finally{ qs('#baApply', ov).disabled = false; }
    };
  }
  // load list
  const list = el('baList'); list.innerHTML = ''; const rows = await fetchAddons(); if (!rows.length) list.innerHTML = `<div class="adm-muted">(No add-ons found)</div>`;
  rows.forEach(a => { const row = document.createElement('label'); row.className='adm-list-row'; row.innerHTML = `<input type="checkbox" value="${a.name}" data-price="${a.price}"/> <span>${a.name} (₹${a.price})</span>`; list.appendChild(row); });
  qs('#baCount', ov).textContent = String(selectedIds.size);

  lockBodyScroll(); ov.style.display = 'block'; setGenieFrom(triggerEl, ov, qs('.adm-modal', ov)); const box = qs('.adm-modal', ov); box.classList.remove('adm-anim-out'); box.classList.add('adm-anim-in');
}

/* =========================
   Bulk: Edit (category/course/type/stock/qty/promos/add-ons)
   ========================= */
async function openBulkEditModal(triggerEl) {
  ensureModalStyles(); let ov = el('bulkEditModal');
  if (!ov) { ov = document.createElement('div'); ov.id = 'bulkEditModal'; ov.className = 'adm-overlay'; ov.innerHTML = `
    <div class="adm-modal">
      <h3 style="margin:0 0 10px">Bulk Edit (<span id="bulkCount">0</span> items)</h3>
      <form id="bulkForm">
        <div style="display:grid; gap:12px;">
          <div>
            <label><input type="checkbox" id="bulkCatEnable"/> Category</label>
            <select id="bulkCategory" disabled><option value="">-- Select Category --</option></select>
          </div>
          <div>
            <label><input type="checkbox" id="bulkCourseEnable"/> Food Course</label>
            <select id="bulkCourse" disabled><option value="">-- Select Food Course --</option></select>
          </div>
          <div>
            <label><input type="checkbox" id="bulkTypeEnable"/> Food Type</label>
            <select id="bulkType" disabled><option value="">-- Select Type --</option><option value="Veg">Veg</option><option value="Non-Veg">Non-Veg</option></select>
          </div>
          <div>
            <label><input type="checkbox" id="bulkStockEnable"/> Stock Status</label>
            <select id="bulkStock" disabled><option value="">-- Select Stock --</option><option value="true">In Stock</option><option value="false">Out of Stock</option></select>
          </div>
          <div>
            <label><input type="checkbox" id="bulkQtyEnable"/> Quantity & Price</label>
            <select id="bulkQtyType" disabled><option value="">-- Select Qty Type --</option><option value="Not Applicable">Not Applicable</option><option value="Half & Full">Half & Full</option></select>
            <input type="number" id="bulkItemPrice" placeholder="Price" style="display:none" disabled />
            <div id="bulkHFWrap" style="display:none; gap:8px; grid-template-columns:1fr 1fr">
              <input type="number" id="bulkHalfPrice" placeholder="Half Price" disabled />
              <input type="number" id="bulkFullPrice" placeholder="Full Price" disabled />
            </div>
          </div>
          <hr/>
          <div>
            <label><input type="checkbox" id="bulkPromosEnable"/> Promotions</label>
            <label style="display:flex; align-items:center; gap:6px"><input type="checkbox" id="bulkClearPromos" disabled/> <span>Clear promotions</span></label>
            <select id="bulkPromosSelect" multiple size="6" disabled></select>
          </div>
          <div>
            <label><input type="checkbox" id="bulkAddonsEnable"/> Add-ons</label>
            <label style="display:flex; align-items:center; gap:6px"><input type="checkbox" id="bulkClearAddons" disabled/> <span>Clear add-ons</span></label>
            <select id="bulkAddonsSelect" multiple size="6" disabled></select>
          </div>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button type="submit" id="bulkApplyBtn" class="adm-btn adm-btn--primary">Apply</button>
          <button type="button" id="bulkCancelBtn" class="adm-btn">Cancel</button>
        </div>
      </form>
    </div>`; document.body.appendChild(ov);

    // Cancel
    qs('#bulkCancelBtn', ov).onclick = () => closeOverlay(ov);

    // Refs
    const bulkCategory  = qs('#bulkCategory', ov);
    const bulkCourse    = qs('#bulkCourse', ov);
    const bulkType      = qs('#bulkType', ov);
    const bulkStock     = qs('#bulkStock', ov);
    const bulkQtyType   = qs('#bulkQtyType', ov);
    const bulkItemPrice = qs('#bulkItemPrice', ov);
    const bulkHFWrap    = qs('#bulkHFWrap', ov);
    const bulkHalfPrice = qs('#bulkHalfPrice', ov);
    const bulkFullPrice = qs('#bulkFullPrice', ov);

    const bulkCatEnable    = qs('#bulkCatEnable', ov);
    const bulkCourseEnable = qs('#bulkCourseEnable', ov);
    const bulkTypeEnable   = qs('#bulkTypeEnable', ov);
    const bulkStockEnable  = qs('#bulkStockEnable', ov);
    const bulkQtyEnable    = qs('#bulkQtyEnable', ov);

    // Toggles
    bulkCatEnable.onchange    = () => { bulkCategory.disabled  = !bulkCatEnable.checked; };
    bulkCourseEnable.onchange = () => { bulkCourse.disabled    = !bulkCourseEnable.checked; };
    bulkTypeEnable.onchange   = () => { bulkType.disabled      = !bulkTypeEnable.checked; };
    bulkStockEnable.onchange  = () => { bulkStock.disabled     = !bulkStockEnable.checked; };
    bulkQtyEnable.onchange    = () => { const on = bulkQtyEnable.checked; bulkQtyType.disabled = !on; toggleBulkQty(); };
    function toggleBulkQty(){ const vt = bulkQtyType.value; const on = bulkQtyEnable.checked; const showSingle = on && vt==='Not Applicable'; const showHF = on && vt==='Half & Full'; bulkItemPrice.style.display = showSingle? 'block':'none'; bulkHFWrap.style.display = showHF? 'grid':'none'; bulkItemPrice.disabled = !showSingle; bulkHalfPrice.disabled = !showHF; bulkFullPrice.disabled = !showHF; }
    bulkQtyType.onchange = toggleBulkQty;

    // Promotions/Add-ons bits
    const promosEnable = qs('#bulkPromosEnable', ov), promosClear = qs('#bulkClearPromos', ov), promosSelect = qs('#bulkPromosSelect', ov);
    const addonsEnable = qs('#bulkAddonsEnable', ov), addonsClear = qs('#bulkClearAddons', ov), addonsSelect = qs('#bulkAddonsSelect', ov);

    async function loadPromotionsOptions(){ promosSelect.innerHTML = ''; const rows = []; const snap = await getDocs(collection(db,'promotions')); snap.forEach(d=>{ const p=d.data(); if (p?.kind==='coupon'){ const typeTxt=p.type==='percent'?`${p.value}% off`:`₹${p.value} off`; const chan=p.channel==='dining'?'Dining':'Delivery'; rows.push({ id:d.id, label:`${p.code || '(no code)'} • ${chan} • ${typeTxt}`}); }}); if (!rows.length) promosSelect.innerHTML = `<option value="">(No promotions found)</option>`; rows.forEach(r=>{ const o=document.createElement('option'); o.value=r.id; o.textContent=r.label; promosSelect.appendChild(o); }); }
    async function loadAddonsOptions(){ addonsSelect.innerHTML = ''; const rows = await fetchAddons(); if (!rows.length) addonsSelect.innerHTML = `<option value="">(No add-ons found)</option>`; rows.forEach(a=>{ const o=document.createElement('option'); o.value=a.name; o.dataset.price=String(a.price); o.textContent=`${a.name} (₹${a.price})`; addonsSelect.appendChild(o); }); }

    function togglePromos(){ const on = promosEnable.checked; promosSelect.disabled = !on; promosClear.disabled = !on; if (on) loadPromotionsOptions(); }
    function toggleAddons(){ const on = addonsEnable.checked; addonsSelect.disabled = !on; addonsClear.disabled = !on; if (on) loadAddonsOptions(); }

    promosEnable.onchange = togglePromos; addonsEnable.onchange = toggleAddons; togglePromos(); toggleAddons();

    // Submit
    qs('#bulkForm', ov).onsubmit = async (e) => {
      e.preventDefault(); if (!selectedIds.size) return alert('No items selected');
      const updates = {};
      if (bulkCatEnable.checked)    { if (!bulkCategory.value) return alert('Select a category');   updates.category   = bulkCategory.value; }
      if (bulkCourseEnable.checked) { if (!bulkCourse.value)   return alert('Select a course');     updates.foodCourse = bulkCourse.value; }
      if (bulkTypeEnable.checked)   { if (!bulkType.value)     return alert('Select a food type');  updates.foodType   = bulkType.value; }
      if (bulkStockEnable.checked)  { if (!bulkStock.value)    return alert('Select stock');        updates.inStock    = (bulkStock.value === 'true'); }
      if (bulkQtyEnable.checked) {
        const vt = bulkQtyType.value; if (!vt) return alert('Select qty type');
        if (vt === 'Not Applicable') { const p = num(bulkItemPrice.value); if (!Number.isFinite(p) || p<=0) return alert('Enter valid price'); updates.qtyType = { type: vt, itemPrice: p }; }
        else if (vt === 'Half & Full') { const h = num(bulkHalfPrice.value), f = num(bulkFullPrice.value); if (!Number.isFinite(h)||!Number.isFinite(f)||h<=0||f<=0) return alert('Enter valid half/full'); updates.qtyType = { type: vt, halfPrice: h, fullPrice: f }; }
      }
      if (promosEnable.checked) { if (promosClear.checked) updates.promotions = []; else updates.promotions = [...promosSelect.selectedOptions].map(o=>o.value).filter(Boolean); }
      if (addonsEnable.checked) { if (addonsClear.checked) updates.addons = []; else updates.addons = [...addonsSelect.selectedOptions].map(o=>({ name:o.value, price:Number(o.dataset.price||0) })); }
      if (!Object.keys(updates).length) return alert('Tick at least one field');
      try { qs('#bulkApplyBtn', ov).disabled = true; const ops=[]; selectedIds.forEach(id => ops.push(updateDoc(doc(db,'menuItems',id), { ...updates, updatedAt: serverTimestamp() }))); await Promise.all(ops); closeOverlay(ov); }
      catch(err){ console.error(err); alert('Bulk update failed'); }
      finally{ qs('#bulkApplyBtn', ov).disabled = false; }
    };

    // cache refs on the element for quick re-open
    ov._refs = { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQty };
  }

  qs('#bulkCount', ov).textContent = String(selectedIds.size);
  const { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQty } = ov._refs || {};
  try { await loadCategories(bulkCategory); } catch {}
  try { await loadCourses(bulkCourse); } catch {}
  if (bulkType) bulkType.value = ''; if (bulkQtyType) bulkQtyType.value = ''; toggleBulkQty?.();

  // reset toggles each open
  ['bulkCatEnable','bulkCourseEnable','bulkTypeEnable','bulkStockEnable','bulkQtyEnable','bulkPromosEnable','bulkAddonsEnable','bulkClearPromos','bulkClearAddons']
    .forEach(id => { const x = el(id); if (x) x.checked = false; });
  el('bulkStock').disabled = true; if (bulkQtyType) bulkQtyType.disabled = true; const promosSelect = el('bulkPromosSelect'); if (promosSelect) { promosSelect.innerHTML = ''; promosSelect.disabled = true; } const addonsSelect2 = el('bulkAddonsSelect'); if (addonsSelect2) { addonsSelect2.innerHTML = ''; addonsSelect2.disabled = true; }
    lockBodyScroll();
  ov.style.display = 'block';
  setGenieFrom(triggerEl, ov, qs('.adm-modal', ov));
  const box = qs('.adm-modal', ov);
  box.classList.remove('adm-anim-out');
  box.classList.add('adm-anim-in');
}


/* =========================
   Assign (single item): Promotions & Add-ons
   ========================= */
async function openAssignPromotionsModal(itemId, currentIds = [], triggerEl) {
  ensureModalStyles();
  let ov = el('promoAssignModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'promoAssignModal';
    ov.className = 'adm-overlay';
    ov.innerHTML = `
      <div class="adm-modal" style="max-width:520px;">
        <h3 style="margin:0 0 10px">Assign Promotions</h3>
        <label style="display:flex; align-items:center; gap:6px; margin:8px 0 6px;">
          <input type="checkbox" id="ppClear"/> <span>Clear promotions</span>
        </label>
        <select id="ppSelect" multiple size="8" style="width:100%"></select>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button id="ppSave" class="adm-btn adm-btn--primary">Save</button>
          <button id="ppCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    qs('#ppCancel', ov).onclick = () => closeOverlay(ov);
  }

  // load options
  const sel = el('ppSelect');
  sel.innerHTML = '';
  const rows = [];
  if (Object.keys(PROMOS_BY_ID).length) {
    for (const [id, p] of Object.entries(PROMOS_BY_ID)) {
      const typeTxt = p.type === 'percent' ? `${p.value}% off` : `₹${p.value} off`;
      const chan = p.channel === 'dining' ? 'Dining' : 'Delivery';
      rows.push({ id, label: `${p.code || '(no code)'} • ${chan} • ${typeTxt}` });
    }
     
 } else {
  const snap = await getDocs(collection(db, 'promotions'));
  snap.forEach(d => {
    const p = d.data() || {};
    const typeTxt = p.type === 'percent' ? `${p.value}% off` : (p.value !== undefined ? `₹${p.value} off` : 'promo');
    const chan = p.channel ? (p.channel === 'dining' ? 'Dining' : 'Delivery') : '';
    const label = [p.code || '(no code)', chan, typeTxt].filter(Boolean).join(' • ');
    rows.push({ id: d.id, label });
  });
}

  if (!rows.length) {
    sel.innerHTML = `<option value="">(No promotions found)</option>`;
  } else {
    rows.forEach(r => {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.label;
      sel.appendChild(o);
    });
  }
  const cur = new Set(currentIds || []);
  Array.from(sel.options).forEach(o => (o.selected = cur.has(o.value)));

  qs('#ppSave', ov).onclick = async () => {
    const clear = el('ppClear').checked;
    const ids = clear ? [] : [...sel.selectedOptions].map(o => o.value).filter(Boolean);
    try {
      await updateDoc(doc(db, 'menuItems', itemId), {
        promotions: ids,
        updatedAt: serverTimestamp(),
      });
      closeOverlay(ov);
    } catch (err) {
      console.error(err);
      alert('Failed to assign promotions');
    }
  };

  lockBodyScroll();
  ov.style.display = 'block';
  setGenieFrom(triggerEl, ov, qs('.adm-modal', ov));
  const box = qs('.adm-modal', ov);
  box.classList.remove('adm-anim-out');
  box.classList.add('adm-anim-in');
}

async function openAssignAddonsModal(itemId, current = [], triggerEl) {
  ensureModalStyles();
  let ov = el('addonAssignModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'addonAssignModal';
    ov.className = 'adm-overlay';
    ov.innerHTML = `
      <div class="adm-modal" style="max-width:520px;">
        <h3 style="margin:0 0 10px">Assign Add-ons</h3>
        <div id="assignAddonList" style="max-height:300px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px;"></div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button id="assignAddonSave" class="adm-btn adm-btn--primary">Save</button>
          <button id="assignAddonCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    qs('#assignAddonCancel', ov).onclick = () => closeOverlay(ov);
  }

  const list = el('assignAddonList');
  const cur = new Set((current || []).map(a => (typeof a === 'string' ? a : a.name)));
  const addons = await fetchAddons();
  list.innerHTML = addons
    .map(
      a =>
        `<label class="adm-list-row"><input type="checkbox" value="${a.name}" ${
          cur.has(a.name) ? 'checked' : ''
        }/> <span>${a.name} (₹${a.price})</span></label>`
    )
    .join('');

  qs('#assignAddonSave', ov).onclick = async () => {
    const chosen = addons
      .filter(a => list.querySelector(`input[value="${a.name}"]`)?.checked)
      .map(a => ({ name: a.name, price: a.price }));
    try {
      await updateDoc(doc(db, 'menuItems', itemId), {
        addons: chosen,
        updatedAt: serverTimestamp(),
      });
      closeOverlay(ov);
    } catch (err) {
      console.error(err);
      alert('Failed to assign add-ons');
    }
  };

  lockBodyScroll();
  ov.style.display = 'block';
  setGenieFrom(triggerEl, ov, qs('.adm-modal', ov));
  const box = qs('.adm-modal', ov);
  box.classList.remove('adm-anim-out');
  box.classList.add('adm-anim-in');
}

/* =========================
   Single-item Edit modal (name/desc/qty + optional image replace)
   ========================= */
function openEditItemModal(id, d, triggerEl) {
  ensureModalStyles();
  let ov = el('editItemModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'editItemModal';
    ov.className = 'adm-overlay';
    ov.innerHTML = `
      <div class="adm-modal">
        <h3 style="margin:0 0 10px">Edit Item</h3>
        <form id="editForm">
          <div style="display:grid; gap:8px;">
            <input id="eiName" placeholder="Name"/>
            <textarea id="eiDesc" placeholder="Description"></textarea>
            <select id="eiQtyType">
              <option value="Not Applicable">Not Applicable</option>
              <option value="Half & Full">Half & Full</option>
            </select>
            <input id="eiItemPrice" type="number" placeholder="Price (if Not Applicable)"/>
            <div style="display:grid; gap:8px; grid-template-columns:1fr 1fr">
              <input id="eiHalf" type="number" placeholder="Half Price"/>
              <input id="eiFull" type="number" placeholder="Full Price"/>
            </div>
            <div>
              <label class="adm-muted">Replace image (optional)</label>
              <input id="eiImage" type="file" accept="image/*"/>
            </div>
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
            <button type="submit" class="adm-btn adm-btn--primary">Save</button>
            <button type="button" id="eiCancel" class="adm-btn">Cancel</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(ov);
    qs('#eiCancel', ov).onclick = () => closeOverlay(ov);
  }

  const eiName = el('eiName');
  const eiDesc = el('eiDesc');
  const eiQtyType = el('eiQtyType');
  const eiItemPrice = el('eiItemPrice');
  const eiHalf = el('eiHalf');
  const eiFull = el('eiFull');

  eiName.value = d.name || '';
  eiDesc.value = d.description || '';
  const qt = d.qtyType?.type || 'Not Applicable';
  eiQtyType.value = qt;
  if (qt === 'Not Applicable') {
    eiItemPrice.value = d.qtyType?.itemPrice || '';
    eiHalf.value = '';
    eiFull.value = '';
  } else {
    eiItemPrice.value = '';
    eiHalf.value = d.qtyType?.halfPrice || '';
    eiFull.value = d.qtyType?.fullPrice || '';
  }

  const toggle = () => {
    const v = eiQtyType.value;
    const showSingle = v === 'Not Applicable';
    const showHF = v === 'Half & Full';
    eiItemPrice.parentElement.style.display = showSingle ? 'block' : 'none';
    eiHalf.parentElement.parentElement.style.display = showHF ? 'grid' : 'none';
  };
  eiQtyType.onchange = toggle;
  toggle();

  qs('#editForm', ov).onsubmit = async e => {
    e.preventDefault();
    const name = eiName.value.trim();
    const description = eiDesc.value.trim();
    if (!name || !description) return alert('Name/Description required');

    const v = eiQtyType.value;
    let qtyType = {};
    if (v === 'Not Applicable') {
      const p = num(eiItemPrice.value);
      if (!Number.isFinite(p) || p <= 0) return alert('Invalid price');
      qtyType = { type: v, itemPrice: p };
    } else {
      const h = num(eiHalf.value),
        f = num(eiFull.value);
      if (!Number.isFinite(h) || !Number.isFinite(f) || h <= 0 || f <= 0)
        return alert('Invalid half/full');
      qtyType = { type: v, halfPrice: h, fullPrice: f };
    }

    let imageUpdate = {};
    const file = el('eiImage')?.files?.[0];
    if (file) {
      const resized = await resizeImage(file);
      const imageRef = ref(storage, `menuImages/${Date.now()}_${file.name}`);
      await uploadBytes(imageRef, resized);
      const url = await getDownloadURL(imageRef);
      imageUpdate.imageUrl = url;
    }

    try {
      await updateDoc(doc(db, 'menuItems', id), {
        name,
        description,
        qtyType,
        updatedAt: serverTimestamp(),
        ...imageUpdate,
      });
      closeOverlay(ov);
    } catch (err) {
      console.error(err);
      alert('Update failed: ' + (err?.message || err));
    }
  };

  lockBodyScroll();
  ov.style.display = 'block';
  setGenieFrom(triggerEl, ov, qs('.adm-modal', ov));
  const box = qs('.adm-modal', ov);
  box.classList.remove('adm-anim-out');
  box.classList.add('adm-anim-in');
}

/* =========================
   Optional: Comic popover pickers for Category/Course/Add-ons
   ========================= */
async function renderCustomCategoryDropdown() {
  if (!catBtn || !catPanel) return;
  const categories = await fetchCategories();
catPanel.innerHTML = categories
  .map(
    name => `
    <div class="adm-list-row" data-name="${name}">
      <span class="_name" data-role="label" title="${name}">${name}</span>
      <button class="adm-chip-btn" data-role="select" title="Use">Use</button>
      <span class="adm-icon" data-role="edit"   aria-label="Edit"   title="Edit">🖉</span>
      <span class="adm-icon" data-role="delete" aria-label="Delete" title="Delete">🗑</span>
    </div>`
  )
  .join('');

  catBtn.onclick = e => {
    e.stopPropagation();
    ensureModalStyles();
    const open = catPanel.style.display !== 'block';
    catPanel.style.display = open ? 'block' : 'none';
    setGenieFrom(catBtn, catPanel, catPanel);
    if (open) {
  catPanel.classList.remove('adm-anim-out');
  catPanel.classList.add('adm-anim-in');
  const close = ev => {
    if (!catPanel.contains(ev.target) && ev.target !== catBtn) {
      catPanel.classList.remove('adm-anim-in');
      catPanel.classList.add('adm-anim-out');
     setTimeout(() => {
  catPanel.style.display = 'none';
  document.removeEventListener('mousedown', close);
  unlockBodyScroll();
}, 160);
    }
  };
  document.addEventListener('mousedown', close);
}

  catPanel.onclick = async e => {
  const row = e.target.closest('.adm-list-row');
  if (!row) return;
  const role = e.target.getAttribute('data-role');
  const oldName = row.getAttribute('data-name');

  if (role === 'select') {
    setHiddenValue(categoryDropdown, oldName);
    catBtn.textContent = `${oldName} ▾`;
    catPanel.style.display = 'none';
    unlockBodyScroll();
    return;
  }

  if (role === 'edit') {
    const labelEl = row.querySelector('[data-role="label"]');
    if (!labelEl) return;
    const cur = labelEl.textContent;
    labelEl.innerHTML = `<input type="text" class="adm-input" value="${cur}" style="min-width:160px" />`;
    row.querySelector('[data-role="edit"]').style.display = 'none';
    row.querySelector('[data-role="delete"]').style.display = 'none';
const saveBtn = document.createElement('span');
saveBtn.className = 'adm-icon';
saveBtn.setAttribute('data-role','save');
saveBtn.setAttribute('aria-label','Save');
saveBtn.title = 'Save';
saveBtn.textContent = '✓';

const cancelBtn = document.createElement('span');
cancelBtn.className = 'adm-icon';
cancelBtn.setAttribute('data-role','cancel');
cancelBtn.setAttribute('aria-label','Cancel');
cancelBtn.title = 'Cancel';
cancelBtn.textContent = '✕';

row.appendChild(saveBtn);
row.appendChild(cancelBtn);

    return;
  }
  if (role === 'cancel') {
    const input = row.querySelector('input.adm-input'); const val = input ? input.value : oldName;
    const labelEl = row.querySelector('[data-role="label"]'); if (labelEl) labelEl.textContent = val;
    row.querySelector('[data-role="edit"]').style.display = '';
    row.querySelector('[data-role="delete"]').style.display = '';
    row.querySelector('[data-role="save"]')?.remove();
    row.querySelector('[data-role="cancel"]')?.remove();
    return;
  }
  if (role === 'save') {
    const input = row.querySelector('input.adm-input'); const newName = (input?.value || '').trim();
    if (!newName) return alert('Category name cannot be empty');
    try {
      const qref = query(collection(db, 'menuCategories'), where('name','==', oldName));
      const snap = await getDocs(qref);
      const ops = [];
      snap.forEach(d => ops.push(updateDoc(doc(db, 'menuCategories', d.id), { name: newName })));
      await Promise.all(ops);
      row.setAttribute('data-name', newName);
      const labelEl = row.querySelector('[data-role="label"]'); if (labelEl) labelEl.textContent = newName;
      row.classList.remove('is-editing');
row.querySelector('[data-role="edit"]').style.display = '';
row.querySelector('[data-role="delete"]').style.display = '';
row.querySelector('[data-role="save"]')?.remove();
row.querySelector('[data-role="cancel"]')?.remove();
await loadCategories(categoryDropdown);

    } catch (err) {
      console.error(err); alert('Rename failed: ' + (err?.message || err));
    }
    return;
  }
  if (role === 'delete') {
    if (!confirm(`Delete category "${oldName}"?`)) return;
    try {
      const qref = query(collection(db, 'menuCategories'), where('name','==', oldName));
      const snap = await getDocs(qref);
      const ops = []; snap.forEach(d => ops.push(deleteDoc(doc(db, 'menuCategories', d.id))));
      await Promise.all(ops);
      row.remove();
      await loadCategories(categoryDropdown);
 } catch (e) {
  console.error(e);
  alert('Delete failed: ' + (e?.message || e));
}
return;
  }
};
}

async function renderCustomCourseDropdown() {
  if (!courseBtn || !coursePanel) return;
  const courses = await fetchCourses();
  coursePanel.innerHTML = courses
  .map(
    name => `
    <div class="adm-list-row" data-name="${name}">
      <span class="_name" data-role="label" title="${name}">${name}</span>
      <button class="adm-chip-btn" data-role="select" title="Use">Use</button>
      <span class="adm-icon" data-role="edit"   aria-label="Edit"   title="Edit">🖉</span>
      <span class="adm-icon" data-role="delete" aria-label="Delete" title="Delete">🗑</span>
    </div>`
  )
  .join('');
   
  courseBtn.onclick = e => {
    e.stopPropagation();
    ensureModalStyles();
    const open = coursePanel.style.display !== 'block';
    coursePanel.style.display = open ? 'block' : 'none';
    setGenieFrom(courseBtn, coursePanel, coursePanel);
  if (open) {
  coursePanel.classList.remove('adm-anim-out');
  coursePanel.classList.add('adm-anim-in');
  const close = ev => {
    if (!coursePanel.contains(ev.target) && ev.target !== courseBtn) {
      coursePanel.classList.remove('adm-anim-in');
      coursePanel.classList.add('adm-anim-out');
      setTimeout(() => {
        coursePanel.style.display = 'none';
        document.removeEventListener('mousedown', close);
      unlockBodyScroll();
      }, 160);
    }
  };
  document.addEventListener('mousedown', close);
}    

 coursePanel.onclick = e => {
  const row = e.target.closest('.adm-list-row');
  if (!row) return;
  const role = e.target.getAttribute('data-role');
  const name = row.getAttribute('data-name');

  if (role === 'select') {
    setHiddenValue(foodCourseDropdown, name);
    courseBtn.textContent = `${name} ▾`;
    coursePanel.style.display = 'none';
    unlockBodyScroll();
    return;
  }

  if (role === 'edit') {
    const labelEl = row.querySelector('[data-role="label"]');
    const cur = labelEl?.textContent || name;
    labelEl.innerHTML = `<input type="text" class="adm-input" value="${cur}" style="min-width:160px" />`;
    row.classList.add('is-editing');

    // swap icons
    row.querySelector('[data-role="edit"]').style.display   = 'none';
    row.querySelector('[data-role="delete"]').style.display = 'none';

    const saveBtn = document.createElement('span');
    saveBtn.className = 'adm-icon'; saveBtn.setAttribute('data-role','save');   saveBtn.textContent = '✓';
    const cancelBtn = document.createElement('span');
    cancelBtn.className='adm-icon'; cancelBtn.setAttribute('data-role','cancel'); cancelBtn.textContent = '✕';
    row.appendChild(saveBtn); row.appendChild(cancelBtn);

    saveBtn.onclick = async () => {
      const val = labelEl.querySelector('input')?.value.trim();
      if (!val) return alert('Enter a name');
      try {
        const q = query(collection(db, "menuCourses"), where("name", "==", name));
        const snap = await getDocs(q);
        const ops = [];
        snap.forEach(d => { ops.push(updateDoc(doc(db,"menuCourses", d.id), { name: val })); });
        await Promise.all(ops);

        row.setAttribute('data-name', val);
        labelEl.textContent = val;
        row.classList.remove('is-editing');
        saveBtn.remove(); cancelBtn.remove();
        row.querySelector('[data-role="edit"]').style.display   = '';
        row.querySelector('[data-role="delete"]').style.display = '';
        setHiddenValue(foodCourseDropdown, val);
        courseBtn.textContent = `${val} ▾`;
      } catch (e) { console.error(e); alert('Rename failed'); }
    };

    cancelBtn.onclick = () => {
      labelEl.textContent = name;
      row.classList.remove('is-editing');
      saveBtn.remove(); cancelBtn.remove();
      row.querySelector('[data-role="edit"]').style.display   = '';
      row.querySelector('[data-role="delete"]').style.display = '';
    };
    return;
  }

    if (role === 'delete') {
    if (!confirm(`Delete course "${name}"?`)) return;
    try {
      const q = query(collection(db, "menuCourses"), where("name", "==", name));
      const snap = await getDocs(q);
      const ops = [];
      snap.forEach(d => ops.push(deleteDoc(doc(db,"menuCourses", d.id))));
      await Promise.all(ops);
      row.remove();
      if (foodCourseDropdown?.value === name) {
        setHiddenValue(foodCourseDropdown, "");
        courseBtn.textContent = `Select Course ▾`;
      }
    } catch (e) { console.error(e); alert('Delete failed'); }
    return;
  }
}; // closes coursePanel.onclick
}; // closes if (open)
}   // closes async function renderCustomCourseDropdown



/* =========================
   Add-ons (custom multi)
   ========================= */
async function renderCustomAddonDropdown() {
  if (!addonBtn || !addonPanel) return;

  const addons = await fetchAddons();
  const selected = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o => o.value));

  // Uniform, subtle row: checkbox + label + inline icons
  addonPanel.innerHTML = addons
    .map(a => `
      <div class="adm-list-row" data-name="${a.name}" data-price="${a.price}">
        <label style="display:flex; gap:8px; align-items:center; margin:0; flex:1;">
          <input type="checkbox" value="${a.name}" ${selected.has(a.name) ? 'checked' : ''}/>
          <span class="_name" data-role="label">${a.name} (₹${a.price})</span>
        </label>
        <span class="adm-icon" data-role="edit"   aria-label="Edit"   title="Edit">🖉</span>
        <span class="adm-icon" data-role="delete" aria-label="Delete" title="Delete">🗑</span>
      </div>`)
    .join('');

  // Open/close popover
// Open/close popover (NO body scroll lock here)
addonBtn.onclick = (e) => {
  e.stopPropagation();
  ensureModalStyles();
  const open = addonPanel.style.display !== "block";
  addonPanel.style.display = open ? "block" : "none";
  setGenieFrom(addonBtn, addonPanel, addonPanel);
  if (open) {
    addonPanel.classList.remove("adm-anim-out");
    addonPanel.classList.add("adm-anim-in");
    const close = (ev) => {
      if (!addonPanel.contains(ev.target) && ev.target !== addonBtn) {
        addonPanel.classList.remove("adm-anim-in");
        addonPanel.classList.add("adm-anim-out");
        setTimeout(() => {
          addonPanel.style.display = "none";
          document.removeEventListener("mousedown", close);
        }, 160);
      }
    };
    document.addEventListener("mousedown", close);
  }
};

  // Checkbox → selection sync (fixes earlier `.addonPanel` typo)
  addonPanel.onchange = () => {
    const values = Array.from(addonPanel.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
    setMultiHiddenValue(addonsSelect, values);
    updateAddonBtnLabel();
  };

  // Single delegated click handler (no duplicates)
  addonPanel.onclick = async e => {
    const row = e.target.closest('.adm-list-row');
    if (!row) return;
    const role = e.target.getAttribute('data-role');

    // Inline edit UI: input + ✓ (Save) + ✕ (Cancel)
     
    if (role === 'edit') {
  row.classList.add('is-editing');
  const oldName = row.getAttribute('data-name');
  const oldPrice = Number(row.getAttribute('data-price') || 0);

  row.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; width:100%;">
      <input class="addon-edit-name" type="text" value="${oldName}" style="flex:1; min-width:120px;">
      <input class="addon-edit-price" type="number" step="1" min="0" value="${oldPrice}" style="width:110px;">
      <span class="adm-icon" data-role="save"   aria-label="Save"   title="Save">✓</span>
      <span class="adm-icon" data-role="cancel" aria-label="Cancel" title="Cancel">✕</span>
    </div>`;

  // Save handler
  row.querySelector('[data-role="save"]').onclick = async () => {
    const nameEl  = row.querySelector('.addon-edit-name');
    const priceEl = row.querySelector('.addon-edit-price');
    const newName  = (nameEl?.value || '').trim();
    const newPrice = Number(priceEl?.value || 0);

    if (!newName) return alert('Enter a valid name');
    if (!Number.isFinite(newPrice) || newPrice < 0) return alert('Enter a valid price');

    try {
      await renameAddonEverywhere(oldName, newName, newPrice);
      const selected = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o => o.value));
      if (selected.has(oldName)) { selected.delete(oldName); selected.add(newName); }
      await loadAddons(addonsSelect);
      setMultiHiddenValue(addonsSelect, Array.from(selected));
      await renderCustomAddonDropdown();
      updateAddonBtnLabel();
  } catch (err) {
  console.error(err);
  alert('Rename failed: ' + (err?.message || err));
  await renderCustomAddonDropdown();
  row.classList.remove('is-editing');
}
 };

  // Cancel handler
  row.querySelector('[data-role="cancel"]').onclick = () => {
    renderCustomAddonDropdown();
  };

  return;
}

    // Delete
    if (role === 'delete') {
      const name = row.getAttribute('data-name');
      if (!confirm(`Delete add-on "${name}"?\n(Items will NOT be deleted; the add-on will be removed from them.)`)) return;
      try {
        const selected = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o => o.value));
        selected.delete(name);
        await deleteAddonEverywhere(name);
        await loadAddons(addonsSelect);
        setMultiHiddenValue(addonsSelect, Array.from(selected));
        await renderCustomAddonDropdown();
        updateAddonBtnLabel();
      } catch (err) {
        console.error(err);
        alert('Delete failed: ' + (err?.message || err));
      }
      return;
    }
  };
}
  updateAddonBtnLabel();
}

/* =========================
   Boot: ensure styles, bulk bar, and render optional popovers
   ========================= */
ensureModalStyles();
ensureBulkBar();
renderCustomCategoryDropdown();
renderCustomCourseDropdown();
renderCustomAddonDropdown();
// --- Helper: delete an add-on everywhere (master list + all menu items) ---
async function deleteAddonEverywhere(name) {
  // 1) Remove from master (menuAddons by name)
  try {
    const qref = query(collection(db, 'menuAddons'), where('name', '==', name));
    const snap = await getDocs(qref);
    const ops = [];
    snap.forEach(d => ops.push(deleteDoc(doc(db, 'menuAddons', d.id))));
    await Promise.all(ops);
  } catch (err) {
    console.error('[Addons] master delete failed', err);
    // continue to items cleanup anyway
  }

  // 2) Remove from all menuItems.addons (string or object form)
  const itemsSnap = await getDocs(collection(db, 'menuItems'));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const data = d.data() || {};
    if (!Array.isArray(data.addons)) return;
    const updated = data.addons.filter(a => {
      if (a == null) return false;
      if (typeof a === 'string') return a !== name;
      return a.name !== name;
    });
    if (updated.length !== data.addons.length) {
      itemOps.push(updateDoc(doc(db, 'menuItems', d.id), { addons: updated, updatedAt: serverTimestamp() }));
    }
  });
  await Promise.all(itemOps);
}

// --- Helper: rename an add-on everywhere (master list + all menu items) ---
async function renameAddonEverywhere(oldName, newName, newPrice) {
  // 1) Update master records in menuAddons (match by 'name' field)
  try {
    const q = query(collection(db, 'menuAddons'), where('name', '==', oldName));
    const snap = await getDocs(q);
    const masterOps = [];
    snap.forEach(d => {
      const next = { ...(d.data() || {}), name: newName };
      if (newPrice !== undefined && newPrice !== null) next.price = Number(newPrice);
      masterOps.push(updateDoc(doc(db, 'menuAddons', d.id), next));
    });
    await Promise.all(masterOps);
  } catch (err) {
    console.error('[Addons] master rename failed', err);
    // continue to items anyway so UI stays consistent
  }

  // 2) Update all menuItems that reference this add-on
  const itemsSnap = await getDocs(collection(db, 'menuItems'));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const data = d.data() || {};
    if (!Array.isArray(data.addons)) return;

    let changed = false;
    const updated = data.addons.map(a => {
      if (a == null) return a;

      // Legacy string form: ["Cheese", "Sauce"]
      if (typeof a === 'string') {
        if (a === oldName) {
          changed = true;
          return newName; // keep legacy form if present
        }
        return a;
      }

      // Object form: [{ name, price, ... }]
      if (a.name === oldName) {
        changed = true;
        return {
          ...a,
          name: newName,
          price: (newPrice !== undefined && newPrice !== null)
            ? Number(newPrice)
            : Number(a.price ?? 0),
        };
      }
      return a;
    });

    if (changed) {
      itemOps.push(updateDoc(doc(db, 'menuItems', d.id), { addons: updated, updatedAt: serverTimestamp() }));
    }
  });

  await Promise.all(itemOps);
}
