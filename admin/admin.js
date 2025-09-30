
/* =========================
   Helpers (centralized)
   ========================= */
function debounce(fn, wait = 250) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), wait); };
}

// Scroll lock via body class (simple & reliable)
function lockBodyScroll(){ document.body.classList.add('adm-lock'); }
function unlockBodyScroll(){ document.body.classList.remove('adm-lock'); }

// ===== Modal base styles (one-time) & helpers =====
function ensureModalStyles() {
  if (document.getElementById("admModalStyles")) return;

  const css = `
    .adm-lock { overflow: hidden; }
    .adm-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,.55);
      display: none; /* shown per open */
    }
    .adm-modal {
      background: #fff; color: #111;
      border-radius: 12px;
      max-width: 720px; width: min(720px, 92vw);
      margin: 6vh auto 0;
      padding: 16px;
      box-shadow: 0 14px 40px rgba(0,0,0,.25);
      transform-origin: var(--adm-origin, 50% 0%);
    }
    @keyframes admGenieIn {
      from { opacity: 0; transform: translate(var(--adm-dx,0), var(--adm-dy,0)) scale(.96); }
      to   { opacity: 1; transform: translate(0,0) scale(1); }
    }
    @keyframes admGenieOut {
      from { opacity: 1; transform: translate(0,0) scale(1); }
      to   { opacity: 0; transform: translate(var(--adm-dx,0), var(--adm-dy,0)) scale(.96); }
    }
    .adm-anim-in  { animation: admGenieIn 220ms ease-out both; }
    .adm-anim-out { animation: admGenieOut 180ms ease-in both; }

    .adm-btn{border:1px solid #ddd;border-radius:8px;padding:8px 12px;background:#fff;cursor:pointer}
    .adm-btn--primary{background:#111;color:#fff;border-color:#111}
    .adm-muted{color:#777}
    .adm-pill{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #ddd;font-size:12px}
    .adm-pill--dining{background:#f3fff3;border-color:#bde0bd}
    .adm-pill--delivery{background:#f3f7ff;border-color:#bed2ff}
  `;
  const style = document.createElement("style");
  style.id = "admModalStyles";
  style.textContent = css;
  document.head.appendChild(style);
}

// origin “genie” offset from a trigger button (optional nicety)
function setGenieFrom(triggerEl, overlayEl, modalEl) {
  try {
    if (!triggerEl || !overlayEl || !modalEl) return;
    const r = triggerEl.getBoundingClientRect();
    const cx = r.left + r.width/2;
    const vw = Math.max(1, window.innerWidth);
    modalEl.style.setProperty("--adm-origin", `${(cx/vw)*100}% 0%`);% 0%`);
    modalEl.style.setProperty("--adm-dx", "0px");
    modalEl.style.setProperty("--adm-dy", "6px");
  } catch {}
}

// Hidden value helpers for our native <select>s
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

/*
  ADMIN.JS — CLEAN FULL REWRITE (PART 1 of 3)
  -----------------------------------------------------------
  Goals:
  - Preserve ALL features (Auth, Categories, Courses, Add-ons, CRUD, Image resize/upload,
    Filters, Search, Promotions, Bulk Edit/Delete/Promos/Add-ons, Slide & Function buttons,
    Comic/Genie popovers, Assign modals).
  - Fix broken lines & duplicates; centralize helpers; consistent modal animation.
  - Keep API contracts with categoryCourse.js and promotions.js intact.

  Notes:
  - This file is structured in sections with clear headers.
  - "Genie" animations and overlay helpers are centralized.
  - Bulk actions include two extra buttons: Slide & Function (placeholders wired to demo flows).
  - Add-ons stored as array of {name, price}. Promotions stored as array of ids.

  PARTS:
  - Part 1 (this): Imports, DOM, State, Helpers, Auth, Create Item, Snapshot + Render, Bulk Bar.
  - Part 2: Bulk Edit Modal, Bulk Promos Modal, Bulk Add-ons Modal, Assign Modals.
  - Part 3: Comic dropdowns (Category/Course/Add-on), Filters/Search, Edit Item modal.

  You can paste Parts 1–3 sequentially into a single file (admin.js).
*/

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

import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import {
  // from categoryCourse.js
  loadCategories, loadCourses,
  fetchCategories, fetchCourses,
  addCategory, addCourse,
  renameCategoryEverywhere, renameCourseEverywhere,
  deleteCategoryEverywhere, deleteCourseEverywhere,
  // add-ons
  loadAddons, fetchAddons, addAddon,
  renameAddonEverywhere, deleteAddonEverywhere,
} from "./categoryCourse.js";

import { initPromotions } from "./promotions.js";

/* =========================
   Promo cache (for chips in menu table)
   ========================= */
let PROMOS_BY_ID = {}; // { promoId: {code, channel, type, value, ...} }

/* =========================
   DOM
   ========================= */
const loginBox = document.getElementById("loginBox");
const adminContent = document.getElementById("adminContent");
const email = document.getElementById("email");
const password = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginStatus = document.getElementById("loginStatus");

const form = document.getElementById("menuForm");
const statusMsg = document.getElementById("statusMsg");
const menuBody = document.getElementById("menuBody");

const itemName = document.getElementById("itemName");
const itemDescription = document.getElementById("itemDescription");
const itemImage = document.getElementById("itemImage");

const itemPrice = document.getElementById("itemPrice");
const halfPrice = document.getElementById("halfPrice");
const fullPrice = document.getElementById("fullPrice");
const qtyTypeSelect = document.getElementById("qtyType");

const categoryDropdown = document.getElementById("itemCategory");
const newCategoryInput = document.getElementById("newCategoryInput");
const addCategoryBtn = document.getElementById("addCategoryBtn");

const foodCourseDropdown = document.getElementById("foodCourse");
const newCourseInput = document.getElementById("newCourseInput");
const addCourseBtn = document.getElementById("addCourseBtn");

const foodTypeSelect = document.getElementById("foodType");

// Add-ons (hidden multi-select + custom dropdown)
const addonsSelect = document.getElementById("addonsSelect");
const newAddonInput = document.getElementById("newAddonInput");
const newAddonPrice = document.getElementById("newAddonPrice");
const addAddonBtn = document.getElementById("addAddonBtn");
const addonBtn = document.getElementById("addonDropdownBtn");
const addonPanel = document.getElementById("addonDropdownPanel");

// Custom dropdown DOM for Category/Course
const catBtn = document.getElementById("categoryDropdownBtn");
const catPanel = document.getElementById("categoryDropdownPanel");
const courseBtn = document.getElementById("courseDropdownBtn");
const coursePanel = document.getElementById("courseDropdownPanel");

// Filters/search
const searchInput = document.getElementById("searchInput");
const filterCategory = document.getElementById("filterCategory");
const filterCourse = document.getElementById("filterCourse");
const filterType = document.getElementById("filterType");

// Edit modal
const editModal = document.getElementById("editModal");
const editForm = document.getElementById("editForm");
const closeEditModalBtn = document.getElementById("closeEditModal");
const editName = document.getElementById("editName");
const editDescription = document.getElementById("editDescription");
const editCategory = document.getElementById("editCategory");
const editCourse = document.getElementById("editCourse");
const editType = document.getElementById("editType");
const editQtyType = document.getElementById("editQtyType");
const editItemPrice = document.getElementById("editItemPrice");
const editHalfPrice = document.getElementById("editHalfPrice");
const editFullPrice = document.getElementById("editFullPrice");

/* =========================
   State
   ========================= */
let allItems = []; // [{id, data}]
let selectedIds = new Set();
let editingId = null;


/* =========================
   Helpers (centralized)
   ========================= */
;
}

// Scroll lock via body class (simple & reliable)
// ===== Modal base styles (one-time) & helpers =====
to   { opacity: 1; transform: translate(0,0) scale(1); }
    }
    @keyframes admGenieOut {
      from { opacity: 1; transform: translate(0,0) scale(1); }
      to   { opacity: 0; transform: translate(var(--adm-dx,0), var(--adm-dy,0)) scale(.96); }
    }







  `;
  const style = document.createElement("style");
  style.id = "admModalStyles";
  style.textContent = css;
  document.head.appendChild(style);
}

// origin “genie” offset from a trigger button (optional nicety)
modalEl.style.setProperty("--adm-dx", "0px");
    modalEl.style.setProperty("--adm-dy", "6px");
  } catch {}
}

