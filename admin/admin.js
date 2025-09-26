// /admin/admin.js — clean rewrite & harden (2025-09-27)
// - Guarantees menu renders even if Promotions UI fails
// - Adds Promotions chips column and working per-row [Promotions] modal
// - Safer event wiring & null-guards

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
   Auth
   ========================= */
if (loginBtn) {
  loginBtn.onclick = () => {
    signInWithEmailAndPassword(auth, email.value, password.value)
      .then(() => { email.value = ""; password.value = ""; })
      .catch(err => alert("Login failed: " + err.message));
  };
}
if (logoutBtn) {
  logoutBtn.onclick = () => signOut(auth);
}

onAuthStateChanged(auth, async (user) => {
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

    // ✅ Always attach menu listener FIRST so items render even if Promotions fails
    attachSnapshot();

    // Live coupon map for chips
    onSnapshot(collection(db, "promotions"), (snap) => {
      const map = {};
      snap.forEach((d) => {
        const p = d.data();
        if (p?.kind === "coupon") map[d.id] = p;
      });
      PROMOS_BY_ID = map;
      renderTable(); // update chips
    });

    // Promotions UI — guarded so it can’t break the rest
    try { initPromotions(); } catch (e) {
      console.error("Promotions init failed — continuing:", e);
    }

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
   Add Category/Course/Add-on
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
        const canvas = document.createElement("canvas");
        canvas.width = 200; canvas.height = 200;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 200, 200);
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
    e.preventDefault();
    if (statusMsg) statusMsg.innerText = "Adding...";

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
      if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) {
        if (statusMsg) statusMsg.innerText = "❌ Invalid Half/Full price"; return;
      }
      qtyType = { type: qtyTypeValue, halfPrice: half, fullPrice: full };
    }

    try {
      const resizedBlob = await resizeImage(imageFile);
      const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);
      await uploadBytes(imageRef, resizedBlob);
      const imageUrl = await getDownloadURL(imageRef);

      await addDoc(collection(db, "menuItems"), {
        name, description, category, foodCourse, foodType,
        qtyType, addons, imageUrl,
        inStock: true, createdAt: serverTimestamp(),
      });

      form.reset();
      qtyTypeSelect?.dispatchEvent(new Event("change"));
      setMultiHiddenValue(addonsSelect, []);
      updateAddonBtnLabel();
      if (statusMsg) statusMsg.innerText = "✅ Added!";
    } catch (err) {
      console.error(err); if (statusMsg) statusMsg.innerText = "❌ Error: " + err.message;
    }
  };
}

/* =========================
   Live snapshot + render
   ========================= */
function attachSnapshot() {
  onSnapshot(collection(db, "menuItems"), (snapshot) => {
    allItems = [];
    snapshot.forEach((docSnap) => allItems.push({ id: docSnap.id, data: docSnap.data() }));
    ensureSelectAllHeader();
    renderTable();
    updateBulkBar();
  }, (err) => {
    console.error("menuItems snapshot error", err);
  });
}

function ensureSelectAllHeader() {
  const thead = document.querySelector("#menuTable thead tr"); if (!thead) return;
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

function renderTable() {
  if (!menuBody) return;
  menuBody.innerHTML = "";
  const items = applyFilters(allItems);

  items.forEach(({ id, data: d }) => {
    const qty = d.qtyType || {};
    const priceText =
      qty.type === "Half & Full"
        ? `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}`
        : `₹${qty.itemPrice}`;

    const addonsText = Array.isArray(d.addons)
      ? d.addons.map(a => (typeof a === "string" ? a : `${a.name} (₹${a.price})`)).join(", ")
      : "";

    // Promo chips
    const promoIds = Array.isArray(d.promotions) ? d.promotions : [];
    const promoChips = promoIds.map((pid) => {
      const info = PROMOS_BY_ID[pid];
      if (!info) return `<span class="adm-pill">${pid.slice(0,5)}…</span>`;
      const pillClass = info.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery";
      const code = info.code || pid;
      const title = info.type === "percent" ? `${info.value}% off` : `₹${info.value} off`;
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
      const id = e.target.dataset.id;
      if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkBar(); syncSelectAllHeader(items);
    };
  });

  // Stock toggle
  document.querySelectorAll(".stockToggle").forEach((el) => {
    el.onchange = async (e) => {
      const id = e.target.dataset.id;
      const val = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", id), { inStock: val });
    };
  });

  // Delete
  document.querySelectorAll(".deleteBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      if (confirm("Delete this item?")) {
        await deleteDoc(doc(db, "menuItems", id));
        selectedIds.delete(id); updateBulkBar();
      }
    };
  });

  // Edit
  document.querySelectorAll(".editBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      const snap = await getDoc(doc(db, "menuItems", id));
      if (!snap.exists()) return alert("Item not found!");
      openEditModal(id, snap.data());
    };
  });

  // Add-ons assign
  document.querySelectorAll(".addonBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      const snap = await getDoc(doc(db, "menuItems", id));
      if (!snap.exists()) return alert("Item not found!");
      openAssignAddonsModal(id, Array.isArray(snap.data().addons) ? snap.data().addons : []);
    };
  });

  // Promotions assign
  document.querySelectorAll(".promoBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      const snap = await getDoc(doc(db, "menuItems", id));
      if (!snap.exists()) return alert("Item not found!");
      openAssignPromotionsModal(
        id,
        Array.isArray(snap.data().promotions) ? snap.data().promotions : []
      );
    };
  });

  // Header select-all sync
  syncSelectAllHeader(items);
}

