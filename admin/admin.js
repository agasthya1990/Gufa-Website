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

// ===== Debug flags (flip to false for production) =====
const DEBUG = true;          // master switch
const DEBUG_OVERLAYS = true; // fine-grained (optional)
const DEBUG_BULK = true;     // fine-grained (optional)

// Mute chatter when DEBUG=false (keep errors)
if (!DEBUG) {
  console.log = () => {};
  console.debug = () => {};
  console.info = () => {};
  console.warn = () => {};
}

// Lightweight logger wrappers: call D.log / D.warn / D.err instead of console.*
const D = {
  log:  (...a) => { if (DEBUG) console.log(...a); },
  warn: (...a) => { if (DEBUG) console.warn(...a); },
  err:  (...a) => console.error(...a) // errors always visible
};


/* =========================
   Global state & DOM refs
   ========================= */
// State
let PROMOS_BY_ID = {};                // { promoId: {...promo} }
let BANNER_TITLES_BY_COUPON = {};
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

function debounce(fn, wait = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), wait);
  };
}

// Scroll lock on body while modals/popovers are open
function lockBodyScroll(){ document.body.classList.add("adm-lock"); }
function unlockBodyScroll(){ document.body.classList.remove("adm-lock"); }

// Modal & popover base styles + animation (inserted once)
function ensureModalStyles() {
  if (document.getElementById("admModalStyles")) return;
  const css = `
/* ===== Admin overlay / modal — hardened ===== */
.adm-lock { overflow: hidden !important; }

/* Overlay: sit above everything, always visible when display:block */
.adm-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important; /* above any app header/portal */
  background: rgba(0,0,0,0.55) !important;
  display: none;               /* JS flips to block */
  pointer-events: auto !important;
  visibility: visible !important;
  contain: layout style paint; /* avoid weird stacking contexts */
}

/* Modal box */
.adm-modal {
  position: relative !important;
  z-index: 1 !important;
  background:#fff !important;
  color:#111 !important;
  border-radius:14px !important;
  border:2px solid #111 !important;
  box-shadow:6px 6px 0 #111 !important;
  max-width:760px !important;
  width:min(760px,92vw) !important;
  margin:6vh auto 0 !important;
  padding:16px !important;
  max-height:80vh !important;
  overflow:auto !important;
  opacity: 1 !important;
  transform: none !important;
  --adm-origin: 50% 0%;
  --adm-dx: 0px;
  --adm-dy: 6px;
  transform-origin: var(--adm-origin);
}

/* Popover base (same hardening) */
.adm-popover {
  position: absolute !important;
  z-index: 2147483646 !important;
  background:#fff !important;
  color:#111 !important;
  border-radius:10px !important;
  border:2px solid #111 !important;
  box-shadow:4px 4px 0 #111 !important;
  padding:8px !important;
  display:none;
  pointer-events: auto !important;
  opacity: 1 !important;
  transform: none !important;
  --adm-origin: 50% 0%;
  --adm-dx: 0px;
  --adm-dy: 6px;
  transform-origin: var(--adm-origin);
}

/* Animations are optional niceties */
@keyframes admGenieIn {
  from { opacity:0; transform:translate(var(--adm-dx), var(--adm-dy)) scale(.96); }
  to   { opacity:1; transform:translate(0,0) scale(1); }
}
@keyframes admGenieOut{
  from { opacity:1; transform:translate(0,0) scale(1); }
  to   { opacity:0; transform:translate(var(--adm-dx), var(--adm-dy)) scale(.96); }
}
.adm-anim-in  { animation: admGenieIn 220ms ease-out both; }
.adm-anim-out { animation: admGenieOut 180ms ease-in both; }

/* Buttons / pills */
.adm-btn{border:2px solid #111;border-radius:10px;padding:8px 12px;background:#fff;cursor:pointer;box-shadow:3px 3px 0 #111;}
.adm-btn--primary{background:#111;color:#fff}
.adm-muted{color:#666}
.adm-pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #ddd;font-size:12px}
.adm-pill--dining{background:#f3fff3;border-color:#bde0bd}
.adm-pill--delivery{background:#f3f7ff;border-color:#bed2ff}
.adm-toolbar{display:flex;gap:8px;align-items:center;margin:8px 0}

/* List rows + inline edit guards */
.adm-list-row{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px dashed #eee}
.adm-list-row:last-child{border-bottom:0}
.adm-list-row.is-editing [data-role="edit"],
.adm-list-row.is-editing [data-role="delete"] { display: none !important; }
  `;
  const style = document.createElement("style");
  style.id = "admModalStyles";
  style.textContent = css;
  document.head.appendChild(style);
}

/* =========================================================
   Overlay & popover show helpers (centralized + hardened)
   ========================================================= */

/**
 * Show a modal overlay you've already appended to <body>.
 * - Locks body scroll
 * - Sets display
 * - Positions genie origin
 * - Forces reflow before animating
 */
function showOverlay(ov, triggerEl) {
  if (!ov) return;
  ensureModalStyles();

  const box = qs('.adm-modal', ov) || ov; // fallback if no .adm-modal
  lockBodyScroll();
  ov.style.display = 'block';

  requestAnimationFrame(() => {
    setGenieFrom(triggerEl, ov, box);
    box.classList.remove('adm-anim-out');
    // Force reflow so the animation always re-starts
    void box.offsetWidth;
    box.classList.add('adm-anim-in');
  });
}

/**
 * Show a small popover panel (not a full-screen overlay).
 * Does NOT lock body scroll (by design).
 */