// Hidden value helpers for our native <select>s
selectEl.value = val || "";
  selectEl.dispatchEvent(new Event("change"));
}

);
  selectEl.dispatchEvent(new Event("change"));
}


/* =========================
   Auth
   ========================= */
if (loginBtn) {
  loginBtn.setAttribute("type", "button"); // avoid implicit form submit
  loginBtn.onclick = (e) => {
    e?.preventDefault?.();
    const em = (email?.value || "").trim();
    const pw = (password?.value || "");
    if (!em || !pw) { alert("Please enter both email and password."); return; }

    loginBtn.disabled = true;
    loginBtn.setAttribute("aria-busy", "true");
    const oldLabel = loginBtn.textContent;
    loginBtn.textContent = "Signing in…";
    if (loginStatus) loginStatus.textContent = `Attempting login for ${em}…`;

    console.debug("[Auth] attempting login:", em);
    signInWithEmailAndPassword(auth, em, pw)
      .then(() => {
        console.debug("[Auth] login success:", em);
        if (loginStatus) loginStatus.textContent = "Login successful.";
        if (email) email.value = "";
        if (password) password.value = "";
      })
      .catch(err => {
        console.error("[Auth] login failed:", err?.code, err?.message);
        const msg = `Login failed: ${err?.code || ""} ${err?.message || ""}`.trim();
        if (loginStatus) loginStatus.textContent = msg; alert(msg);
      })
      .finally(() => {
        loginBtn.disabled = false; loginBtn.removeAttribute("aria-busy"); loginBtn.textContent = oldLabel;
      });
  };
}
if (logoutBtn) { logoutBtn.onclick = () => signOut(auth); }

onAuthStateChanged(auth, async (user) => {
  console.debug("[Auth] state changed:", user ? "signed-in" : "signed-out", user?.uid || "");
  if (user) {
    if (loginBox) loginBox.style.display = "none";
    if (adminContent) adminContent.style.display = "block";

    // Load data sources for create form
    await loadCategories(categoryDropdown);
    await loadCourses(foodCourseDropdown);
    await loadAddons(addonsSelect);

    // Custom dropdowns
    await renderCustomCategoryDropdown();
    await renderCustomCourseDropdown();
    await renderCustomAddonDropdown();

    // Filters
    await populateFilterDropdowns();
    wireSearchAndFilters();

    // Always attach menu listener FIRST so items render even if Promotions fails
    attachSnapshot();

    // Live coupon map for chips
    onSnapshot(
      collection(db, "promotions"),
      (snap) => {
        const map = {}; snap.forEach((d) => { const p = d.data(); if (p?.kind === "coupon") map[d.id] = p; });
        PROMOS_BY_ID = map; renderTable();
      },
      (err) => { console.error("promotions snapshot error", err?.code, err?.message); PROMOS_BY_ID = {}; renderTable(); }
    );

    // Promotions UI — guarded so it can’t break the rest
    try { initPromotions(); } catch (e) { console.error("Promotions init failed — continuing:", e); }

  } else {
    if (loginBox) loginBox.style.display = "block";
    if (adminContent) adminContent.style.display = "none";
  }
});

/* =========================
   Pricing toggle (create form)
   ========================= */
if (qtyTypeSelect) {
  qtyTypeSelect.onchange = () => {
    const value = qtyTypeSelect.value;
    if (itemPrice) itemPrice.style.display = value === "Not Applicable" ? "block" : "none";
    const showHF = value === "Half & Full";
    if (halfPrice) halfPrice.style.display = showHF ? "block" : "none";
    if (fullPrice) fullPrice.style.display = showHF ? "block" : "none";
  };
}

/* =========================
   Add Category/Course/Add-on (create form)
   ========================= */
if (addCategoryBtn) {
  addCategoryBtn.onclick = async () => {
    await addCategory(newCategoryInput, () => loadCategories(categoryDropdown));
    await renderCustomCategoryDropdown();
    await populateFilterDropdowns();
  };
}
if (addCourseBtn) {
  addCourseBtn.onclick = async () => {
    await addCourse(newCourseInput, () => loadCourses(foodCourseDropdown));
    await renderCustomCourseDropdown();
    await populateFilterDropdowns();
  };
}
if (addAddonBtn) {
  addAddonBtn.onclick = async () => {
    await addAddon(newAddonInput, newAddonPrice, () => loadAddons(addonsSelect));
    await renderCustomAddonDropdown();
  };
}

/* =========================
   Image resize (menu item) 200x200 JPEG
   ========================= */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 200;
        const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, 200, 200);
        canvas.toBlob(resolve, "image/jpeg", 0.8);
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

/* =========================
   Create item
   ========================= */
if (form) {
  form.onsubmit = async (e) => {
    e.preventDefault(); if (statusMsg) statusMsg.innerText = "Adding...";

    const name = (itemName?.value || "").trim();
    const description = (itemDescription?.value || "").trim();
    const category = categoryDropdown?.value;
    const foodCourse = foodCourseDropdown?.value;
    const foodType = foodTypeSelect?.value;
    const qtyTypeValue = qtyTypeSelect?.value;
    const imageFile = itemImage?.files?.[0];

    // Add-ons: store [{name, price}]
    const addonNames = Array.from(addonsSelect?.selectedOptions || []).map(o => o.value);
    const addons = await Promise.all(addonNames.map(async (nm) => {
      const snap = await getDoc(doc(db, "menuAddons", nm));
      const v = snap.exists() ? snap.data() : { name: nm, price: 0 };
      return { name: v.name || nm, price: Number(v.price || 0) };
    }));

    if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeValue || !imageFile) {
      if (statusMsg) statusMsg.innerText = "❌ Fill all fields"; return;
    }

    let qtyType = {};
    if (qtyTypeValue === "Not Applicable") {
      const price = parseFloat(itemPrice?.value);
      if (isNaN(price) || price <= 0) { if (statusMsg) statusMsg.innerText = "❌ Invalid price"; return; }
      qtyType = { type: qtyTypeValue, itemPrice: price };
    } else if (qtyTypeValue === "Half & Full") {
      const half = parseFloat(halfPrice?.value), full = parseFloat(fullPrice?.value);
      if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) { if (statusMsg) statusMsg.innerText = "❌ Invalid Half/Full price"; return; }
      qtyType = { type: qtyTypeValue, halfPrice: half, fullPrice: full };
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

      form.reset(); qtyTypeSelect?.dispatchEvent(new Event("change"));
      setMultiHiddenValue(addonsSelect, []); updateAddonBtnLabel();
      if (statusMsg) statusMsg.innerText = "✅ Added!";
    } catch (err) {
      console.error(err); if (statusMsg) statusMsg.innerText = "❌ Error: " + (err?.message || err);
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
      allItems = []; snapshot.forEach((docSnap) => allItems.push({ id: docSnap.id, data: docSnap.data() }));
      ensureSelectAllHeader(); renderTable(); updateBulkBar();
    },
    (err) => {
      console.error("menuItems snapshot error", err?.code, err?.message);
      allItems = []; ensureSelectAllHeader(); renderTable(); updateBulkBar();
    }
  );
}