/* =========================
   Bulk UI
   ========================= */
function ensureBulkBar() {
  if (document.getElementById("bulkBar")) return;
  const bar = document.createElement("div");
  bar.id = "bulkBar";
  bar.style.margin = "8px 0";
  bar.style.display = "flex";
  bar.style.gap = "8px";
  bar.innerHTML = `
    <button id="bulkEditBtn" disabled>Edit Selected (0)</button>
    <button id="bulkDeleteBtn" disabled>Delete Selected (0)</button>
  `;
  const table = document.getElementById("menuTable");
  if (table && table.parentNode) table.parentNode.insertBefore(bar, table);

  const bulkEditBtn = document.getElementById("bulkEditBtn");
  const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
  if (bulkEditBtn) bulkEditBtn.onclick = openBulkEditModal;
  if (bulkDeleteBtn) bulkDeleteBtn.onclick = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} item(s)?`)) return;
    const ops = [];
    selectedIds.forEach((id) => ops.push(deleteDoc(doc(db, "menuItems", id))));
    await Promise.all(ops);
    selectedIds.clear();
    updateBulkBar();
  };
}
function updateBulkBar() {
  ensureBulkBar();
  const n = selectedIds.size;
  const editBtn = document.getElementById("bulkEditBtn");
  const delBtn  = document.getElementById("bulkDeleteBtn");
  if (editBtn) { editBtn.textContent = `Edit Selected (${n})`; editBtn.disabled = n === 0; }
  if (delBtn)  { delBtn.textContent  = `Delete Selected (${n})`; delBtn.disabled  = n === 0; }
}
function syncSelectAllHeader(itemsRendered) {
  const cb = document.getElementById("selectAll");
  if (!cb) return;
  if (!itemsRendered.length) {
    cb.checked = false;
    cb.indeterminate = false;
    return;
  }
  const total = itemsRendered.length;
  let selected = 0;
  for (const { id } of itemsRendered) if (selectedIds.has(id)) selected++;
  cb.checked = selected === total;
  cb.indeterminate = selected > 0 && selected < total;
}

/* =========================
   Bulk Edit modal
   ========================= */
function openBulkEditModal() {
  let modal = document.getElementById("bulkModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "bulkModal";
    Object.assign(modal.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,.6)", display: "none", zIndex: "9999"
    });
    modal.innerHTML = `
      <div style="background:#fff; padding:18px; max-width:560px; margin:5% auto; border-radius:8px;">
        <h3 style="margin-top:0">Bulk Edit (<span id="bulkCount">0</span> items)</h3>
        <form id="bulkForm">
          <div style="display:grid; gap:10px;">
            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" id="bulkCatEnable" />
              <span>Category</span>
            </label>
            <select id="bulkCategory" disabled><option value="">-- Select Category --</option></select>

            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" id="bulkCourseEnable" />
              <span>Food Course</span>
            </label>
            <select id="bulkCourse" disabled><option value="">-- Select Food Course --</option></select>

            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" id="bulkTypeEnable" />
              <span>Food Type</span>
            </label>
            <select id="bulkType" disabled>
              <option value="">-- Select Type --</option>
              <option value="Veg">Veg</option>
              <option value="Non-Veg">Non-Veg</option>
            </select>

            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" id="bulkStockEnable" />
              <span>Stock Status</span>
            </label>
            <select id="bulkStock" disabled>
              <option value="">-- Select Stock --</option>
              <option value="true">In Stock</option>
              <option value="false">Out of Stock</option>
            </select>

            <label style="display:flex; gap:8px; align-items:center;">
              <input type="checkbox" id="bulkQtyEnable" />
              <span>Quantity & Price</span>
            </label>
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
          </div>

          <div style="margin-top:14px; display:flex; gap:8px; justify-content:flex-end;">
            <button type="submit" id="bulkApplyBtn">Apply</button>
            <button type="button" id="bulkCancelBtn">Cancel</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    // enable toggles
    const bulkCatEnable    = modal.querySelector("#bulkCatEnable");
    const bulkCourseEnable = modal.querySelector("#bulkCourseEnable");
    const bulkTypeEnable   = modal.querySelector("#bulkTypeEnable");
    const bulkStockEnable  = modal.querySelector("#bulkStockEnable");
    const bulkQtyEnable    = modal.querySelector("#bulkQtyEnable");

    const bulkCategory  = modal.querySelector("#bulkCategory");
    const bulkCourse    = modal.querySelector("#bulkCourse");
    const bulkType      = modal.querySelector("#bulkType");
    const bulkStock     = modal.querySelector("#bulkStock");
    const bulkQtyType   = modal.querySelector("#bulkQtyType");
    const bulkItemPrice = modal.querySelector("#bulkItemPrice");
    const bulkHFWrap    = modal.querySelector("#bulkHFWrap");
    const bulkHalfPrice = modal.querySelector("#bulkHalfPrice");
    const bulkFullPrice = modal.querySelector("#bulkFullPrice");

    bulkCatEnable.onchange    = () => bulkCategory.disabled = !bulkCatEnable.checked;
    bulkCourseEnable.onchange = () => bulkCourse.disabled   = !bulkCourseEnable.checked;
    bulkTypeEnable.onchange   = () => bulkType.disabled     = !bulkTypeEnable.checked;
    bulkStockEnable.onchange  = () => bulkStock.disabled    = !bulkStockEnable.checked;
    bulkQtyEnable.onchange    = () => {
      const on = bulkQtyEnable.checked;
      bulkQtyType.disabled = !on;
      toggleBulkQtyInputs();
    };

    function toggleBulkQtyInputs() {
      const vt = bulkQtyType.value;
      const on = bulkQtyEnable.checked;
      const showSingle = on && vt === "Not Applicable";
      const showHF     = on && vt === "Half & Full";
      bulkItemPrice.style.display = showSingle ? "block" : "none";
      bulkHFWrap.style.display    = showHF ? "block" : "none";
      bulkItemPrice.disabled = !showSingle;
      bulkHalfPrice.disabled = !showHF;
      bulkFullPrice.disabled = !showHF;
    }
    bulkQtyType.onchange = toggleBulkQtyInputs;

    modal.querySelector("#bulkCancelBtn").onclick = () => { modal.style.display = "none"; };
    modal.querySelector("#bulkForm").onsubmit = async (e) => {
      e.preventDefault();
      if (!selectedIds.size) { alert("No items selected."); return; }

      const updates = {};
      if (bulkCatEnable.checked) {
        if (!bulkCategory.value) return alert("Select a Category.");
        updates.category = bulkCategory.value;
      }
      if (bulkCourseEnable.checked) {
        if (!bulkCourse.value) return alert("Select a Course.");
        updates.foodCourse = bulkCourse.value;
      }
      if (bulkTypeEnable.checked) {
        if (!bulkType.value) return alert("Select a Food Type.");
        updates.foodType = bulkType.value;
      }
      if (bulkStockEnable.checked) {
        if (!bulkStock.value) return alert("Select Stock Status.");
        updates.inStock = (bulkStock.value === "true");
      }
      if (bulkQtyEnable.checked) {
        const vt = bulkQtyType.value;
        if (!vt) return alert("Select Qty Type.");
        if (vt === "Not Applicable") {
          const p = parseFloat(bulkItemPrice.value);
          if (isNaN(p) || p <= 0) return alert("Enter a valid Price.");
          updates.qtyType = { type: vt, itemPrice: p };
        } else if (vt === "Half & Full") {
          const h = parseFloat(bulkHalfPrice.value);
          const f = parseFloat(bulkFullPrice.value);
          if (isNaN(h) || isNaN(f) || h <= 0 || f <= 0) return alert("Enter valid Half/Full prices.");
          updates.qtyType = { type: vt, halfPrice: h, fullPrice: f };
        }
      }

      if (!Object.keys(updates).length) return alert("Tick at least one field to update.");

      try {
        modal.querySelector("#bulkApplyBtn").disabled = true;
        const ops = [];
        selectedIds.forEach((id) => ops.push(updateDoc(doc(db, "menuItems", id), updates)));
        await Promise.all(ops);
        modal.style.display = "none";
      } catch (err) {
        console.error(err);
        alert("Bulk update failed: " + (err?.message || err));
      } finally {
        modal.querySelector("#bulkApplyBtn").disabled = false;
      }
    };

    // store refs for reuse
    modal._refs = { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQtyInputs };
  }

  // open: refresh data
  modal.querySelector("#bulkCount").textContent = String(selectedIds.size);

  const { bulkCategory, bulkCourse, bulkType, bulkQtyType, toggleBulkQtyInputs } = modal._refs;
  loadCategories(bulkCategory);
  loadCourses(bulkCourse);
  bulkType.value = "";
  bulkQtyType.value = "";
  toggleBulkQtyInputs();

  modal.querySelector("#bulkCatEnable").checked = false;
  modal.querySelector("#bulkCourseEnable").checked = false;
  modal.querySelector("#bulkTypeEnable").checked = false;
  modal.querySelector("#bulkStockEnable").checked = false;
  modal.querySelector("#bulkQtyEnable").checked = false;

  bulkCategory.disabled = true;
  bulkCourse.disabled   = true;
  bulkType.disabled     = true;
  modal.querySelector("#bulkStock").disabled = true;
  bulkQtyType.disabled  = true;

  modal.style.display = "block";
}