function showPopover(panelEl, triggerEl) {
  if (!panelEl) return;
  ensureModalStyles();

  panelEl.style.display = 'block';
  requestAnimationFrame(() => {
    setGenieFrom(triggerEl, panelEl, panelEl);
    panelEl.classList.remove('adm-anim-out');
    void panelEl.offsetWidth; // force reflow
    panelEl.classList.add('adm-anim-in');
  });
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
    attachBannersSnapshot();

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

function attachBannersSnapshot() {
  onSnapshot(
    query(collection(db, "promotions"), where("kind", "==", "banner")), (snap) => {
    const map = {};
    snap.forEach(d => {
      const b = d.data() || {};
      const title = b.title || d.id;
      const linked = Array.isArray(b.linkedCouponIds) ? b.linkedCouponIds : [];
      linked.forEach(cid => {
        const k = String(cid);
        if (!map[k]) map[k] = [];
        // Keep unique titles, prefer earlier order
        if (!map[k].includes(title)) map[k].push(title);
      });
    });
    BANNER_TITLES_BY_COUPON = map;
    // Re-render any open lists that depend on labels
    try { renderTable(); } catch(_) {}
  }, (err) => {
    console.error("banners snapshot", err?.code, err?.message);
    BANNER_TITLES_BY_COUPON = {};
  });
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
  <button type="button" class="promoBtn" data-id="${id}">Promotions</button>
  <button type="button" class="addonBtn" data-id="${id}">Add-ons</button>
  <button type="button" class="editBtn"  data-id="${id}">Edit</button>
  <button type="button" class="deleteBtn" data-id="${id}">Delete</button>
</td>
 </tr>`;
    menuBody.appendChild(tr);
  });

  // Row checkbox
  qsa(".rowSelect").forEach(cb => cb.onchange = (e) => { const id = e.target.dataset.id; if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id); updateBulkBar(); syncSelectAllHeader(items); });

    // Stock toggle
  qsa(".stockToggle").forEach(el => el.onchange = async (e) => {
    const id = e.target.dataset.id; const val = e.target.value === 'true';
    try { await updateDoc(doc(db, 'menuItems', id), { inStock: val, updatedAt: serverTimestamp() }); }
    catch(err) { console.error(err); alert('Failed to update stock'); }
  });

} // ← close renderTable() here

function syncSelectAllHeader(itemsRendered) {
  const cb = el("selectAll"); if (!cb) return;
  if (!itemsRendered.length) {
    cb.checked = false;
    cb.indeterminate = false;
    return;
  }
  const total = itemsRendered.length;
  let selected = 0;
  for (const { id } of itemsRendered) {
    if (selectedIds.has(id)) selected++;
  }
  cb.checked = (selected === total);
  cb.indeterminate = (selected > 0 && selected < total);
}


// Delegated row-actions handler (survives re-renders)

if (menuBody && !menuBody._delegated) {
  menuBody._delegated = true;
  menuBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) { console.warn("[DEBUG] Row action click, but no data-id on button", btn); return; }

    e.preventDefault(); e.stopPropagation();

    try {
      if (btn.classList.contains('deleteBtn')) {
        console.log("[DEBUG] Delete row clicked", { id });
        if (!confirm('Delete this item?')) return;
        await deleteDoc(doc(db, 'menuItems', id));
        console.log("[DEBUG] Deleted item", { id });
        selectedIds.delete(id);
        updateBulkBar();
        return;
      }

      if (btn.classList.contains('editBtn')) {
        console.log("[DEBUG] Edit row clicked", { id });
        const snap = await getDoc(doc(db, 'menuItems', id));
        if (!snap.exists()) { alert('Item not found'); return; }
        console.log("[DEBUG] opening EditItemModal", id);
        return openEditItemModal(id, snap.data(), btn);
      }

      if (btn.classList.contains('addonBtn')) {
        console.log("[DEBUG] Assign Add-ons clicked", { id });
        const snap = await getDoc(doc(db, 'menuItems', id));
        if (!snap.exists()) { alert('Item not found'); return; }
        console.log("[DEBUG] opening AssignAddonsModal", id);
        return openAssignAddonsModal(
          id,
          Array.isArray(snap.data().addons) ? snap.data().addons : [],
          btn
        );
      }

      if (btn.classList.contains('promoBtn')) {
        console.log("[DEBUG] Assign Promotions clicked", { id });
        const snap = await getDoc(doc(db, 'menuItems', id));
        if (!snap.exists()) { alert('Item not found'); return; }
        console.log("[DEBUG] opening AssignPromotionsModal", id);
        return openAssignPromotionsModal(
          id,
          Array.isArray(snap.data().promotions) ? snap.data().promotions : [],
          btn
        );
      }

      console.warn("[DEBUG] Unhandled row button class", btn.className);
    } catch (err) {
      console.error("[DEBUG] Row action failed:", err);
      alert('Action failed: ' + (err?.message || err));
    }
  });
}

/* =========================
   Bulk bar (Edit, Delete, Promotions, Add-ons)
   ========================= */
   
function ensureBulkBar() {
  if (el("bulkBar")) return;
  const bar = document.createElement("div");
  bar.id = "bulkBar";
  bar.className = "adm-toolbar";
  bar.innerHTML = `
  <button id="bulkEditBtn"       type="button" disabled>Edit Selected (0)</button>
  <button id="bulkDeleteBtn"     type="button" disabled>Delete Selected (0)</button>
  <button id="bulkPromosBulkBtn" type="button" disabled>Bulk Promotions</button>
  <button id="bulkAddonsBulkBtn" type="button" disabled>Bulk Add-ons</button>`;
  const table = el("menuTable");
  if (table && table.parentNode) table.parentNode.insertBefore(bar, table);

  const bulkEditBtn   = el("bulkEditBtn");
  const bulkDeleteBtn = el("bulkDeleteBtn");
  const bulkPromosBtn = el("bulkPromosBulkBtn");
  const bulkAddonsBtn = el("bulkAddonsBulkBtn");

  if (!bulkEditBtn || !bulkDeleteBtn || !bulkPromosBtn || !bulkAddonsBtn) {
    console.warn("[DEBUG] Bulk bar buttons missing", { bulkEditBtn, bulkDeleteBtn, bulkPromosBtn, bulkAddonsBtn });
    return;
  }

  bulkEditBtn.onclick = (e) => {
    console.log("[DEBUG] Bulk Edit clicked. selectedIds:", Array.from(selectedIds));
    e?.preventDefault?.(); e?.stopPropagation?.();
    if (!selectedIds.size) return alert('Select at least one item');
    try {
      openBulkEditModal(e.currentTarget);
      console.log("[DEBUG] openBulkEditModal invoked");
    } catch (err) {
      console.error("[BulkEdit] open failed:", err?.message || err, err);
      alert("Could not open Bulk Edit: " + (err?.message || err));
    }
  };

  bulkDeleteBtn.onclick = async (e) => {
    console.log("[DEBUG] Bulk Delete clicked. selectedIds:", Array.from(selectedIds));
    e?.preventDefault?.(); e?.stopPropagation?.();
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} item(s)?`)) return;
    const ops = [];
    selectedIds.forEach(id => ops.push(deleteDoc(doc(db, 'menuItems', id))));
    try {
      await Promise.all(ops);
      console.log("[DEBUG] Bulk delete completed.");
    } catch (err) {
      console.error("[DEBUG] Bulk delete failed:", err);
      alert("Bulk delete failed: " + (err?.message || err));
    }
    selectedIds.clear();
    updateBulkBar();
  };

  bulkPromosBtn.onclick = (e) => {
    console.log("[DEBUG] Bulk Promotions clicked. selectedIds:", Array.from(selectedIds));
    e?.preventDefault?.(); e?.stopPropagation?.();
    if (!selectedIds.size) return alert('Select at least one item');
    openBulkPromosModal(e.currentTarget);
  };

  bulkAddonsBtn.onclick = (e) => {
    console.log("[DEBUG] Bulk Add-ons clicked. selectedIds:", Array.from(selectedIds));
    e?.preventDefault?.(); e?.stopPropagation?.();
    if (!selectedIds.size) return alert('Select at least one item');
    openBulkAddonsModal(e.currentTarget);
  };
} // ← close ensureBulkBar()