function ensureSelectAllHeader() {
  const thead = document.querySelector("#menuTable thead tr"); if (!thead) return;
  if (!thead.querySelector("#selectAll")) {
    const th = document.createElement("th"); th.innerHTML = `<input type="checkbox" id="selectAll" title="Select all" />`;
    thead.insertBefore(th, thead.firstElementChild);
    const allCb = document.getElementById("selectAll");
    if (allCb) allCb.onchange = (e) => {
      const checked = e.target.checked;
      if (checked) selectedIds = new Set(allItems.map((i) => i.id)); else selectedIds.clear();
      renderTable(); updateBulkBar();
    };
  }
}

function renderTable() {
  if (!menuBody) return; menuBody.innerHTML = "";
  const items = applyFilters(allItems);

  items.forEach(({ id, data: d }) => {
    const qty = d.qtyType || {};
    const priceText =
      qty.type === "Half & Full" ? `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}` : `₹${qty.itemPrice}`;

    const addonsText = Array.isArray(d.addons)
      ? d.addons.map(a => (typeof a === "string" ? a : `${a.name} (₹${a.price})`)).join(", ")
      : "";

    // Promo chips
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
        <button class="addonBtn" data-id="${id}">Add-On</button>
        <button class="promoBtn" data-id="${id}">Promotions</button>
        <button class="editBtn" data-id="${id}">Edit</button>
        <button class="deleteBtn" data-id="${id}">Delete</button>
      </td>
    `;
    menuBody.appendChild(row);
  });

  // Row select
  document.querySelectorAll(".rowSelect").forEach((cb) => {
    cb.onchange = (e) => {
      const id = e.target.dataset.id; if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkBar(); syncSelectAllHeader(items);
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
      const id = el.dataset.id; if (confirm("Delete this item?")) { await deleteDoc(doc(db, "menuItems", id)); selectedIds.delete(id); updateBulkBar(); }
    };
  });

  // Edit
  document.querySelectorAll(".editBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id; const snap = await getDoc(doc(db, "menuItems", id)); if (!snap.exists()) return alert("Item not found!");
      openEditModal(id, snap.data());
    };
  });

  // Add-ons assign
  document.querySelectorAll(".addonBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id; const snap = await getDoc(doc(db, "menuItems", id)); if (!snap.exists()) return alert("Item not found!");
      openAssignAddonsModal(id, Array.isArray(snap.data().addons) ? snap.data().addons : []);
    };
  });

  // Promotions assign
  document.querySelectorAll(".promoBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id; const snap = await getDoc(doc(db, "menuItems", id)); if (!snap.exists()) return alert("Item not found!");
      openAssignPromotionsModal(id, Array.isArray(snap.data().promotions) ? snap.data().promotions : []);
    };
  });

  // Header select-all sync
  syncSelectAllHeader(items);
}

function updateBulkBar() {
  ensureBulkBar();
  const n = selectedIds.size;
  const editBtn   = document.getElementById("bulkEditBtn");
  const delBtn    = document.getElementById("bulkDeleteBtn");
  const promosBtn = document.getElementById("bulkPromosBulkBtn");
  const addonsBtn = document.getElementById("bulkAddonsBulkBtn");
  if (editBtn)   { editBtn.textContent   = `Edit Selected (${n})`;   editBtn.disabled   = n === 0; }
  if (delBtn)    { delBtn.textContent    = `Delete Selected (${n})`; delBtn.disabled    = n === 0; }
  if (promosBtn) { promosBtn.disabled    = n === 0; }
  if (addonsBtn) { addonsBtn.disabled    = n === 0; }
})`; editBtn.disabled   = n === 0; }
  if (delBtn)    { delBtn.textContent    = `Delete Selected (${n})`; delBtn.disabled  = n === 0; }
  if (promosBtn) { promosBtn.disabled    = n === 0; }
  if (addonsBtn) { addonsBtn.disabled    = n === 0; }
}

function syncSelectAllHeader(itemsRendered) {
  const cb = document.getElementById("selectAll"); if (!cb) return;
  if (!itemsRendered.length) { cb.checked = false; cb.indeterminate = false; return; }
  const total = itemsRendered.length; let selected = 0; for (const { id } of itemsRendered) if (selectedIds.has(id)) selected++;
  cb.checked = selected === total; cb.indeterminate = selected > 0 && selected < total;
}

function ensureBulkBar() {
  if (document.getElementById("bulkBar")) return;
  const bar = document.createElement("div"); 
  bar.id = "bulkBar"; 
  bar.style.margin = "8px 0"; 
  bar.style.display = "flex"; 
  bar.style.gap = "8px";
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

  if (bulkEditBtn) {
    bulkEditBtn.onclick = (e) => {
      e?.preventDefault?.(); if (!selectedIds.size) return alert("Select at least one item.");
      openBulkEditModal(e?.currentTarget || e?.target || null);
    };
  }

  if (bulkDeleteBtn) {
    bulkDeleteBtn.onclick = async (e) => {
      e?.preventDefault?.(); if (!selectedIds.size) return; 
      if (!confirm(\`Delete \${selectedIds.size} item(s)?\`)) return;
      const ops = []; selectedIds.forEach((id) => ops.push(deleteDoc(doc(db, "menuItems", id))));
      await Promise.all(ops); selectedIds.clear(); updateBulkBar();
    };
  }

  if (bulkPromosBulkBtn) {
    bulkPromosBulkBtn.onclick = (e) => {
      e?.preventDefault?.(); if (!selectedIds.size) return alert("Select at least one item.");
      openBulkPromosModal(e?.currentTarget || e?.target || null);
    };
  }

  if (bulkAddonsBulkBtn) {
    bulkAddonsBulkBtn.onclick = (e) => {
      e?.preventDefault?.(); if (!selectedIds.size) return alert("Select at least one item.");
      openBulkAddonsModal(e?.currentTarget || e?.target || null);
    };
  }
}

/* ===== END OF PART 1 ===== */

/* =========================
   BULK MODALS (Part 2)
   ========================= */

// Standalone: Bulk Promotions Modal
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

    ov.querySelector('#bpCancel').onclick = () => { const box = ov.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ ov.style.display='none'; un}, 180); };

    ov.querySelector('#bpApply').onclick = async () => {
      if (!selectedIds.size) { alert('No items selected.'); return; }
      const clear = ov.querySelector('#bpClear').checked;
      const sel = ov.querySelector('#bpSelect');
      const ids = clear ? [] : [...sel.selectedOptions].map(o=>o.value).filter(Boolean);
      try {
        ov.querySelector('#bpApply').disabled = true;
        const ops = []; selectedIds.forEach((id)=> ops.push(updateDoc(doc(db,'menuItems',id), { promotions: ids })));
        await Promise.all(ops);
        const box = ov.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ ov.style.display='none'; un}, 150);
      } catch(e){ console.error(e); alert('Failed to update promotions: ' + (e?.message || e)); }
      finally { ov.querySelector('#bpApply').disabled = false; }
    };
  }

  // Load options
  const sel = ov.querySelector('#bpSelect'); sel.innerHTML = '';
  const snap = await getDocs(collection(db,'promotions'));
  const rows = [];
  snap.forEach(d => { const p = d.data(); if (p?.kind === 'coupon') { const typeTxt = p.type === 'percent' ? `${p.value}% off` : `₹${p.value} off`; const chan = p.channel === 'dining' ? 'Dining' : 'Delivery'; rows.push({ id: d.id, label: `${p.code || '(no code)'} • ${chan} • ${typeTxt}` }); } });
  if (!rows.length) sel.innerHTML = `<option value="">(No promotions found)</option>`;
  rows.forEach(r => { const o=document.createElement('option'); o.value=r.id; o.textContent=r.label; sel.appendChild(o); });
  ov.querySelector('#bpCount').textContent = String(selectedIds.size);

  lockBodyScroll();
ov.style.display = 'block'; setGenieFrom(triggerEl, ov, ov.querySelector('.adm-modal')); const box = ov.querySelector('.adm-modal'); box.classList.remove('adm-anim-out'); box.classList.add('adm-anim-in');
}

// Standalone: Bulk Add-ons Modal
async function openBulkAddonsModal(triggerEl) {
  ensureModalStyles();
  let ov = document.getElementById('bulkAddonsModal');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'bulkAddonsModal'; ov.className = 'adm-overlay';
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

    ov.querySelector('#baCancel').onclick = () => { const box = ov.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ ov.style.display='none'; un}, 180); };

    ov.querySelector('#baApply').onclick = async () => {
      if (!selectedIds.size) { alert('No items selected.'); return; }
      const clear = ov.querySelector('#baClear').checked;
      const chosen = clear ? [] : [...ov.querySelectorAll('.ba-row input[type="checkbox"]:checked')].map(i => ({ name: i.value, price: Number(i.dataset.price || 0) }));
      try {
        ov.querySelector('#baApply').disabled = true;
        const ops = []; selectedIds.forEach((id)=> ops.push(updateDoc(doc(db,'menuItems',id), { addons: chosen })));
        await Promise.all(ops);
        const box = ov.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ ov.style.display='none'; un}, 150);
      } catch(e){ console.error(e); alert('Failed to update add-ons: ' + (e?.message || e)); }
      finally { ov.querySelector('#baApply').disabled = false; }
    };
  }

  // Load add-ons list
  const list = ov.querySelector('#baList'); list.innerHTML = '';
  const snap = await getDocs(collection(db, 'menuAddons'));
  const rows = []; snap.forEach(d => { const v = d.data() || {}; rows.push({ name: v.name || d.id, price: Number(v.price || 0) }); });
  if (!rows.length) list.innerHTML = `<div class="adm-muted">(No add-ons found)</div>`;
  rows.forEach(a => { const row = document.createElement('label'); row.className = 'ba-row'; row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 4px;'; row.innerHTML = `<input type="checkbox" value="${a.name}" data-price="${a.price}"/><span>${a.name} (₹${a.price})</span>`; list.appendChild(row); });
  ov.querySelector('#baCount').textContent = String(selectedIds.size);

  lockBodyScroll();
ov.style.display = 'block'; setGenieFrom(triggerEl, ov, ov.querySelector('.adm-modal')); const box = ov.querySelector('.adm-modal'); box.classList.remove('adm-anim-out'); box.classList.add('adm-anim-in');
}

// Bulk Edit Modal (with fields + embedded promos & add-ons selectors)
function openBulkEditModal(triggerEl) {
  ensureModalStyles();
  let modal = document.getElementById('bulkModal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'bulkModal'; modal.className = 'adm-overlay';
    modal.innerHTML = `
      <div class="adm-modal" style="padding:18px;">
        <h3 style="margin-top:0">Bulk Edit (<span id="bulkCount">0</span> items)</h3>
        <form id="bulkForm">
          <div style="display:grid; gap:10px;">
            <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="bulkCatEnable" /><span>Category</span></label>
            <select id="bulkCategory" disabled><option value="">-- Select Category --</option></select>

            <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="bulkCourseEnable" /><span>Food Course</span></label>
            <select id="bulkCourse" disabled><option value="">-- Select Food Course --</option></select>

            <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="bulkTypeEnable" /><span>Food Type</span></label>
            <select id="bulkType" disabled>
              <option value="">-- Select Type --</option>
              <option value="Veg">Veg</option>
              <option value="Non-Veg">Non-Veg</option>
            </select>

            <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="bulkStockEnable" /><span>Stock Status</span></label>
            <select id="bulkStock" disabled>
              <option value="">-- Select Stock --</option>
              <option value="true">In Stock</option>
              <option value="false">Out of Stock</option>
            </select>

            <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="bulkQtyEnable" /><span>Quantity & Price</span></label>
            <select id="bulkQtyType" disabled>
              <option value="">-- Select Qty Type --</option>
              <option value="Not Applicable">Not Applicable</option>
              <option value="Half & Full">Half & Full</option>
            </select>
            <input type="number" id="bulkItemPrice" placeholder="Price" style="display:none;" disabled />
            <div id="bulkHFWrap" style="display:none;">
              <input type="number" id="bulkHalfPrice" placeholder="Half Price" disabled />
              <input type="number" id="bulkFullPrice" placeholder="Full Price" disabled />
            </div>

            <div style="border-top:1px dashed #ddd; padding-top:12px; display:grid; gap:10px;">
              <div>
                <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="bulkPromosEnable" /><span>Promotions</span></label>
                <label style="display:flex; align-items:center; gap:6px; margin-bottom:6px;"><input type="checkbox" id="bulkClearPromos" disabled /><span>Clear promotions</span></label>
                <select id="bulkPromosSelect" multiple size="6" disabled><option value="">-- Select Promotion(s) --</option></select>
                <small class="adm-muted">Tip: hold Ctrl/⌘ to select multiple</small>
              </div>
              <div>
                <label style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="bulkAddonsEnable" /><span>Add-ons</span></label>
                <label style="display:flex; align-items:center; gap:6px; margin-bottom:6px;"><input type="checkbox" id="bulkClearAddons" disabled /><span>Clear add-ons</span></label>
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
    document.body.appendChild(modal);

    // Wire close
    modal.querySelector('#bulkCancelBtn').onclick = () => { const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ modal.style.display='none'; un}, 180); };

    // References
    const bulkCategory  = modal.querySelector('#bulkCategory');
    const bulkCourse    = modal.querySelector('#bulkCourse');
    const bulkType      = modal.querySelector('#bulkType');
    const bulkStock     = modal.querySelector('#bulkStock');
    const bulkQtyType   = modal.querySelector('#bulkQtyType');
    const bulkItemPrice = modal.querySelector('#bulkItemPrice');
    const bulkHFWrap    = modal.querySelector('#bulkHFWrap');
    const bulkHalfPrice = modal.querySelector('#bulkHalfPrice');
    const bulkFullPrice = modal.querySelector('#bulkFullPrice');

    const bulkCatEnable    = modal.querySelector('#bulkCatEnable');
    const bulkCourseEnable = modal.querySelector('#bulkCourseEnable');
    const bulkTypeEnable   = modal.querySelector('#bulkTypeEnable');
    const bulkStockEnable  = modal.querySelector('#bulkStockEnable');
    const bulkQtyEnable    = modal.querySelector('#bulkQtyEnable');

    // Toggles
    bulkCatEnable.onchange    = () => bulkCategory.disabled = !bulkCatEnable.checked;
    bulkCourseEnable.onchange = () => bulkCourse.disabled   = !bulkCourseEnable.checked;
    bulkTypeEnable.onchange   = () => bulkType.disabled     = !bulkTypeEnable.checked;
    bulkStockEnable.onchange  = () => bulkStock.disabled    = !bulkStockEnable.checked;
    bulkQtyEnable.onchange    = () => { const on = bulkQtyEnable.checked; bulkQtyType.disabled = !on; toggleBulkQtyInputs(); };

    function toggleBulkQtyInputs() {
      const vt = bulkQtyType.value; const on = bulkQtyEnable.checked;
      const showSingle = on && vt === 'Not Applicable'; const showHF = on && vt === 'Half & Full';
      bulkItemPrice.style.display = showSingle ? 'block' : 'none'; bulkHFWrap.style.display = showHF ? 'block' : 'none';
      bulkItemPrice.disabled = !showSingle; bulkHalfPrice.disabled = !showHF; bulkFullPrice.disabled = !showHF;
    }
    bulkQtyType.onchange = toggleBulkQtyInputs;

    // Promotions/Add-ons selectors
    const promosEnable = modal.querySelector('#bulkPromosEnable');
    const promosClear  = modal.querySelector('#bulkClearPromos');
    const promosSelect = modal.querySelector('#bulkPromosSelect');
    const addonsEnable = modal.querySelector('#bulkAddonsEnable');
    const addonsClear  = modal.querySelector('#bulkClearAddons');
    const addonsSelect = modal.querySelector('#bulkAddonsSelect');

    async function loadPromotionsOptions() {
      promosSelect.innerHTML = `<option value="">-- Select Promotion(s) --</option>`;
      const snap = await getDocs(collection(db, 'promotions'));
      const rows = []; snap.forEach(d=>{ const p = d.data(); if (p?.kind==='coupon'){ const typeTxt = p.type==='percent'?`${p.value}% off`:`₹${p.value} off`; const chan = p.channel==='dining'?'Dining':'Delivery'; rows.push({ id:d.id, label:`${p.code || '(no code)'} • ${chan} • ${typeTxt}` }); }});
      rows.forEach(r=>{ const o=document.createElement('option'); o.value=r.id; o.textContent=r.label; promosSelect.appendChild(o); });
    }
    async function loadAddonsOptions() {
      addonsSelect.innerHTML = `<option value="">-- Select Add-on(s) --</option>`;
      const snap = await getDocs(collection(db,'menuAddons'));
      const rows = []; snap.forEach(d=>{ const v=d.data()||{}; const name=v.name||d.id; const price=Number(v.price||0); rows.push({ name, price }); });
      rows.forEach(a=>{ const o=document.createElement('option'); o.value=a.name; o.textContent=`${a.name} (₹${a.price})`; o.dataset.price=String(a.price); addonsSelect.appendChild(o); });
    }

    function togglePromosInputs(){ const on = !!promosEnable.checked; promosSelect.disabled = !on; promosClear.disabled = !on; if (on) loadPromotionsOptions().catch(console.error); }
    function toggleAddonsInputs(){ const on = !!addonsEnable.checked; addonsSelect.disabled = !on; addonsClear.disabled = !on; if (on) loadAddonsOptions().catch(console.error); }

    promosEnable.onchange = togglePromosInputs; addonsEnable.onchange = toggleAddonsInputs; togglePromosInputs(); toggleAddonsInputs();

    // Submit
    modal.querySelector('#bulkForm').onsubmit = async (e) => {
      e.preventDefault(); if (!selectedIds.size) { alert('No items selected.'); return; }
      const updates = {};
      if (bulkCatEnable.checked) { if (!bulkCategory.value) return alert('Select a Category.'); updates.category = bulkCategory.value; }
      if (bulkCourseEnable.checked) { if (!bulkCourse.value) return alert('Select a Course.'); updates.foodCourse = bulkCourse.value; }
      if (bulkTypeEnable.checked) { if (!bulkType.value) return alert('Select a Food Type.'); updates.foodType = bulkType.value; }
      if (bulkStockEnable.checked) { if (!bulkStock.value) return alert('Select Stock Status.'); updates.inStock = (bulkStock.value === 'true'); }
      if (bulkQtyEnable.checked) {
        const vt = bulkQtyType.value; if (!vt) return alert('Select Qty Type.');
        if (vt === 'Not Applicable') { const p = parseFloat(bulkItemPrice.value); if (isNaN(p)||p<=0) return alert('Enter a valid Price.'); updates.qtyType = { type: vt, itemPrice: p }; }
        else if (vt === 'Half & Full') { const h = parseFloat(bulkHalfPrice.value); const f = parseFloat(bulkFullPrice.value); if (isNaN(h)||isNaN(f)||h<=0||f<=0) return alert('Enter valid Half/Full prices.'); updates.qtyType = { type: vt, halfPrice: h, fullPrice: f }; }
      }

      // Promotions
      if (promosEnable.checked) {
        if (promosClear.checked) updates.promotions = [];
        else {
          const ids = [...promosSelect.selectedOptions].map(o=>o.value).filter(v=>v && v!=="");
          updates.promotions = ids;
        }
      }
      // Add-ons
      if (addonsEnable.checked) {
        if (addonsClear.checked) updates.addons = [];
        else {
          const chosen = [...addonsSelect.selectedOptions].map(o=>({ name:o.value, price:Number(o.dataset.price||0) })).filter(a=>a.name);
          updates.addons = chosen;
        }
      }

      if (!Object.keys(updates).length) return alert('Tick at least one field to update.');

      try {
        modal.querySelector('#bulkApplyBtn').disabled = true;
        const ops = []; selectedIds.forEach((id)=> ops.push(updateDoc(doc(db,'menuItems',id), updates)));
        await Promise.all(ops);
        const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ modal.style.display='none'; un}, 150);
      } catch(err){ console.error(err); alert('Bulk update failed: ' + (err?.message || err)); }
      finally { modal.querySelector('#bulkApplyBtn').disabled = false; }
    };

    // Store refs for re-open
    modal._refs = { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQtyInputs };
  }

  // Open: refresh
  modal.querySelector('#bulkCount').textContent = String(selectedIds.size);

  const { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQtyInputs } = modal._refs;
  loadCategories(bulkCategory); loadCourses(bulkCourse);
  bulkType.value = ''; bulkQtyType.value = ''; toggleBulkQtyInputs();

  modal.querySelector('#bulkCatEnable').checked = false;
  modal.querySelector('#bulkCourseEnable').checked = false;
  modal.querySelector('#bulkTypeEnable').checked = false;
  modal.querySelector('#bulkStockEnable').checked = false;
  modal.querySelector('#bulkQtyEnable').checked = false;

  bulkCategory.disabled = true; bulkCourse.disabled = true; bulkType.disabled = true; modal.querySelector('#bulkStock').disabled = true; bulkQtyType.disabled = true;

  // Reset promos/addons region
  const promosEnable = modal.querySelector('#bulkPromosEnable'); const promosClear = modal.querySelector('#bulkClearPromos'); const promosSelect = modal.querySelector('#bulkPromosSelect');
  const addonsEnable = modal.querySelector('#bulkAddonsEnable'); const addonsClear = modal.querySelector('#bulkClearAddons'); const addonsSelect = modal.querySelector('#bulkAddonsSelect');
  if (promosEnable) promosEnable.checked = false; if (addonsEnable) addonsEnable.checked = false; if (promosClear) promosClear.checked = false; if (addonsClear) addonsClear.checked = false;
  if (promosSelect) { promosSelect.innerHTML = `<option value="">-- Select Promotion(s) --</option>`; promosSelect.disabled = true; }
  if (addonsSelect) { addonsSelect.innerHTML = `<option value="">-- Select Add-on(s) --</option>`; addonsSelect.disabled = true; }

  modal.style.display = 'block'; setGenieFrom(triggerEl, modal, modal.querySelector('.adm-modal')); const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-out'); box.classList.add('adm-anim-in');
}