/* =========================
   Search & Filters
   ========================= */
async function populateFilterDropdowns() {
  // categories
  const cats = await fetchCategories();
  if (filterCategory) {
    const prev = filterCategory.value;
    filterCategory.innerHTML = `<option value="">All Categories</option>` + cats.map(c => `<option>${c}</option>`).join("");
    filterCategory.value = prev || "";
  }
  // courses
  const courses = await fetchCourses();
  if (filterCourse) {
    const prev = filterCourse.value;
    filterCourse.innerHTML = `<option value="">All Courses</option>` + courses.map(c => `<option>${c}</option>`).join("");
    filterCourse.value = prev || "";
  }
}
function wireSearchAndFilters() {
  const debounced = debounce(() => { renderTable(); updateBulkBar(); }, 200);
  searchInput?.addEventListener("input", debounced);
  filterCategory?.addEventListener("change", () => { renderTable(); updateBulkBar(); });
  filterCourse?.addEventListener("change", () => { renderTable(); updateBulkBar(); });
  filterType?.addEventListener("change", () => { renderTable(); updateBulkBar(); });
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
      const addonHay = Array.isArray(d.addons)
        ? d.addons.map(a => (typeof a === "string" ? a : a.name)).join(" ")
        : "";
      const hay = `${d.name} ${d.description} ${d.category || ""} ${d.foodCourse || ""} ${addonHay}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* =========================
   Edit modal (single)
   ========================= */
function openEditModal(id, d) {
  editingId = id;
  if (!editModal) return;
  if (editName) editName.value = d.name || "";
  if (editDescription) editDescription.value = d.description || "";
  Promise.all([loadCategories(editCategory), loadCourses(editCourse)]).then(() => {
    if (editCategory) editCategory.value = d.category || "";
    if (editCourse) editCourse.value = d.foodCourse || "";
  });
  if (editType) editType.value = d.foodType || "Veg";
  if (editQtyType) editQtyType.value = (d.qtyType && d.qtyType.type) || "Not Applicable";
  toggleEditPriceInputs();
  if (editQtyType && editQtyType.value === "Not Applicable") {
    if (editItemPrice) editItemPrice.value = d.qtyType?.itemPrice ?? "";
  } else {
    if (editHalfPrice) editHalfPrice.value = d.qtyType?.halfPrice ?? "";
    if (editFullPrice) editFullPrice.value = d.qtyType?.fullPrice ?? "";
  }
  editModal.style.display = "block";
}
function closeEditModal() { editingId = null; editForm?.reset(); if (editModal) editModal.style.display = "none"; }
if (closeEditModalBtn) closeEditModalBtn.onclick = closeEditModal;

if (editQtyType) editQtyType.onchange = toggleEditPriceInputs;
function toggleEditPriceInputs() {
  if (!editQtyType) return;
  const v = editQtyType.value;
  if (editItemPrice) editItemPrice.style.display = v === "Not Applicable" ? "block" : "none";
  const showHF = v === "Half & Full";
  if (editHalfPrice) editHalfPrice.style.display = showHF ? "block" : "none";
  if (editFullPrice) editFullPrice.style.display = showHF ? "block" : "none";
}

if (editForm) {
  editForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!editingId) return;

    const name = (editName?.value || "").trim();
    const description = (editDescription?.value || "").trim();
    const category = editCategory?.value;
    const foodCourse = editCourse?.value;
    const foodType = editType?.value;
    const qtyTypeValue = editQtyType?.value;

    if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeValue) {
      return alert("Fill all fields");
    }

    let qtyType = {};
    if (qtyTypeValue === "Not Applicable") {
      const price = parseFloat(editItemPrice?.value);
      if (isNaN(price) || price <= 0) return alert("Invalid price");
      qtyType = { type: qtyTypeValue, itemPrice: price };
    } else {
      const half = parseFloat(editHalfPrice?.value);
      const full = parseFloat(editFullPrice?.value);
      if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) return alert("Invalid Half/Full price");
      qtyType = { type: qtyTypeValue, halfPrice: half, fullPrice: full };
    }

    try {
      let imageUrlUpdate = {};
      const file = document.getElementById("editImage")?.files?.[0];
      if (file) {
        const resized = await resizeImage(file);
        const imageRef = ref(storage, `menuImages/${Date.now()}_${file.name}`);
        await uploadBytes(imageRef, resized);
        const newUrl = await getDownloadURL(imageRef);
        imageUrlUpdate = { imageUrl: newUrl };
      }

      await updateDoc(doc(db, "menuItems", editingId), {
        name, description, category, foodCourse, foodType, qtyType,
        updatedAt: serverTimestamp(), ...imageUrlUpdate,
      });

      closeEditModal();
    } catch (err) {
      console.error(err);
      alert("Update failed: " + err.message);
    }
  };
}

/* =========================
   Category dropdown (comic style)
   ========================= */
async function renderCustomCategoryDropdown() {
  if (!catBtn || !catPanel) return;

  const categories = await fetchCategories();
  const current = categoryDropdown?.value || "";

  catPanel.innerHTML = categories.map(name => {
    const checked = name === current ? "checked" : "";
    return `
      <div class="cat-row" data-name="${name}">
        <span class="cat-check ${checked}" data-role="check" title="Select"></span>
        <span class="cat-label" data-role="label" title="${name}">${name}</span>
        <button class="cat-btn" title="Edit" data-role="edit">✏️</button>
        <button class="cat-btn" title="Delete" data-role="delete">🗑️</button>
      </div>
    `;
  }).join("");

  catPanel.onmousedown = (e) => e.stopPropagation();
  catPanel.onclick = async (e) => {
    e.stopPropagation();
    const row = e.target.closest(".cat-row"); if (!row) return;
    const role = e.target.getAttribute("data-role");
    const name = row.getAttribute("data-name");

    // Select / Unselect
    if (role === "check" || role === "label") {
      const isChecked = row.querySelector(".cat-check").classList.contains("checked");
      if (isChecked) {
        row.querySelector(".cat-check").classList.remove("checked");
        setHiddenValue(categoryDropdown, "");
        catBtn.textContent = `Select Category ▾`;
        return;
      }
      catPanel.querySelectorAll(".cat-check").forEach(c => c.classList.remove("checked"));
      row.querySelector(".cat-check").classList.add("checked");
      setHiddenValue(categoryDropdown, name);
      catBtn.textContent = `${name} ▾`;
      return;
    }

    // Edit inline
    if (role === "edit") {
      const oldName = name;
      row.innerHTML = `
        <div class="inline-controls">
          <input class="cat-input" type="text" value="${oldName}" />
          <button class="cat-btn" data-role="save">✔</button>
          <button class="cat-btn" data-role="cancel">✖</button>
        </div>
      `;
      row.onclick = async (ev) => {
        ev.stopPropagation();
        const r = ev.target.getAttribute("data-role");
        if (r === "cancel") { await renderCustomCategoryDropdown(); return; }
        if (r === "save") {
          const newVal = row.querySelector(".cat-input").value.trim();
          if (!newVal) return alert("Enter a valid category");
          if (newVal === oldName) { await renderCustomCategoryDropdown(); return; }
          try {
            row.querySelector(".cat-input").disabled = true;
            await renameCategoryEverywhere(oldName, newVal);
            if (categoryDropdown?.value === oldName) {
              setHiddenValue(categoryDropdown, newVal);
              catBtn.textContent = `${newVal} ▾`;
            }
            await loadCategories(categoryDropdown);
            await renderCustomCategoryDropdown();
            await populateFilterDropdowns();
          } catch (err) {
            console.error(err); alert("Rename failed: " + (err?.message || err));
            await renderCustomCategoryDropdown();
          }
        }
      };
      return;
    }

    // Delete
    if (role === "delete") {
      if (!confirm(`Delete category "${name}"?\n(Items will NOT be deleted; category field will be cleared.)`)) return;
      try {
        if (categoryDropdown?.value === name) {
          setHiddenValue(categoryDropdown, "");
          catBtn.textContent = `Select Category ▾`;
        }
        await deleteCategoryEverywhere(name);
        await loadCategories(categoryDropdown);
        await renderCustomCategoryDropdown();
        await populateFilterDropdowns();
      } catch (err) {
        console.error(err); alert("Delete failed: " + (err?.message || err));
      }
      return;
    }
  };

  catBtn.onclick = (e) => {
    e.stopPropagation();
    const opening = !catPanel.style.display || catPanel.style.display === "none";
    catPanel.style.display = opening ? "block" : "none";
    if (opening) {
      const handler = function(ev) {
        if (!catPanel.contains(ev.target) && !catBtn.contains(ev.target)) {
          catPanel.style.display = "none";
          document.removeEventListener("mousedown", handler);
        }
      };
      document.addEventListener("mousedown", handler);
    }
  };
}

/* =========================
   Course dropdown (comic style)
   ========================= */
async function renderCustomCourseDropdown() {
  if (!courseBtn || !coursePanel) return;

  const courses = await fetchCourses();
  const current = foodCourseDropdown?.value || "";

  coursePanel.innerHTML = courses.map(name => {
    const checked = name === current ? "checked" : "";
    return `
      <div class="course-row" data-name="${name}">
        <span class="course-check ${checked}" data-role="check" title="Select"></span>
        <span class="course-label" data-role="label" title="${name}">${name}</span>
        <button class="course-btn" title="Edit" data-role="edit">✏️</button>
        <button class="course-btn" title="Delete" data-role="delete">🗑️</button>
      </div>
    `;
  }).join("");

  coursePanel.onmousedown = (e) => e.stopPropagation();
  coursePanel.onclick = async (e) => {
    e.stopPropagation();
    const row = e.target.closest(".course-row"); if (!row) return;
    const role = e.target.getAttribute("data-role");
    const name = row.getAttribute("data-name");

    // Select / Unselect
    if (role === "check" || role === "label") {
      const isChecked = row.querySelector(".course-check").classList.contains("checked");
      if (isChecked) {
        row.querySelector(".course-check").classList.remove("checked");
        setHiddenValue(foodCourseDropdown, "");
        courseBtn.textContent = `Select Course ▾`;
        return;
      }
      coursePanel.querySelectorAll(".course-check").forEach(c => c.classList.remove("checked"));
      row.querySelector(".course-check").classList.add("checked");
      setHiddenValue(foodCourseDropdown, name);
      courseBtn.textContent = `${name} ▾`;
      return;
    }

    // Edit inline
    if (role === "edit") {
      const oldName = name;
      row.innerHTML = `
        <div class="inline-controls">
          <input class="course-input" type="text" value="${oldName}" />
          <button class="course-btn" data-role="save">✔</button>
          <button class="course-btn" data-role="cancel">✖</button>
        </div>
      `;
      row.onclick = async (ev) => {
        ev.stopPropagation();
        const r = ev.target.getAttribute("data-role");
        if (r === "cancel") { await renderCustomCourseDropdown(); return; }
        if (r === "save") {
          const newVal = row.querySelector(".course-input").value.trim();
          if (!newVal) return alert("Enter a valid course");
          if (newVal === oldName) { await renderCustomCourseDropdown(); return; }
          try {
            row.querySelector(".course-input").disabled = true;
            await renameCourseEverywhere(oldName, newVal);
            if (foodCourseDropdown?.value === oldName) {
              setHiddenValue(foodCourseDropdown, newVal);
              courseBtn.textContent = `${newVal} ▾`;
            }
            await loadCourses(foodCourseDropdown);
            await renderCustomCourseDropdown();
            await populateFilterDropdowns();
          } catch (err) {
            console.error(err); alert("Rename failed: " + (err?.message || err));
            await renderCustomCourseDropdown();
          }
        }
      };
      return;
    }

    // Delete
    if (role === "delete") {
      if (!confirm(`Delete course "${name}"?\n(Items will NOT be deleted; course field will be cleared.)`)) return;
      try {
        if (foodCourseDropdown?.value === name) {
          setHiddenValue(foodCourseDropdown, "");
          courseBtn.textContent = `Select Course ▾`;
        }
        await deleteCourseEverywhere(name);
        await loadCourses(foodCourseDropdown);
        await renderCustomCourseDropdown();
        await populateFilterDropdowns();
      } catch (err) {
        console.error(err); alert("Delete failed: " + (err?.message || err));
      }
      return;
    }
  };

  courseBtn.onclick = (e) => {
    e.stopPropagation();
    const opening = !coursePanel.style.display || coursePanel.style.display === "none";
    coursePanel.style.display = opening ? "block" : "none";
    if (opening) {
      const handler = function(ev) {
        if (!coursePanel.contains(ev.target) && !courseBtn.contains(ev.target)) {
          coursePanel.style.display = "none";
          document.removeEventListener("mousedown", handler);
        }
      };
      document.addEventListener("mousedown", handler);
    }
  };
}

/* =========================
   Add-ons (custom multi)
   ========================= */
async function renderCustomAddonDropdown() {
  if (!addonBtn || !addonPanel) return;

  const addons = await fetchAddons();
  const selected = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));

  addonPanel.innerHTML = addons.map(a => {
    const checked = selected.has(a.name) ? "checked" : "";
    return `
      <div class="addon-row" data-name="${a.name}">
        <span class="addon-check ${checked}" data-role="check" title="Toggle"></span>
        <span class="addon-label" data-role="label" title="${a.name}">${a.name} (₹${a.price})</span>
        <button class="addon-btn" title="Edit" data-role="edit">✏️</button>
        <button class="addon-btn" title="Delete" data-role="delete">🗑️</button>
      </div>
    `;
  }).join("");

  addonPanel.onmousedown = (e)=> e.stopPropagation();
  addonPanel.onclick = async (e) => {
    e.stopPropagation();
    const row = e.target.closest(".addon-row"); if (!row) return;
    const role = e.target.getAttribute("data-role");
    const name = row.getAttribute("data-name");

    // SELECT / UNSELECT (multi)
    if (role === "check" || role === "label") {
      const el = row.querySelector(".addon-check");
      const isChecked = el.classList.contains("checked");
      const values = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));
      if (isChecked) { el.classList.remove("checked"); values.delete(name); }
      else { el.classList.add("checked"); values.add(name); }
      setMultiHiddenValue(addonsSelect, Array.from(values));
      updateAddonBtnLabel();
      return;
    }

    // INLINE EDIT
    if (role === "edit") {
      const oldName = name;
      row.innerHTML = `
        <div class="inline-controls">
          <input class="addon-input" type="text" value="${oldName}" />
          <button class="addon-btn" data-role="save">✔</button>
          <button class="addon-btn" data-role="cancel">✖</button>
        </div>
      `;
      row.onclick = async (ev) => {
        ev.stopPropagation();
        const r = ev.target.getAttribute("data-role");
        if (r === "cancel") { await renderCustomAddonDropdown(); return; }
        if (r === "save") {
          const newVal = row.querySelector(".addon-input").value.trim();
          if (!newVal) return alert("Enter a valid add-on");
          if (newVal === oldName) { await renderCustomAddonDropdown(); return; }
          try {
            row.querySelector(".addon-input").disabled = true;
            await renameAddonEverywhere(oldName, newVal);
            const sel = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));
            if (sel.has(oldName)) { sel.delete(oldName); sel.add(newVal); }
            await loadAddons(addonsSelect);
            setMultiHiddenValue(addonsSelect, Array.from(sel));
            await renderCustomAddonDropdown();
            updateAddonBtnLabel();
          } catch (err) {
            console.error(err); alert("Rename failed: " + (err?.message || err));
            await renderCustomAddonDropdown();
          }
        }
      };
      return;
    }

    // DELETE
    if (role === "delete") {
      if (!confirm(`Delete add-on "${name}"?\n(Items will NOT be deleted; the add-on will be removed from them.)`)) return;
      try {
        const sel = new Set(Array.from(addonsSelect?.selectedOptions || []).map(o=>o.value));
        sel.delete(name);
        await deleteAddonEverywhere(name);
        await loadAddons(addonsSelect);
        setMultiHiddenValue(addonsSelect, Array.from(sel));
        await renderCustomAddonDropdown();
        updateAddonBtnLabel();
      } catch (err) {
        console.error(err); alert("Delete failed: " + (err?.message || err));
      }
      return;
    }
  };

  addonBtn.onclick = (e) => {
    e.stopPropagation();
    const opening = !addonPanel.style.display || addonPanel.style.display === "none";
    addonPanel.style.display = opening ? "block" : "none";
    if (opening) {
      const handler = (ev) => {
        if (!addonPanel.contains(ev.target) && !addonBtn.contains(ev.target)) {
          addonPanel.style.display = "none";
          document.removeEventListener("mousedown", handler);
        }
      };
      document.addEventListener("mousedown", handler);
    }
  };

  updateAddonBtnLabel();
}
function updateAddonBtnLabel() {
  if (!addonBtn || !addonsSelect) return;
  const vals = Array.from(addonsSelect.selectedOptions || []).map(o=>o.value);
  if (!vals.length) addonBtn.textContent = "Select Add-ons ▾";
  else if (vals.length <= 2) addonBtn.textContent = `${vals.join(", ")} ▾`;
  else addonBtn.textContent = `${vals[0]}, ${vals[1]} +${vals.length-2} ▾`;
}

/* =========================
   Assign Add-ons modal
   ========================= */
function openAssignAddonsModal(itemId, current) {
  let modal = document.getElementById("addonAssignModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "addonAssignModal";
    Object.assign(modal.style, { position:"fixed", inset:0, background:"rgba(0,0,0,.6)", display:"none", zIndex:9999 });
    modal.innerHTML = `
      <div style="background:#fff; padding:18px; max-width:520px; margin:5% auto; border-radius:8px;">
        <h3 style="margin-top:0">Assign Add-ons</h3>
        <div id="assignAddonList" style="max-height:300px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:6px;"></div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button id="assignAddonSave">Save</button>
          <button id="assignAddonCancel">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#assignAddonCancel").onclick = () => modal.style.display = "none";
  }

  (async () => {
    const list = modal.querySelector("#assignAddonList");
    const addons = await fetchAddons();
    const cur = new Set((current || []).map(a => typeof a === "string" ? a : a.name));

    list.innerHTML = addons.map(a => `
      <label style="display:flex; align-items:center; gap:8px; padding:6px 4px;">
        <input type="checkbox" value="${a.name}" ${cur.has(a.name) ? "checked" : ""} />
        <span>${a.name} (₹${a.price})</span>
      </label>
    `).join("");

    modal.querySelector("#assignAddonSave").onclick = async () => {
      const chosen = addons
        .filter(a => list.querySelector(`input[value="${a.name}"]`)?.checked)
        .map(a => ({ name: a.name, price: a.price })); // store as objects
      try {
        await updateDoc(doc(db, "menuItems", itemId), { addons: chosen });
        modal.style.display = "none";
      } catch (err) {
        console.error(err); alert("Failed to assign add-ons: " + (err?.message || err));
      }
    };

    modal.style.display = "block";
  })();
}