// Top-level so other code can call it safely
function updateBulkBar() {
  ensureBulkBar();
  const n = selectedIds.size;
  const editBtn  = el("bulkEditBtn");
  const delBtn   = el("bulkDeleteBtn");
  const promosBtn= el("bulkPromosBulkBtn");
  const addonsBtn= el("bulkAddonsBulkBtn");
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

// Bulk Promotions — coupons only, checkbox UI like single-row Promotions, with channel badges

async function openBulkPromosModal(triggerEl) {
  ensureModalStyles();

  // 1) Create/get overlay and force it visible + on top of stacking context
  let ov = document.getElementById('bulkPromosModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'bulkPromosModal';
    ov.className = 'adm-overlay';
    ov.innerHTML = `
      <div class="adm-modal" style="display:block;visibility:visible;opacity:1;max-width:560px">
        <h3 style="margin:0 0 10px">Bulk Promotions (<span id="bpCount">0</span> items)</h3>

        <div class="adm-row" style="gap:8px; align-items:center; margin-bottom:8px">
          <label><input type="checkbox" id="bpClear"/> Clear all promotions</label>
        </div>

        <div id="bpList" style="max-height:48vh; overflow:auto; border:1px solid #eee; padding:8px; border-radius:8px;"></div>

        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button id="bpApply" class="adm-btn adm-btn--primary">Apply</button>
          <button id="bpCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
  } else {
    const box = ov.querySelector('.adm-modal');
    if (box) { box.style.display = 'block'; box.style.visibility = 'visible'; box.style.opacity = '1'; }
    document.body.appendChild(ov); // ensure last child → sits on top
  }

  // 2) Show overlay immediately (prevents “dim only”)
  ov.style.display = 'block';
  try { showOverlay(ov, triggerEl); } catch { ov.style.display = 'block'; }

  // 3) Refs
  const bpCount  = ov.querySelector('#bpCount');
  const bpList   = ov.querySelector('#bpList');
  const bpApply  = ov.querySelector('#bpApply');
  const bpCancel = ov.querySelector('#bpCancel');
  const bpClear  = ov.querySelector('#bpClear');

  // Count selected rows
  bpCount.textContent = String(selectedIds?.size || 0);

  // Cancel (idempotent)
  bpCancel.onclick = () => closeOverlay(ov);

  // 4) Helper for colored channel badges (Delivery=purple, Dining=green)
  const channelBadge = (ch) => {
    if (ch === 'delivery') {
      return `<span style="display:inline-block; min-width:10px; padding:2px 8px; border-radius:999px; font-size:12px; line-height:1; background:#7c3aed; color:#fff; margin-left:8px;">Delivery</span>`;
    }
    if (ch === 'dining') {
      return `<span style="display:inline-block; min-width:10px; padding:2px 8px; border-radius:999px; font-size:12px; line-height:1; background:#16a34a; color:#fff; margin-left:8px;">Dining</span>`;
    }
    return `<span style="display:inline-block; min-width:10px; padding:2px 8px; border-radius:999px; font-size:12px; line-height:1; background:#9ca3af; color:#fff; margin-left:8px;">General</span>`;
  };

  // 5) Fetch promotions — **COUPONS ONLY** — build same checkbox UI as row Promotions
let rows = [];
try {
  if (typeof PROMOS_BY_ID === 'object' && PROMOS_BY_ID && Object.keys(PROMOS_BY_ID).length) {
    for (const [id, p] of Object.entries(PROMOS_BY_ID)) {
      if (p?.kind !== 'coupon') continue;              // coupons only
      const inactive  = p.active === false;            // hide inactive
      const limit     = p.usageLimit ?? null;
      const used      = p.usedCount ?? 0;
      const exhausted = limit !== null && used >= limit; // hide exhausted
      if (inactive || exhausted) continue;

      const typeTxt =
        p.type === 'percent' ? `${p.value}% off`
        : (p.value !== undefined ? `₹${p.value} off` : 'promo');
      const chan = p.channel || '';
      const bannerTitle = (BANNER_TITLES_BY_COUPON?.[id]?.[0]) || null;
      const label = [p.code || '(no code)', bannerTitle, (chan === 'dining' ? 'Dining' : 'Delivery'), typeTxt]
     .filter(Boolean).join(' • ');
     rows.push({ id, label, channel: chan });
    }
  } else {
     
    const snap = await getDocs(collection(db, 'promotions'));
     snap.forEach(d => {
     const p = d.data() || {};
  if (p?.kind !== 'coupon') return;
  const inactive  = p.active === false;
  const limit     = p.usageLimit ?? null;
  const used      = p.usedCount ?? 0;
  const exhausted = limit !== null && used >= limit;
  if (inactive || exhausted) return;

  const typeTxt =
    p.type === 'percent' ? `${p.value}% off`
    : (p.value !== undefined ? `₹${p.value} off` : 'promo');
  const chan = p.channel || '';
  const label = [p.code || '(no code)', chan === 'dining' ? 'Dining' : 'Delivery', typeTxt]
                 .filter(Boolean).join(' • ');
  rows.push({ id: d.id, label, channel: chan });
});
  }
} catch (e) {
  console.error('[BulkPromos] fetch failed:', e);
  rows = [];
}


  // 6) Hydrate list (checkboxes + badges)
  if (!rows.length) {
    bpList.innerHTML = `<div class="adm-muted">(No promotions found)</div>`;
  } else {
    bpList.innerHTML = rows.map(r => `
      <label class="adm-list-row">
        <input type="checkbox" value="${r.id}"/>
        <span>${r.label}</span>
        ${channelBadge(r.channel)}
      </label>
    `).join('');
  }

  // 7) Apply to all selected rows
  bpApply.onclick = async () => {
    try {
      if (!selectedIds?.size) return alert('No items selected');
      bpApply.disabled = true;

      const clear = !!bpClear.checked;
      const ids = clear
        ? []
        : Array.from(bpList.querySelectorAll('input[type="checkbox"]:checked'))
            .map(i => i.value);

      console.log('[BulkPromos] apply', { count: selectedIds.size, ids, clear });

      const ops = [];
      selectedIds.forEach(itemId => {
        ops.push(updateDoc(doc(db, 'menuItems', itemId), {
          promotions: ids,
          updatedAt: serverTimestamp(),
        }));
      });
      await Promise.all(ops);

      closeOverlay(ov);
    } catch (err) {
      console.error('[BulkPromos] apply failed:', err);
      alert('Failed to update promotions: ' + (err?.message || err));
    } finally {
      bpApply.disabled = false;
    }
  };
}

/* =========================
   Bulk: Add-ons
   ========================= */
async function openBulkAddonsModal(triggerEl) {
  ensureModalStyles();

  // Create/get overlay + force visible & top-of-stack
  let ov = document.getElementById('bulkAddonsModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'bulkAddonsModal';
    ov.className = 'adm-overlay';
    ov.innerHTML = `
      <div class="adm-modal" style="display:block;visibility:visible;opacity:1;max-width:560px">
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
  } else {
    const box = ov.querySelector('.adm-modal');
    if (box) { box.style.display='block'; box.style.visibility='visible'; box.style.opacity='1'; }
    document.body.appendChild(ov);
  }

  // Show overlay immediately
  ov.style.display = 'block';
  try { showOverlay(ov, triggerEl); } catch { ov.style.display = 'block'; }

  // Refs
  const list = ov.querySelector('#baList');
  const btnApply = ov.querySelector('#baApply');
  const btnCancel = ov.querySelector('#baCancel');
  const baCount = ov.querySelector('#baCount');

  // Wire cancel (idempotent)
  btnCancel.onclick = () => closeOverlay(ov);

  // Load add-ons and hydrate
  list.innerHTML = '';
  const rows = await fetchAddons(); // [{name, price}, ...]
  if (!rows.length) {
    list.innerHTML = `<div class="adm-muted">(No add-ons found)</div>`;
  } else {
    rows.forEach(a => {
      const row = document.createElement('label');
      row.className = 'adm-list-row';
      row.innerHTML = `<input type="checkbox" value="${a.name}" data-price="${a.price}"/> <span>${a.name} (₹${a.price})</span>`;
      list.appendChild(row);
    });
  }
  baCount.textContent = String(selectedIds.size);

  // Apply
  btnApply.onclick = async () => {
    if (!selectedIds.size) return alert('No items selected');
    const clear = ov.querySelector('#baClear').checked;
    const chosen = clear ? [] :
      Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
           .map(i => ({ name: i.value, price: Number(i.dataset.price || 0) }));

    try {
      btnApply.disabled = true;
      const ops = [];
      selectedIds.forEach(id => ops.push(updateDoc(doc(db,'menuItems',id), { addons: chosen, updatedAt: serverTimestamp() })));
      await Promise.all(ops);
      closeOverlay(ov);
    } catch (e) {
      console.error('[BulkAddons] apply failed', e);
      alert('Failed to update add-ons');
    } finally {
      btnApply.disabled = false;
    }
  };
}


/* =========================
   Bulk: Edit (category/course/type/stock/qty/promos/add-ons)
   ========================= */

// Bulk Edit — only Category, Course, Type, Stock, Qty/Price
async function openBulkEditModal(triggerEl) {
  ensureModalStyles();

  let ov = document.getElementById('bulkEditModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'bulkEditModal';
    ov.className = 'adm-overlay';
    ov.innerHTML = `
      <div class="adm-modal" style="display:block;visibility:visible;opacity:1;max-width:720px">
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
              <select id="bulkType" disabled>
                <option value="">-- Select Type --</option>
                <option value="Veg">Veg</option>
                <option value="Non-Veg">Non-Veg</option>
              </select>
            </div>
            <div>
              <label><input type="checkbox" id="bulkStockEnable"/> Stock Status</label>
              <select id="bulkStock" disabled>
                <option value="">-- Select Stock --</option>
                <option value="true">In Stock</option>
                <option value="false">Out of Stock</option>
              </select>
            </div>
            <div>
              <label><input type="checkbox" id="bulkQtyEnable"/> Quantity & Price</label>
              <select id="bulkQtyType" disabled>
                <option value="">-- Select Qty Type --</option>
                <option value="Not Applicable">Not Applicable</option>
                <option value="Half & Full">Half & Full</option>
              </select>
              <input type="number" id="bulkItemPrice" placeholder="Price" style="display:none" disabled />
              <div id="bulkHFWrap" style="display:none; gap:8px; grid-template-columns:1fr 1fr">
                <input type="number" id="bulkHalfPrice" placeholder="Half Price" disabled />
                <input type="number" id="bulkFullPrice" placeholder="Full Price" disabled />
              </div>
            </div>
          </div>
          <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
            <button type="submit" id="bulkApplyBtn" class="adm-btn adm-btn--primary">Apply</button>
            <button type="button" id="bulkCancelBtn" class="adm-btn">Cancel</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(ov);
  } else {
    const box = ov.querySelector('.adm-modal');
    if (box) { box.style.display='block'; box.style.visibility='visible'; box.style.opacity='1'; }
    document.body.appendChild(ov);
  }

  ov.style.display = 'block';
  try { showOverlay(ov, triggerEl); } catch { ov.style.display = 'block'; }

  // Refs
  const bulkCount    = ov.querySelector('#bulkCount');
  const bulkForm     = ov.querySelector('#bulkForm');
  const bulkCategory = ov.querySelector('#bulkCategory');
  const bulkCourse   = ov.querySelector('#bulkCourse');
  const bulkType     = ov.querySelector('#bulkType');
  const bulkStock    = ov.querySelector('#bulkStock');

  const bulkQtyEnable= ov.querySelector('#bulkQtyEnable');
  const bulkQtyType  = ov.querySelector('#bulkQtyType');
  const bulkItemPrice= ov.querySelector('#bulkItemPrice');
  const bulkHFWrap   = ov.querySelector('#bulkHFWrap');
  const bulkHalfPrice= ov.querySelector('#bulkHalfPrice');
  const bulkFullPrice= ov.querySelector('#bulkFullPrice');

  const bulkCatEnable   = ov.querySelector('#bulkCatEnable');
  const bulkCourseEnable= ov.querySelector('#bulkCourseEnable');
  const bulkTypeEnable  = ov.querySelector('#bulkTypeEnable');
  const bulkStockEnable = ov.querySelector('#bulkStockEnable');

  const btnApply        = ov.querySelector('#bulkApplyBtn');
  const btnCancel       = ov.querySelector('#bulkCancelBtn');

  btnCancel.onclick = () => closeOverlay(ov);
  bulkCount.textContent = String(selectedIds.size);

  // Load dropdowns
  try { await loadCategories(bulkCategory); } catch {}
  try { await loadCourses(bulkCourse); } catch {}
  if (bulkType) bulkType.value = '';

  // Qty toggles
  function toggleBulkQty(){
    const on = bulkQtyEnable.checked;
    const vt = bulkQtyType.value;
    const showSingle = on && vt === 'Not Applicable';
    const showHF     = on && vt === 'Half & Full';

    bulkQtyType.disabled   = !on;
    bulkItemPrice.style.display = showSingle ? 'block' : 'none';
    bulkHFWrap.style.display    = showHF ? 'grid' : 'none';

    bulkItemPrice.disabled = !showSingle;
    bulkHalfPrice.disabled = !showHF;
    bulkFullPrice.disabled = !showHF;
  }
  bulkQtyEnable.onchange = toggleBulkQty;
  bulkQtyType.onchange   = toggleBulkQty;
  bulkQtyEnable.checked  = false; bulkQtyType.value = ''; toggleBulkQty();

  // Toggles
  bulkCatEnable.onchange    = () => { bulkCategory.disabled = !bulkCatEnable.checked; };
  bulkCourseEnable.onchange = () => { bulkCourse.disabled   = !bulkCourseEnable.checked; };
  bulkTypeEnable.onchange   = () => { bulkType.disabled     = !bulkTypeEnable.checked; };
  bulkStockEnable.onchange  = () => { bulkStock.disabled    = !bulkStockEnable.checked; };

  // Submit
  bulkForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!selectedIds.size) return alert('No items selected');

    const updates = {};
    if (bulkCatEnable.checked)    { if (!bulkCategory.value) return alert('Select a category');   updates.category   = bulkCategory.value; }
    if (bulkCourseEnable.checked) { if (!bulkCourse.value)   return alert('Select a course');     updates.foodCourse = bulkCourse.value; }
    if (bulkTypeEnable.checked)   { if (!bulkType.value)     return alert('Select a food type');  updates.foodType   = bulkType.value; }
    if (bulkStockEnable.checked)  { if (!bulkStock.value)    return alert('Select stock');        updates.inStock    = (bulkStock.value === 'true'); }

    if (bulkQtyEnable.checked) {
      const vt = bulkQtyType.value; if (!vt) return alert('Select qty type');
      if (vt === 'Not Applicable') {
        const p = Number(bulkItemPrice.value);
        if (!Number.isFinite(p) || p <= 0) return alert('Enter valid price');
        updates.qtyType = { type: vt, itemPrice: p };
      } else if (vt === 'Half & Full') {
        const h = Number(bulkHalfPrice.value), f = Number(bulkFullPrice.value);
        if (!Number.isFinite(h) || !Number.isFinite(f) || h <= 0 || f <= 0) return alert('Enter valid half/full');
        updates.qtyType = { type: vt, halfPrice: h, fullPrice: f };
      }
    }

    if (!Object.keys(updates).length) return alert('Tick at least one field');

    try {
      btnApply.disabled = true;
      const ops = [];
      selectedIds.forEach(id => ops.push(updateDoc(doc(db,'menuItems',id), { ...updates, updatedAt: serverTimestamp() })));
      await Promise.all(ops);
      closeOverlay(ov);
    } catch (err) {
      console.error('[BulkEdit] apply failed', err);
      alert('Bulk update failed');
    } finally {
      btnApply.disabled = false;
    }
  };
}



// Assign Promotions — coupons only, multi-select like Add-ons, with channel badges (Delivery=purple, Dining=green)

async function openAssignPromotionsModal(itemId, currentIds = [], triggerEl) {
  try {
    ensureModalStyles();

    // 1) Create/get overlay + force visibility/top-of-stack
    let ov = document.getElementById('promoAssignModal');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'promoAssignModal';
      ov.className = 'adm-overlay';
      ov.innerHTML = `
        <div class="adm-modal" style="max-width:560px;display:block;visibility:visible;opacity:1">
          <h3 style="margin:0 0 10px">Assign Promotions</h3>
          <div class="adm-row" style="gap:8px; align-items:center; margin-bottom:8px">
            <label><input type="checkbox" id="ppClear"/> Clear all promotions</label>
          </div>
          <div id="promoList" style="max-height:300px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px;"></div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
            <button id="ppSave" class="adm-btn adm-btn--primary">Save</button>
            <button id="ppCancel" class="adm-btn">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      ov.querySelector('#ppCancel').onclick = () => closeOverlay(ov);
    } else {
      const box = ov.querySelector('.adm-modal');
      if (box) { box.style.display = 'block'; box.style.visibility = 'visible'; box.style.opacity = '1'; }
      document.body.appendChild(ov);
    }

    // 2) Show overlay immediately (prevents “dim only”)
    ov.style.display = 'block';
    try { showOverlay(ov, triggerEl); } catch { ov.style.display = 'block'; }

    // 3) Refs
    const list = ov.querySelector('#promoList');
    const btnSave = ov.querySelector('#ppSave');
    const btnCancel = ov.querySelector('#ppCancel');
    const ppClear = ov.querySelector('#ppClear');

    // 4) Fetch promotions — **COUPONS ONLY**
let rows = [];
if (Object.keys(PROMOS_BY_ID).length) {
  for (const [id, p] of Object.entries(PROMOS_BY_ID)) {
    if (p?.kind !== 'coupon') continue;             // coupons only
    const inactive  = p.active === false;           // hide inactive
    const limit     = p.usageLimit ?? null;
    const used      = p.usedCount ?? 0;
    const exhausted = limit !== null && used >= limit; // hide exhausted
    if (inactive || exhausted) continue;

    const typeTxt = p.type === 'percent' ? `${p.value}% off` : `₹${p.value} off`;
    rows.push({
      id,
      code: p.code || '(no code)',
      channel: p.channel || '',
      label: [p.code || '(no code)', p.channel === 'dining' ? 'Dining' : 'Delivery', typeTxt]
              .filter(Boolean).join(' • ')
    });
  }
} else {
  // Fallback to Firestore — again **COUPONS ONLY**
  const snap = await getDocs(collection(db, 'promotions'));
  snap.forEach(d => {
    const p = d.data() || {};
    if (p?.kind !== 'coupon') return;
    const inactive  = p.active === false;
    const limit     = p.usageLimit ?? null;
    const used      = p.usedCount ?? 0;
    const exhausted = limit !== null && used >= limit;
    if (inactive || exhausted) return;

    const typeTxt = p.type === 'percent' ? `${p.value}% off` : (p.value !== undefined ? `₹${p.value} off` : 'promo');
    rows.push({
      id: d.id,
      code: p.code || '(no code)',
      channel: p.channel || '',
      label: [p.code || '(no code)', p.channel === 'dining' ? 'Dining' : 'Delivery', typeTxt]
              .filter(Boolean).join(' • ')
    });
  });
}

    // 5) Colored channel badge helper
    const channelBadge = (ch) => {
      if (ch === 'delivery') {
        return `<span style="display:inline-block; min-width:10px; padding:2px 8px; border-radius:999px; font-size:12px; line-height:1; background:#7c3aed; color:#fff; margin-left:8px;">Delivery</span>`;
      }
      if (ch === 'dining') {
        return `<span style="display:inline-block; min-width:10px; padding:2px 8px; border-radius:999px; font-size:12px; line-height:1; background:#16a34a; color:#fff; margin-left:8px;">Dining</span>`;
      }
      return `<span style="display:inline-block; min-width:10px; padding:2px 8px; border-radius:999px; font-size:12px; line-height:1; background:#9ca3af; color:#fff; margin-left:8px;">General</span>`;
    };

    // 6) Hydrate checkbox list (multi-select like Add-ons)
    const cur = new Set(Array.isArray(currentIds) ? currentIds : []);
    if (!rows.length) {
      list.innerHTML = `<div class="adm-muted">(No promotions found)</div>`;
    } else {
      list.innerHTML = rows.map(r => {
        const checked = cur.has(r.id) ? 'checked' : '';
        return `<label class="adm-list-row">
                  <input type="checkbox" value="${r.id}" ${checked}/>
                  <span>${r.label}</span>
                  ${channelBadge(r.channel)}
                </label>`;
      }).join('');
    }

    // 7) Wire buttons
    btnCancel.onclick = () => closeOverlay(ov);
    btnSave.onclick = async () => {
      try {
        btnSave.disabled = true;
        const clear = !!ppClear.checked;
        const ids = clear
          ? []
          : Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(el => el.value);
        await updateDoc(doc(db, 'menuItems', itemId), { promotions: ids, updatedAt: serverTimestamp() });
        closeOverlay(ov);
      } catch (err) {
        console.error('[PromoModal] save failed:', err);
        alert('Failed to assign promotions: ' + (err?.message || err));
      } finally {
        btnSave.disabled = false;
      }
    };
  } catch (err) {
    console.error('[PromoModal] open failed (outer):', err);
    alert('Could not open Assign Promotions: ' + (err?.message || err));
  }
}