/* =========================
   ASSIGN MODALS (single-item)
   ========================= */
function openAssignAddonsModal(itemId, current) {
  ensureModalStyles();
  let modal = document.getElementById('addonAssignModal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'addonAssignModal'; modal.className = 'adm-overlay';
    modal.innerHTML = `
      <div class="adm-modal" style="padding:18px; max-width:520px;">
        <h3 style="margin-top:0">Assign Add-ons</h3>
        <div id="assignAddonList" style="max-height:300px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px;"></div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button id="assignAddonSave" class="adm-btn adm-btn--primary">Save</button>
          <button id="assignAddonCancel" class="adm-btn">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#assignAddonCancel').onclick = () => { const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ modal.style.display='none'; un}, 180); };
  }

  (async () => {
    const list = modal.querySelector('#assignAddonList');
    const addons = await fetchAddons();
    const cur = new Set((current || []).map(a => typeof a === 'string' ? a : a.name));
    list.innerHTML = addons.map(a => `<label style="display:flex; align-items:center; gap:8px; padding:6px 4px;"><input type="checkbox" value="${a.name}" ${cur.has(a.name) ? 'checked' : ''} /><span>${a.name} (₹${a.price})</span></label>`).join('');

    modal.querySelector('#assignAddonSave').onclick = async () => {
      const chosen = addons.filter(a => list.querySelector(`input[value="${a.name}"]`)?.checked).map(a => ({ name: a.name, price: a.price }));
      try { await updateDoc(doc(db, 'menuItems', itemId), { addons: chosen }); const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ modal.style.display='none'; un}, 150); }
      catch (err) { console.error(err); alert('Failed to assign add-ons: ' + (err?.message || err)); }
    };

    modal.style.display = 'block'; setGenieFrom(null, modal, modal.querySelector('.adm-modal')); const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-out'); box.classList.add('adm-anim-in');
  })();
}

async function openAssignPromotionsModal(itemId, currentIds) {
  ensureModalStyles();
  let modal = document.getElementById('promoAssignModal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'promoAssignModal'; modal.className = 'adm-overlay';
    modal.innerHTML = `
      <div class="adm-modal" style="padding:18px; max-width:520px;">
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
    document.body.appendChild(modal);
    modal.querySelector('#ppCancel').onclick = () => { const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ modal.style.display='none'; un}, 180); };
  }

  const sel = modal.querySelector('#ppSelect'); sel.innerHTML = '';
  const snap = await getDocs(collection(db,'promotions'));
  const rows = []; snap.forEach(d=>{ const p=d.data(); if (p?.kind==='coupon'){ const typeTxt=p.type==='percent'?`${p.value}% off`:`₹${p.value} off`; const chan=p.channel==='dining'?'Dining':'Delivery'; rows.push({ id:d.id, label:`${p.code || '(no code)'} • ${chan} • ${typeTxt}`}); }});
  if (!rows.length) sel.innerHTML = `<option value="">(No promotions found)</option>`;
  rows.forEach(r=>{ const o=document.createElement('option'); o.value=r.id; o.textContent=r.label; sel.appendChild(o); });

  // Preselect current
  const cur = new Set(currentIds || []); Array.from(sel.options).forEach(o => o.selected = cur.has(o.value));

  modal.querySelector('#ppSave').onclick = async () => {
    const clear = modal.querySelector('#ppClear').checked;
    const ids = clear ? [] : [...sel.selectedOptions].map(o=>o.value).filter(Boolean);
    try { await updateDoc(doc(db,'menuItems', itemId), { promotions: ids }); const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-in'); box.classList.add('adm-anim-out'); setTimeout(()=>{ modal.style.display='none'; un}, 150); }
    catch (err) { console.error(err); alert('Failed to assign promotions: ' + (err?.message || err)); }
  };

  modal.style.display = 'block'; setGenieFrom(null, modal, modal.querySelector('.adm-modal')); const box = modal.querySelector('.adm-modal'); box.classList.remove('adm-anim-out'); box.classList.add('adm-anim-in');
}