/* =========================
   Assign Promotions modal
   ========================= */
async function openAssignPromotionsModal(itemId, currentIds) {
  const promosSnap = await getDocs(collection(db, "promotions"));
  const coupons = [];
  promosSnap.forEach((d) => {
    const p = d.data();
    if (p && p.kind === "coupon") coupons.push({ id: d.id, p });
  });

  let modal = document.getElementById("promoAssignModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "promoAssignModal";
    Object.assign(modal.style, {
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "none", zIndex: 9999,
    });
    modal.innerHTML = `
      <div style="background:#fff; padding:18px; max-width:520px; margin:5% auto; border-radius:12px; border:2px solid #111; box-shadow:5px 5px 0 #111;">
        <h3 style="margin:0 0 10px">Attach Promotions</h3>
        <div id="promoAssignList" style="max-height:340px; overflow:auto; border:1px solid #eee; border-radius:8px; padding:8px;"></div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button id="promoAssignSave" class="adm-btn adm-btn--primary">Save</button>
          <button id="promoAssignCancel" class="adm-btn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const listEl = modal.querySelector("#promoAssignList");
  listEl.innerHTML = "";
  const set = new Set(Array.isArray(currentIds) ? currentIds : []);
  if (!coupons.length) {
    listEl.innerHTML = `<div class="adm-muted">No promotions found. Create a coupon in Promotions first.</div>`;
  } else {
    coupons.forEach(({ id, p }) => {
      const row = document.createElement("label");
      row.style.cssText = "display:flex; align-items:center; gap:10px; padding:6px 8px; border-bottom:1px solid #f1f1f1;";
      const typeText = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
      const chan = (p.channel || "").toLowerCase() === "dining" ? "Dining" : "Delivery";
      row.innerHTML = `
        <input type="checkbox" class="promoAssignChk" value="${id}" ${ set.has(id) ? "checked" : "" }/>
        <div style="display:flex; flex-direction:column;">
          <div><strong>${p.code || "(no code)"}</strong> • <em>${chan}</em></div>
          <div style="font-size:12px; color:#555;">${typeText}${p.minOrder ? ` • Min ₹${p.minOrder}` : ""}${p.active === false ? ` • inactive` : ""}</div>
        </div>
      `;
      listEl.appendChild(row);
    });
  }

  modal.querySelector("#promoAssignCancel").onclick = () => (modal.style.display = "none");
  modal.querySelector("#promoAssignSave").onclick = async () => {
    const ids = [...modal.querySelectorAll(".promoAssignChk:checked")].map((i) => i.value);
    try {
      await updateDoc(doc(db, "menuItems", itemId), { promotions: ids });
      modal.style.display = "none";
    } catch (err) {
      console.error(err);
      alert("Failed to save promotions: " + (err?.message || err));
    }
  };

  modal.style.display = "block";
}

/* =========================
   Helpers
   ========================= */
function setHiddenValue(selectEl, val) {
  if (!selectEl) return;
  let opt = [...selectEl.options].find(o => o.value === val);
  if (!opt) { opt = document.createElement("option"); opt.value = val; opt.textContent = val; selectEl.appendChild(opt); }
  selectEl.value = val;
}
function setMultiHiddenValue(selectEl, values=[]) {
  if (!selectEl) return;
  const set = new Set(values);
  values.forEach(v => {
    if (![...selectEl.options].some(o=>o.value===v)) {
      const opt = document.createElement("option"); opt.value=v; opt.textContent=v; selectEl.appendChild(opt);
    }
  });
  [...selectEl.options].forEach(o => { o.selected = set.has(o.value); });
}
function debounce(fn, delay=300){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); }; }