// Assign Add-ons — hardened, visible-first, no UI changes

async function openAssignAddonsModal(itemId, current = [], triggerEl) {
  try {
    ensureModalStyles();

    // 1) Create/get overlay + force to top of stacking context
    let ov = document.getElementById('addonAssignModal');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'addonAssignModal';
      ov.className = 'adm-overlay';
      ov.innerHTML = `
        <div class="adm-modal" style="max-width:520px;display:block;visibility:visible;opacity:1">
          <h3 style="margin:0 0 10px">Assign Add-ons</h3>
          <div id="assignAddonList" style="max-height:300px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px;"></div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
            <button id="assignAddonSave" class="adm-btn adm-btn--primary">Save</button>
            <button id="assignAddonCancel" class="adm-btn">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      // Cancel wiring (fresh each create)
      ov.querySelector('#assignAddonCancel').onclick = () => closeOverlay(ov);
    } else {
      // ensure modal box is visible even if CSS tried to hide it
      const box = ov.querySelector('.adm-modal');
      if (box) {
        box.style.display = 'block';
        box.style.visibility = 'visible';
        box.style.opacity = '1';
      }
      // re-append as last child so it’s above any z-index stacks
      document.body.appendChild(ov);
    }

    // 2) Show overlay immediately (prevent “dim only” symptom)
    ov.style.display = 'block';
    try { showOverlay(ov, triggerEl); } catch (e) {
      console.error('[AddonModal] showOverlay threw:', e);
      ov.style.display = 'block'; // fallback keep-visible
    }

    // 3) Refs + self-diagnostics
    const list = ov.querySelector('#assignAddonList');
    const saveBtn = ov.querySelector('#assignAddonSave');
    const cancelBtn = ov.querySelector('#assignAddonCancel');
    const box = ov.querySelector('.adm-modal');
    try {
      const r = box?.getBoundingClientRect?.();
      if (!box || !r || r.width < 10 || r.height < 10) {
        console.warn('[AddonModal] Box not visible; rect:', r, 'styles:', box && getComputedStyle(box));
      }
    } catch (e) {
      console.warn('[AddonModal] Could not inspect box rect:', e);
    }

    // 4) Normalize current selection (supports legacy strings or {name, price})
    const currentSet = new Set(
      (Array.isArray(current) ? current : [])
        .map(a => (typeof a === 'string' ? a : a?.name))
        .filter(Boolean)
    );

    // 5) Load available add-ons and hydrate UI (resilient)
    let addons = [];
    try {
      addons = await fetchAddons(); // [{name, price}, ...]
    } catch (e) {
      console.error('[AddonModal] fetchAddons failed:', e);
      addons = [];
    }

    if (!addons.length) {
      list.innerHTML = `<div class="adm-muted">(No add-ons found)</div>`;
    } else {
      list.innerHTML = addons.map(a => {
        const checked = currentSet.has(a.name) ? 'checked' : '';
        return `<label class="adm-list-row">
                  <input type="checkbox" value="${a.name}" data-price="${a.price}" ${checked}/>
                  <span>${a.name} (₹${a.price})</span>
                </label>`;
      }).join('');
    }

    // 6) Wire buttons (overwrite each open)
    cancelBtn.onclick = () => closeOverlay(ov);
    saveBtn.onclick = async () => {
      try {
        saveBtn.disabled = true;

        // Build chosen array as objects, preserving {name, price}
        const chosen = addons
          .filter(a => list.querySelector(`input[value="${a.name}"]`)?.checked)
          .map(a => ({ name: a.name, price: Number(a.price || 0) }));

        console.log('[AddonModal] save', { itemId, chosen });

        await updateDoc(doc(db, 'menuItems', itemId), {
          addons: chosen,
          updatedAt: serverTimestamp(),
        });

        closeOverlay(ov);
      } catch (err) {
        console.error('[AddonModal] save failed:', err);
        alert('Failed to assign add-ons: ' + (err?.message || err));
      } finally {
        saveBtn.disabled = false;
      }
    };
  } catch (err) {
    console.error('[AddonModal] open failed (outer):', err);
    alert('Could not open Assign Add-ons: ' + (err?.message || err));
  }
}


/* =========================
   [Edit] — Single Item Edit Modal (row action) — hardened visible-first
   ========================= */
async function openEditItemModal(id, data, triggerEl) {
  try {
    ensureModalStyles();

    // (1) Create/get overlay
    let ov = document.getElementById("editItemModal");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "editItemModal";
      ov.className = "adm-overlay";
      ov.innerHTML = `
        <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="eiTitle" style="display:block;visibility:visible;opacity:1">
          <h3 id="eiTitle" style="margin:0 0 12px">Edit Menu Item</h3>

          <div class="adm-row" style="gap:8px; flex-wrap:wrap">
            <input id="eiName"  class="adm-input" placeholder="Name" style="flex:1; min-width:240px" />
            <input id="eiDesc"  class="adm-input" placeholder="Description" style="flex:1; min-width:240px" />
          </div>

          <div class="adm-row" style="gap:8px; flex-wrap:wrap; margin-top:8px">
            <select id="eiCat"    class="adm-select" style="min-width:220px"></select>
            <select id="eiCourse" class="adm-select" style="min-width:220px"></select>
            <select id="eiFood"   class="adm-select" style="min-width:160px">
              <option value="">-- Food Type --</option>
              <option value="Veg">Veg</option>
              <option value="Non-Veg">Non-Veg</option>
            </select>
          </div>

          <div class="adm-row" style="gap:8px; flex-wrap:wrap; margin-top:8px">
            <select id="eiQtyType" class="adm-select" style="min-width:220px">
              <option value="">-- Quantity Type --</option>
              <option value="Not Applicable">Not Applicable</option>
              <option value="Half & Full">Half & Full</option>
            </select>

            <input type="number" id="eiItemPrice" class="adm-input" placeholder="Price"
                   style="width:160px; display:none;" />

            <input type="number" id="eiHalfPrice" class="adm-input" placeholder="Half Price"
                   style="width:160px; display:none;" />
            <input type="number" id="eiFullPrice" class="adm-input" placeholder="Full Price"
                   style="width:160px; display:none;" />
          </div>

          <div class="adm-row" style="gap:8px; margin-top:8px; align-items:center">
            <input type="file" id="eiImage" class="adm-file" accept="image/*" />
            <span class="adm-muted">Optional: choose to replace image (auto 200×200)</span>
          </div>

          <div class="adm-row" style="gap:8px; justify-content:flex-end; margin-top:12px">
            <button id="eiSave"   class="adm-btn adm-btn--primary">Save</button>
            <button id="eiCancel" class="adm-btn">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
    } else {
      // Ensure the modal box itself is forced visible even if a stylesheet hid it
      const box = ov.querySelector(".adm-modal");
      if (box) {
        box.style.display = "block";
        box.style.visibility = "visible";
        box.style.opacity = "1";
      }
      // Always move overlay to the end of <body> so it sits on top of any z-index stacks
      if (ov.parentNode !== document.body) document.body.appendChild(ov);
      else document.body.appendChild(ov); // re-append to become last child
    }

    // (2) Show overlay immediately (and force its visibility too)
    ov.style.display = "block"; // bypass any CSS collisions on overlay
    try { showOverlay(ov, triggerEl); } catch (e) {
      console.error("[EditModal] showOverlay threw:", e);
      // Fallback: still keep it visible without animation
      ov.style.display = "block";
    }

    // (3) Refs
    const $ = (sel) => ov.querySelector(sel);
    const box         = $(".adm-modal");
    const eiName      = $("#eiName");
    const eiDesc      = $("#eiDesc");
    const eiCat       = $("#eiCat");
    const eiCourse    = $("#eiCourse");
    const eiFood      = $("#eiFood");
    const eiQtyType   = $("#eiQtyType");
    const eiItemPrice = $("#eiItemPrice");
    const eiHalfPrice = $("#eiHalfPrice");
    const eiFullPrice = $("#eiFullPrice");
    const eiImage     = $("#eiImage");
    const eiSave      = $("#eiSave");
    const eiCancel    = $("#eiCancel");

    // Self-diagnostics if box isn't visible
    try {
      const r = box?.getBoundingClientRect?.();
      if (!box || !r || r.width < 10 || r.height < 10) {
        console.warn("[EditModal] Box not visible; rect:", r, "styles:", box && getComputedStyle(box));
      }
    } catch (e) {
      console.warn("[EditModal] Could not inspect box rect:", e);
    }

    // (4) Helper: ensure option exists before selecting
    function setIfPresent(selectEl, value) {
      if (!selectEl) return;
      if (value && ![...selectEl.options].some(o => o.value === value)) {
        const o = document.createElement("option");
        o.value = value; o.textContent = value;
        selectEl.appendChild(o);
      }
      selectEl.value = value || "";
    }

    // (5) Populate dropdowns (resilient)
    try {
      eiCat.innerHTML    = `<option value="">-- Select Category --</option>`;
      eiCourse.innerHTML = `<option value="">-- Select Food Course --</option>`;
      const [cats, courses] = await Promise.all([
        fetchCategories().catch(() => []),
        fetchCourses().catch(() => [])
      ]);
      if (Array.isArray(cats) && cats.length)    eiCat.innerHTML    += cats.map(c => `<option>${c}</option>`).join("");
      if (Array.isArray(courses) && courses.length) eiCourse.innerHTML += courses.map(c => `<option>${c}</option>`).join("");
    } catch (err) {
      console.error("[EditModal] dropdowns load failed:", err);
    }

    // (6) Hydrate values
    const d  = data || {};
    const qt = (d.qtyType && d.qtyType.type) || "";

    eiName.value = d.name || "";
    eiDesc.value = d.description || "";
    setIfPresent(eiCat,    d.category || "");
    setIfPresent(eiCourse, d.foodCourse || "");
    setIfPresent(eiFood,   d.foodType || "");
    setIfPresent(eiQtyType, qt);

    function refreshPriceVis() {
      const v = eiQtyType.value;
      const hf = v === "Half & Full";
      eiItemPrice.style.display = v === "Not Applicable" ? "inline-block" : "none";
      eiHalfPrice.style.display = hf ? "inline-block" : "none";
      eiFullPrice.style.display = hf ? "inline-block" : "none";
    }
    eiQtyType.onchange = refreshPriceVis;
    refreshPriceVis();

    if (qt === "Not Applicable") {
      eiItemPrice.value = Number(d.qtyType?.itemPrice || 0) || "";
    } else if (qt === "Half & Full") {
      eiHalfPrice.value = Number(d.qtyType?.halfPrice || 0) || "";
      eiFullPrice.value = Number(d.qtyType?.fullPrice || 0) || "";
    } else {
      eiItemPrice.value = "";
      eiHalfPrice.value = "";
      eiFullPrice.value = "";
    }

    // (7) Buttons (overwrite each open)
    eiCancel.onclick = () => closeOverlay(ov);
    eiSave.onclick = async () => {
      try {
        eiSave.disabled = true;

        const name        = (eiName.value || "").trim();
        const description = (eiDesc.value || "").trim();
        const category    = eiCat.value || "";
        const foodCourse  = eiCourse.value || "";
        const foodType    = eiFood.value || "";
        const qtyTypeSel  = eiQtyType.value || "";

        if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeSel) { alert("Fill all required fields"); return; }

        let qtyType = {};
        if (qtyTypeSel === "Not Applicable") {
          const p = Number(eiItemPrice.value);
          if (!Number.isFinite(p) || p <= 0) { alert("Invalid price"); return; }
          qtyType = { type: qtyTypeSel, itemPrice: p };
        } else if (qtyTypeSel === "Half & Full") {
          const h = Number(eiHalfPrice.value), f = Number(eiFullPrice.value);
          if (!Number.isFinite(h) || !Number.isFinite(f) || h <= 0 || f <= 0) { alert("Invalid Half/Full price"); return; }
          qtyType = { type: qtyTypeSel, halfPrice: h, fullPrice: f };
        } else { alert("Select a valid quantity type"); return; }

        const updates = { name, description, category, foodCourse, foodType, qtyType, updatedAt: serverTimestamp() };

        // Optional image replacement only if chosen
        const file = eiImage.files && eiImage.files[0];
        if (file) {
          const blob = await resizeImage(file);
          const imageRef = ref(storage, `menuImages/${Date.now()}_${file.name}`);
          await uploadBytes(imageRef, blob);
          const url = await getDownloadURL(imageRef);
          updates.imageUrl = url;
        }

        await updateDoc(doc(db, "menuItems", id), updates);
        closeOverlay(ov);
      } catch (err) {
        console.error("[EditModal] save failed:", err);
        alert("Save failed: " + (err?.message || err));
      } finally {
        eiSave.disabled = false;
      }
    };
  } catch (err) {
    console.error("[EditModal] open failed (outer):", err);
    alert("Could not open Edit dialog: " + (err?.message || err));
  }
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
if (open) {
  showPopover(catPanel, catBtn);
  const close = (ev) => {
    if (!catPanel.contains(ev.target) && ev.target !== catBtn) {
      catPanel.classList.remove('adm-anim-in');
      catPanel.classList.add('adm-anim-out');
      setTimeout(() => {
        catPanel.style.display = 'none';
        document.removeEventListener('mousedown', close);
      }, 160);
    }
  };
  document.addEventListener('mousedown', close);
}
};
   
  catPanel.onclick = async e => {
  const row = e.target.closest('.adm-list-row');
  if (!row) return;
  const role = e.target.getAttribute('data-role');
  const oldName = row.getAttribute('data-name');

  if (role === 'select') {
    setHiddenValue(categoryDropdown, oldName);
    catBtn.textContent = `${oldName} ▾`;
    catPanel.style.display = 'none';
    return;
  }

  if (role === 'edit') {
    const labelEl = row.querySelector('[data-role="label"]');
    if (!labelEl) return;
    const cur = labelEl.textContent;
    labelEl.innerHTML = `<input type="text" class="adm-input" value="${cur}" style="min-width:160px" />`;
    row.classList.add('is-editing');
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
  const labelEl = row.querySelector('[data-role="label"]');
  if (labelEl) labelEl.textContent = oldName;   // always revert
  row.classList.remove('is-editing');
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
let snap;
try { snap = await getDocs(qref); }
catch (e) {
  console.error('[Categories] query failed', e);
  alert('Could not load category docs (permissions or network).');
  return;
}
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

  // Open/close the popover
   
  courseBtn.onclick = (e) => {
  e.stopPropagation();
  const open = coursePanel.style.display !== 'block';
  coursePanel.style.display = open ? 'block' : 'none';

  if (open) {
    showPopover(coursePanel, courseBtn);
    const close = (ev) => {
      if (!coursePanel.contains(ev.target) && ev.target !== courseBtn) {
        coursePanel.classList.remove('adm-anim-in');
        coursePanel.classList.add('adm-anim-out');
        setTimeout(() => {
          coursePanel.style.display = 'none';
          document.removeEventListener('mousedown', close);
        }, 160);
      }
    };
    document.addEventListener('mousedown', close);
  }
};


  // Single delegated handler for row actions
   
  coursePanel.onclick = async (ev) => {
    const row  = ev.target.closest('.adm-list-row');
    if (!row) return;

    const role = ev.target.getAttribute('data-role');
    const oldName = row.getAttribute('data-name');

    if (role === 'select') {
      setHiddenValue(foodCourseDropdown, oldName);
      courseBtn.textContent = `${oldName} ▾`;
      coursePanel.style.display = 'none';
      return;
    }

    if (role === 'edit') {
      const labelEl = row.querySelector('[data-role="label"]');
      const cur = labelEl?.textContent || oldName;
      labelEl.innerHTML = `<input type="text" class="adm-input" value="${cur}" style="min-width:160px" />`;
      row.classList.add('is-editing');

      // hide edit/delete icons; add ✓/✕ inline
      row.querySelector('[data-role="edit"]').style.display   = 'none';
      row.querySelector('[data-role="delete"]').style.display = 'none';

      const saveBtn = document.createElement('span');
      saveBtn.className = 'adm-icon';
      saveBtn.setAttribute('data-role', 'save');
      saveBtn.setAttribute('aria-label', 'Save');
      saveBtn.title = 'Save';
      saveBtn.textContent = '✓';

      const cancelBtn = document.createElement('span');
      cancelBtn.className = 'adm-icon';
      cancelBtn.setAttribute('data-role', 'cancel');
      cancelBtn.setAttribute('aria-label', 'Cancel');
      cancelBtn.title = 'Cancel';
      cancelBtn.textContent = '✕';

      row.appendChild(saveBtn);
      row.appendChild(cancelBtn);
      return;
    }

    if (role === 'cancel') {
      const labelEl = row.querySelector('[data-role="label"]');
      if (labelEl) labelEl.textContent = oldName;
      row.classList.remove('is-editing');
      row.querySelector('[data-role="edit"]').style.display   = '';
      row.querySelector('[data-role="delete"]').style.display = '';
      row.querySelector('[data-role="save"]')?.remove();
      row.querySelector('[data-role="cancel"]')?.remove();
      return;
    }

    if (role === 'save') {
      const input = row.querySelector('input.adm-input');
      const newName = (input?.value || '').trim();
      if (!newName) return alert('Enter a name');

      try {
        const q = query(collection(db, "menuCourses"), where("name", "==", oldName));
        const snap = await getDocs(q);
        const ops = [];
        snap.forEach(d => ops.push(updateDoc(doc(db, "menuCourses", d.id), { name: newName })));
        await Promise.all(ops);

        row.setAttribute('data-name', newName);
        const labelEl = row.querySelector('[data-role="label"]');
        if (labelEl) labelEl.textContent = newName;

        row.classList.remove('is-editing');
        row.querySelector('[data-role="edit"]').style.display   = '';
        row.querySelector('[data-role="delete"]').style.display = '';
        row.querySelector('[data-role="save"]')?.remove();
        row.querySelector('[data-role="cancel"]')?.remove();

        setHiddenValue(foodCourseDropdown, newName);
        courseBtn.textContent = `${newName} ▾`;
      } catch (e) {
        console.error(e);
        alert('Rename failed');
      }
      return;
    }

    if (role === 'delete') {
      if (!confirm(`Delete course "${oldName}"?`)) return;
      try {
        const q = query(collection(db, "menuCourses"), where("name", "==", oldName));
        const snap = await getDocs(q);
        const ops = [];
        snap.forEach(d => ops.push(deleteDoc(doc(db, "menuCourses", d.id))));
        await Promise.all(ops);

        if (foodCourseDropdown?.value === oldName) {
          setHiddenValue(foodCourseDropdown, "");
          courseBtn.textContent = `Select Course ▾`;
        }
        row.remove();
      } catch (e) {
        console.error(e);
        alert('Delete failed');
      }
      return;
    }
  };
}



/* =========================
   Add-ons (custom multi)
   ========================= */
async function renderCustomAddonDropdown() {
  if (!addonBtn || !addonPanel) return;

  const addons = await fetchAddons();
  const selected = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o => o.value));

  addonPanel.innerHTML = addons.map(a => `
    <div class="adm-list-row" data-name="${a.name}" data-price="${a.price}">
      <label style="display:flex; gap:8px; align-items:center; margin:0; flex:1;">
        <input type="checkbox" value="${a.name}" ${selected.has(a.name) ? 'checked' : ''}/>
        <span class="_name" data-role="label">${a.name} (₹${a.price})</span>
      </label>
      <span class="adm-icon" data-role="edit"   aria-label="Edit"   title="Edit">🖉</span>
      <span class="adm-icon" data-role="delete" aria-label="Delete" title="Delete">🗑</span>
    </div>`).join('');

  // Open/close popover (NO body scroll lock here)
   
  addonBtn.onclick = (e) => {
  e.stopPropagation();
  const open = addonPanel.style.display !== "block";
  addonPanel.style.display = open ? "block" : "none";

  if (open) {
    showPopover(addonPanel, addonBtn);
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

  // Checkbox → selection sync
  addonPanel.onchange = () => {
    const values = Array.from(addonPanel.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
    setMultiHiddenValue(addonsSelect, values);
    updateAddonBtnLabel();
  };

  // Delegated row actions
  addonPanel.onclick = async e => {
    const row = e.target.closest('.adm-list-row');
    if (!row) return;
    const role = e.target.getAttribute('data-role');

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

      row.querySelector('[data-role="cancel"]').onclick = () => {
        renderCustomAddonDropdown();
      };
      return;
    }

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

  // ensure trigger label matches selection
  updateAddonBtnLabel();
}


function bootAdminUI(){
  if (window.__ADMIN_BOOTED__) return;
  window.__ADMIN_BOOTED__ = true;

  console.log("[DEBUG] bootAdminUI start");
  ensureModalStyles();

  if (document.getElementById("menuTable")) {
    ensureBulkBar();
    updateBulkBar();
    console.log("[DEBUG] bulk bar ensured & updated");
  } else {
    console.warn("[DEBUG] #menuTable not found at boot");
  }

  if (document.getElementById("categoryDropdownBtn")) { renderCustomCategoryDropdown(); console.log("[DEBUG] category custom dropdown wired"); }
  if (document.getElementById("courseDropdownBtn"))   { renderCustomCourseDropdown();   console.log("[DEBUG] course custom dropdown wired"); }
  if (document.getElementById("addonDropdownBtn"))    { renderCustomAddonDropdown();    console.log("[DEBUG] addon custom dropdown wired"); }

  console.log("[DEBUG] bootAdminUI done");
}


// Run once, after DOM is ready if needed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootAdminUI, { once: true });
} else {
  bootAdminUI();
}

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
  // 1) Update master records in menuAddons (match by 'name')
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