/* ===== END OF PART 2 ===== */

/* =========================
   COMIC DROPDOWNS & FILTERS & EDIT (PART 3)
   ========================= */

/* ---------- Category dropdown (comic / inline edit & delete) ---------- */
async function renderCustomCategoryDropdown() {
  if (!catBtn || !catPanel) return;
  const categories = await fetchCategories();
  const current = categoryDropdown?.value || '';
  catPanel.innerHTML = categories.map(name => {
    const checked = name === current ? 'checked' : '';
    return `
      <div class="cat-row" data-name="${name}">
        <span class="cat-check ${checked}" data-role="check" title="Select"></span>
        <span class="cat-label" data-role="label" title="${name}">${name}</span>
        <button class="cat-btn" title="Edit" data-role="edit">✏️</button>
        <button class="cat-btn" title="Delete" data-role="delete">🗑️</button>
      </div>`;
  }).join('');

  catPanel.onmousedown = (e) => e.stopPropagation();
  catPanel.onclick = async (e) => {
    e.stopPropagation();
    const row = e.target.closest('.cat-row'); if (!row) return;
    const role = e.target.getAttribute('data-role');
    const name = row.getAttribute('data-name');

    // select
    if (role === 'check' || role === 'label') {
      const isChecked = row.querySelector('.cat-check').classList.contains('checked');
      if (isChecked) {
        row.querySelector('.cat-check').classList.remove('checked');
        setHiddenValue(categoryDropdown, '');
        catBtn.textContent = 'Select Category ▾';
        return;
      }
      catPanel.querySelectorAll('.cat-check').forEach(c => c.classList.remove('checked'));
      row.querySelector('.cat-check').classList.add('checked');
      setHiddenValue(categoryDropdown, name);
      catBtn.textContent = `${name} ▾`;
      return;
    }

    // inline edit
    if (role === 'edit') {
      const oldName = name;
      row.innerHTML =
        `<div class="inline-controls">
          <input class="cat-input" type="text" value="${oldName}" />
          <button class="cat-btn" data-role="save">✔</button>
          <button class="cat-btn" data-role="cancel">✖</button>
        </div>`;
      row.onclick = async (ev) => {
        ev.stopPropagation();
        const r = ev.target.getAttribute('data-role');
        if (r === 'cancel') { await renderCustomCategoryDropdown(); return; }
        if (r === 'save') {
          const newVal = row.querySelector('.cat-input').value.trim();
          if (!newVal) return alert('Enter a valid category');
          if (newVal === oldName) { await renderCustomCategoryDropdown(); return; }
          try {
            row.querySelector('.cat-input').disabled = true;
            await renameCategoryEverywhere(oldName, newVal);
            if (categoryDropdown?.value === oldName) {
              setHiddenValue(categoryDropdown, newVal);
              catBtn.textContent = `${newVal} ▾`;
            }
            await loadCategories(categoryDropdown);
            await renderCustomCategoryDropdown();
            await populateFilterDropdowns();
          } catch (err) { console.error(err); alert('Rename failed: ' + (err?.message || err)); await renderCustomCategoryDropdown(); }
        }
      };
      return;
    }

    // delete
    if (role === 'delete') {
      if (!confirm(`Delete category "${name}"?\n(Items will NOT be deleted; category field will be cleared.)`)) return;
      try {
        if (categoryDropdown?.value === name) {
          setHiddenValue(categoryDropdown, '');
          catBtn.textContent = 'Select Category ▾';
        }
        await deleteCategoryEverywhere(name);
        await loadCategories(categoryDropdown);
        await renderCustomCategoryDropdown();
        await populateFilterDropdowns();
      } catch (err) { console.error(err); alert('Delete failed: ' + (err?.message || err)); }
      return;
    }
  };

  catBtn.onclick = (e) => {
    e.stopPropagation();
    const opening = !catPanel.style.display || catPanel.style.display === 'none';
    catPanel.style.display = opening ? 'block' : 'none';
    if (opening) {
      const handler = (ev) => {
        if (!catPanel.contains(ev.target) && !catBtn.contains(ev.target)) {
          catPanel.style.display = 'none';
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }
  };
}

/* ---------- Course dropdown (comic / inline edit & delete) ---------- */
async function renderCustomCourseDropdown() {
  if (!courseBtn || !coursePanel) return;
  const courses = await fetchCourses();
  const current = foodCourseDropdown?.value || '';
  coursePanel.innerHTML = courses.map(name => {
    const checked = name === current ? 'checked' : '';
    return `
      <div class="course-row" data-name="${name}">
        <span class="course-check ${checked}" data-role="check" title="Select"></span>
        <span class="course-label" data-role="label" title="${name}">${name}</span>
        <button class="course-btn" title="Edit" data-role="edit">✏️</button>
        <button class="course-btn" title="Delete" data-role="delete">🗑️</button>
      </div>`;
  }).join('');

  coursePanel.onmousedown = (e)=> e.stopPropagation();
  coursePanel.onclick = async (e) => {
    e.stopPropagation();
    const row = e.target.closest('.course-row'); if (!row) return;
    const role = e.target.getAttribute('data-role');
    const name = row.getAttribute('data-name');

    if (role === 'check' || role === 'label') {
      const isChecked = row.querySelector('.course-check').classList.contains('checked');
      if (isChecked) {
        row.querySelector('.course-check').classList.remove('checked');
        setHiddenValue(foodCourseDropdown, '');
        courseBtn.textContent = 'Select Course ▾';
        return;
      }
      coursePanel.querySelectorAll('.course-check').forEach(c => c.classList.remove('checked'));
      row.querySelector('.course-check').classList.add('checked');
      setHiddenValue(foodCourseDropdown, name);
      courseBtn.textContent = `${name} ▾`;
      return;
    }

    if (role === 'edit') {
      const oldName = name;
      row.innerHTML =
        `<div class="inline-controls">
          <input class="course-input" type="text" value="${oldName}" />
          <button class="course-btn" data-role="save">✔</button>
          <button class="course-btn" data-role="cancel">✖</button>
        </div>`;
      row.onclick = async (ev) => {
        ev.stopPropagation();
        const r = ev.target.getAttribute('data-role');
        if (r === 'cancel') { await renderCustomCourseDropdown(); return; }
        if (r === 'save') {
          const newVal = row.querySelector('.course-input').value.trim();
          if (!newVal) return alert('Enter a valid course');
          if (newVal === oldName) { await renderCustomCourseDropdown(); return; }
          try {
            row.querySelector('.course-input').disabled = true;
            await renameCourseEverywhere(oldName, newVal);
            if (foodCourseDropdown?.value === oldName) {
              setHiddenValue(foodCourseDropdown, newVal);
              courseBtn.textContent = `${newVal} ▾`;
            }
            await loadCourses(foodCourseDropdown);
            await renderCustomCourseDropdown();
            await populateFilterDropdowns();
          } catch (err) { console.error(err); alert('Rename failed: ' + (err?.message || err)); await renderCustomCourseDropdown(); }
        }
      };
      return;
    }

    if (role === 'delete') {
      if (!confirm(`Delete course "${name}"?\n(Items will NOT be deleted; course field will be cleared.)`)) return;
      try {
        if (foodCourseDropdown?.value === name) {
          setHiddenValue(foodCourseDropdown, '');
          courseBtn.textContent = 'Select Course ▾';
        }
        await deleteCourseEverywhere(name);
        await loadCourses(foodCourseDropdown);
        await renderCustomCourseDropdown();
        await populateFilterDropdowns();
      } catch (err) { console.error(err); alert('Delete failed: ' + (err?.message || err)); }
      return;
    }
  };

  courseBtn.onclick = (e) => {
    e.stopPropagation();
    const opening = !coursePanel.style.display || coursePanel.style.display === 'none';
    coursePanel.style.display = opening ? 'block' : 'none';
    if (opening) {
      const handler = (ev) => {
        if (!coursePanel.contains(ev.target) && !courseBtn.contains(ev.target)) {
          coursePanel.style.display = 'none';
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }
  };
}

/* ---------- Add-on dropdown (comic / inline edit & delete) ---------- */
async function renderCustomAddonDropdown() {
  if (!addonBtn || !addonPanel) return;
  const addons = await fetchAddons();
  const selected = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));
  addonPanel.innerHTML = addons.map(a => {
    const checked = selected.has(a.name) ? 'checked' : '';
    return `
      <div class="addon-row" data-name="${a.name}">
        <span class="addon-check ${checked}" data-role="check" title="Toggle"></span>
        <span class="addon-label" data-role="label" title="${a.name}">${a.name} (₹${a.price})</span>
        <button class="addon-btn" title="Edit" data-role="edit">✏️</button>
        <button class="addon-btn" title="Delete" data-role="delete">🗑️</button>
      </div>`;
  }).join('');

  addonPanel.onmousedown = (e)=> e.stopPropagation();
  addonPanel.onclick = async (e) => {
    e.stopPropagation();
    const row = e.target.closest('.addon-row'); if (!row) return;
    const role = e.target.getAttribute('data-role');
    const name = row.getAttribute('data-name');

    if (role === 'check' || role === 'label') {
      const el = row.querySelector('.addon-check');
      const isChecked = el.classList.contains('checked');
      const values = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));
      if (isChecked) { el.classList.remove('checked'); values.delete(name); }
      else { el.classList.add('checked'); values.add(name); }
      setMultiHiddenValue(addonsSelect, Array.from(values));
      updateAddonBtnLabel();
      return;
    }

    if (role === 'edit') {
      const oldName = name;
      row.innerHTML =
        `<div class="inline-controls">
          <input class="addon-input" type="text" value="${oldName}" />
          <button class="addon-btn" data-role="save">✔</button>
          <button class="addon-btn" data-role="cancel">✖</button>
        </div>`;
      row.onclick = async (ev) => {
        ev.stopPropagation();
        const r = ev.target.getAttribute('data-role');
        if (r === 'cancel') { await renderCustomAddonDropdown(); return; }
        if (r === 'save') {
          const newVal = row.querySelector('.addon-input').value.trim();
          if (!newVal) return alert('Enter a valid add-on');
          if (newVal === oldName) { await renderCustomAddonDropdown(); return; }
          try {
            row.querySelector('.addon-input').disabled = true;
            await renameAddonEverywhere(oldName, newVal);
            const sel = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));
            if (sel.has(oldName)) { sel.delete(oldName); sel.add(newVal); }
            await loadAddons(addonsSelect);
            setMultiHiddenValue(addonsSelect, Array.from(sel));
            await renderCustomAddonDropdown();
            updateAddonBtnLabel();
          } catch (err) { console.error(err); alert('Rename failed: ' + (err?.message || err)); await renderCustomAddonDropdown(); }
        }
      };
      return;
    }

    if (role === 'delete') {
      if (!confirm(`Delete add-on "${name}"?\n(Items will NOT be deleted; the add-on will be removed from them.)`)) return;
      try {
        const sel = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));
        sel.delete(name);
        await deleteAddonEverywhere(name);
        await loadAddons(addonsSelect);
        setMultiHiddenValue(addonsSelect, Array.from(sel));
        await renderCustomAddonDropdown();
        updateAddonBtnLabel();
      } catch (err) { console.error(err); alert('Delete failed: ' + (err?.message || err)); }
      return;
    }
  };

  addonBtn.onclick = (e) => {
    e.stopPropagation();
    const opening = !addonPanel.style.display || addonPanel.style.display === 'none';
    addonPanel.style.display = opening ? 'block' : 'none';
    if (opening) {
      const handler = (ev) => {
        if (!addonPanel.contains(ev.target) && !addonBtn.contains(ev.target)) {
          addonPanel.style.display = 'none';
          document.removeEventListener('mousedown', handler);
        }
      };
      document.addEventListener('mousedown', handler);
    }
  };

  updateAddonBtnLabel();
}
function updateAddonBtnLabel() {
  if (!addonBtn || !addonsSelect) return;
  const vals = Array.from(addonsSelect.selectedOptions || []).map(o=>o.value);
  if (!vals.length) addonBtn.textContent = 'Select Add-ons ▾';
  else if (vals.length <= 2) addonBtn.textContent = `${vals.join(', ')} ▾`;
  else addonBtn.textContent = `${vals[0]}, ${vals[1]} +${vals.length-2} ▾`;
}

/* ---------- Filters / Search ---------- */
async function populateFilterDropdowns() {
  const cats = await fetchCategories();
  if (filterCategory) {
    const prev = filterCategory.value;
    filterCategory.innerHTML = `<option value="">All Categories</option>` + cats.map(c => `<option>${c}</option>`).join('');
    filterCategory.value = prev || '';
  }
  const courses = await fetchCourses();
  if (filterCourse) {
    const prev = filterCourse.value;
    filterCourse.innerHTML = `<option value="">All Courses</option>` + courses.map(c => `<option>${c}</option>`).join('');
    filterCourse.value = prev || '';
  }
}
function wireSearchAndFilters() {
  const debounced = debounce(() => { renderTable(); updateBulkBar(); }, 200);
  searchInput?.addEventListener('input', debounced);
  filterCategory?.addEventListener('change', () => { renderTable(); updateBulkBar(); });
  filterCourse?.addEventListener('change', () => { renderTable(); updateBulkBar(); });
  filterType?.addEventListener('change', () => { renderTable(); updateBulkBar(); });
}
function applyFilters(items) {
  const q = (searchInput?.value || '').toLowerCase().trim();
  const fc = (filterCategory?.value || '').trim();
  const fo = (filterCourse?.value || '').trim();
  const ft = (filterType?.value || '').trim();

  return items.filter(({ data: d }) => {
    if (fc && (d.category || '') !== fc) return false;
    if (fo && (d.foodCourse || '') !== fo) return false;
    if (ft && d.foodType !== ft) return false;
    if (q) {
      const addonHay = Array.isArray(d.addons) ? d.addons.map(a => (typeof a === 'string' ? a : a.name)).join(' ') : '';
      const hay = `${d.name} ${d.description} ${d.category || ''} ${d.foodCourse || ''} ${addonHay}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- Edit Modal (single item) ---------- */
function openEditModal(id, d) {
  editingId = id; if (!editModal) return;
  if (editName) editName.value = d.name || '';
  if (editDescription) editDescription.value = d.description || '';
  Promise.all([loadCategories(editCategory), loadCourses(editCourse)]).then(() => {
    if (editCategory) editCategory.value = d.category || '';
    if (editCourse) editCourse.value = d.foodCourse || '';
  });
  if (editType) editType.value = d.foodType || 'Veg';
  if (editQtyType) editQtyType.value = (d.qtyType && d.qtyType.type) || 'Not Applicable';
  toggleEditPriceInputs();
  if (editQtyType && editQtyType.value === 'Not Applicable') {
    if (editItemPrice) editItemPrice.value = d.qtyType?.itemPrice ?? '';
  } else {
    if (editHalfPrice) editHalfPrice.value = d.qtyType?.halfPrice ?? '';
    if (editFullPrice) editFullPrice.value = d.qtyType?.fullPrice ?? '';
  }
  editModal.style.display = 'block';
}

function closeEditModal() { editingId = null; editForm?.reset(); if (editModal) editModal.style.display = 'none'; }
if (closeEditModalBtn) closeEditModalBtn.onclick = closeEditModal;
if (editQtyType) editQtyType.onchange = toggleEditPriceInputs;

function toggleEditPriceInputs() {
  if (!editQtyType) return; const v = editQtyType.value;
  if (editItemPrice) editItemPrice.style.display = v === 'Not Applicable' ? 'block' : 'none';
  const showHF = v === 'Half & Full';
  if (editHalfPrice) editHalfPrice.style.display = showHF ? 'block' : 'none';
  if (editFullPrice) editFullPrice.style.display = showHF ? 'block' : 'none';
}

if (editForm) {
  editForm.onsubmit = async (e) => {
    e.preventDefault(); if (!editingId) return;
    const name = (editName?.value || '').trim();
    const description = (editDescription?.value || '').trim();
    const category = editCategory?.value;
    const foodCourse = editCourse?.value;
    const foodType = editType?.value;
    const qtyTypeValue = editQtyType?.value;
    if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeValue) { return alert('Fill all fields'); }

    let qtyType = {};
    if (qtyTypeValue === 'Not Applicable') {
      const price = parseFloat(editItemPrice?.value);
      if (isNaN(price) || price <= 0) return alert('Invalid price');
      qtyType = { type: qtyTypeValue, itemPrice: price };
    } else {
      const half = parseFloat(editHalfPrice?.value);
      const full = parseFloat(editFullPrice?.value);
      if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) return alert('Invalid Half/Full price');
      qtyType = { type: qtyTypeValue, halfPrice: half, fullPrice: full };
    }

    try {
      let imageUrlUpdate = {};
      const file = document.getElementById('editImage')?.files?.[0];
      if (file) {
        const resized = await resizeImage(file);
        const imageRef = ref(storage, `menuImages/${Date.now()}_${file.name}`);
        await uploadBytes(imageRef, resized);
        const newUrl = await getDownloadURL(imageRef);
        imageUrlUpdate = { imageUrl: newUrl };
      }
      await updateDoc(doc(db, 'menuItems', editingId), {
        name, description, category, foodCourse, foodType, qtyType, updatedAt: serverTimestamp(), ...imageUrlUpdate
      });
      closeEditModal();
    } catch (err) {
      console.error(err);
      alert('Update failed: ' + (err?.message || err));
    }
  };
}
/* ===== END OF PART 3 ===== */
