import { auth, db } from "./firebase.js";
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
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import {
  // existing
  loadCategories, loadCourses,
  fetchCategories, fetchCourses,
  addCategory, addCourse,
  renameCategoryEverywhere, renameCourseEverywhere,
  deleteCategoryEverywhere, deleteCourseEverywhere,
  // new: addons
  loadAddons, fetchAddons, addAddon,
  renameAddonEverywhere, deleteAddonEverywhere,
} from "./categoryCourse.js";

// ---------- Storage ----------
const storage = getStorage(undefined, "gs://gufa-restaurant.firebasestorage.app");

// ---------- DOM ----------
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
const editImage = document.getElementById("editImage");

// ---------- State ----------
let allItems = []; // [{id, data}]
let selectedIds = new Set();
let editingId = null;

// ---------- Auth ----------
loginBtn.onclick = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => { email.value=""; password.value=""; })
    .catch(err => alert("Login failed: " + err.message));
};
logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";

    // Load hidden selects
    await loadCategories(categoryDropdown);
    await loadCourses(foodCourseDropdown);
    await loadAddons(addonsSelect);

    // Render custom dropdowns
    await renderCustomCategoryDropdown();
    await renderCustomCourseDropdown();
    await renderCustomAddonDropdown();

    // Filters
    await populateFilterDropdowns();
    wireSearchAndFilters();

    // Live list
    attachSnapshot();
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

// ---------- Pricing toggle ----------
qtyTypeSelect.onchange = () => {
  const value = qtyTypeSelect.value;
  itemPrice.style.display = value === "Not Applicable" ? "block" : "none";
  const showHF = value === "Half & Full";
  halfPrice.style.display = fullPrice.style.display = showHF ? "block" : "none";
};

// ---------- Add Category/Course/Add-on ----------
addCategoryBtn.onclick = async () => {
  await addCategory(newCategoryInput, () => loadCategories(categoryDropdown));
  await renderCustomCategoryDropdown(); await populateFilterDropdowns();
};
addCourseBtn.onclick = async () => {
  await addCourse(newCourseInput, () => loadCourses(foodCourseDropdown));
  await renderCustomCourseDropdown(); await populateFilterDropdowns();
};
addAddonBtn.onclick = async () => {
  await addAddon(newAddonInput, () => loadAddons(addonsSelect));
  await renderCustomAddonDropdown();
};

// ---------- Image resize ----------
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

// ---------- Add new menu item ----------
form.onsubmit = async (e) => {
  e.preventDefault();
  statusMsg.innerText = "Adding...";

  const name = itemName.value.trim();
  const description = itemDescription.value.trim();
  const category = categoryDropdown.value;
  const foodCourse = foodCourseDropdown.value;
  const foodType = foodTypeSelect.value;
  const qtyTypeValue = qtyTypeSelect.value;
  const imageFile = itemImage.files[0];
  const addons = Array.from(addonsSelect.selectedOptions).map(o => o.value);

  if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeValue || !imageFile) {
    statusMsg.innerText = "❌ Fill all fields"; return;
  }

  let qtyType = {};
  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(itemPrice.value);
    if (isNaN(price) || price <= 0) { statusMsg.innerText = "❌ Invalid price"; return; }
    qtyType = { type: qtyTypeValue, itemPrice: price };
  } else if (qtyTypeValue === "Half & Full") {
    const half = parseFloat(halfPrice.value), full = parseFloat(fullPrice.value);
    if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) {
      statusMsg.innerText = "❌ Invalid Half/Full price"; return;
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

    form.reset(); qtyTypeSelect.dispatchEvent(new Event("change"));
    // clear add-ons UI
    setMultiHiddenValue(addonsSelect, []);
    updateAddonBtnLabel();
    statusMsg.innerText = "✅ Added!";
  } catch (err) {
    console.error(err); statusMsg.innerText = "❌ Error: " + err.message;
  }
};

// ---------- Live snapshot + render ----------
function attachSnapshot() {
  onSnapshot(collection(db, "menuItems"), (snapshot) => {
    allItems = [];
    snapshot.forEach((docSnap) => allItems.push({ id: docSnap.id, data: docSnap.data() }));
    ensureSelectAllHeader();
    renderTable();
    updateBulkBar();
  });
}
function ensureSelectAllHeader() {
  const thead = document.querySelector("#menuTable thead tr"); if (!thead) return;
  if (!thead.querySelector("#selectAll")) {
    const th = document.createElement("th");
    th.innerHTML = `<input type="checkbox" id="selectAll" title="Select all" />`;
    thead.insertBefore(th, thead.firstElementChild);
    document.getElementById("selectAll").onchange = (e) => {
      const checked = e.target.checked;
      if (checked) selectedIds = new Set(allItems.map((i) => i.id)); else selectedIds.clear();
      renderTable(); updateBulkBar();
    };
  }
}

function renderTable() {
  menuBody.innerHTML = "";
  const items = applyFilters(allItems);

  items.forEach(({ id, data: d }) => {
    const qty = d.qtyType || {};
    const priceText =
      qty.type === "Half & Full"
        ? `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}`
        : `₹${qty.itemPrice}`;
    const addonsText = Array.isArray(d.addons) && d.addons.length ? d.addons.join(", ") : "";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="rowSelect" data-id="${id}" ${selectedIds.has(id) ? "checked" : ""}></td>
      <td>${d.name}</td>
      <td>${d.description}</td>
      <td>${d.category || ""}</td>
      <td>${d.foodCourse || ""}</td>
      <td>${d.foodType}</td>
      <td>${qty.type || ""}</td>
      <td>${priceText || ""}</td>
      <td>${addonsText}</td>
      <td><img src="${d.imageUrl}" width="50" /></td>
      <td>
        <select class="stockToggle" data-id="${id}">
          <option value="true" ${d.inStock ? "selected" : ""}>In Stock</option>
          <option value="false" ${!d.inStock ? "selected" : ""}>Out of Stock</option>
        </select>
      </td>
      <td>
        <button class="addonBtn" data-id="${id}">Add On</button>
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
  // Single delete
  document.querySelectorAll(".deleteBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      if (confirm("Delete this item?")) {
        await deleteDoc(doc(db, "menuItems", id));
        selectedIds.delete(id); updateBulkBar();
      }
    };
  });
  // Edit open
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

  // header checkbox sync
  syncSelectAllHeader(items);
}

// ---------- Bulk bar ----------
function ensureBulkBar() {
  if (document.getElementById("bulkBar")) return;
  const bar = document.createElement("div");
  bar.id = "bulkBar";
  bar.style.margin = "8px 0";
  bar.style.display = "flex"; bar.style.gap = "8px";
  bar.innerHTML = `
    <button id="bulkDeleteBtn" disabled>Delete Selected (0)</button>
  `;
  const table = document.getElementById("menuTable");
  table.parentNode.insertBefore(bar, table);
  document.getElementById("bulkDeleteBtn").onclick = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} item(s)?`)) return;
    const ops = []; selectedIds.forEach((id) => ops.push(deleteDoc(doc(db, "menuItems", id))));
    await Promise.all(ops);
    selectedIds.clear(); updateBulkBar();
  };
}
function updateBulkBar() {
  ensureBulkBar();
  const n = selectedIds.size;
  const btn = document.getElementById("bulkDeleteBtn");
  if (btn) { btn.textContent = `Delete Selected (${n})`; btn.disabled = n === 0; }
}
function syncSelectAllHeader(itemsRendered) {
  const cb = document.getElementById("selectAll"); if (!cb) return;
  if (!itemsRendered.length) { cb.checked=false; cb.indeterminate=false; return; }
  const total = itemsRendered.length;
  let selected = 0; for (const {id} of itemsRendered) if (selectedIds.has(id)) selected++;
  cb.checked = selected === total; cb.indeterminate = selected > 0 && selected < total;
}

// ---------- Search & Filters ----------
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
      const hay = `${d.name} ${d.description} ${d.category || ""} ${d.foodCourse || ""} ${(d.addons||[]).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
async function populateFilterDropdowns() {
  if (filterCategory) {
    const cats = await fetchCategories();
    const cur = filterCategory.value;
    filterCategory.innerHTML = `<option value="">All Categories</option>` + cats.map(c=>`<option value="${c}">${c}</option>`).join("");
    if (cur && cats.includes(cur)) filterCategory.value = cur;
  }
  if (filterCourse) {
    const crs = await fetchCourses();
    const cur = filterCourse.value;
    filterCourse.innerHTML = `<option value="">All Courses</option>` + crs.map(c=>`<option value="${c}">${c}</option>`).join("");
    if (cur && crs.includes(cur)) filterCourse.value = cur;
  }
}

// ---------- Edit modal (unchanged fields) ----------
function openEditModal(id, d) {
  editingId = id;
  editName.value = d.name || "";
  editDescription.value = d.description || "";
  Promise.all([loadCategories(editCategory), loadCourses(editCourse)]).then(() => {
    editCategory.value = d.category || ""; editCourse.value = d.foodCourse || "";
  });
  editType.value = d.foodType || "Veg";
  editQtyType.value = (d.qtyType && d.qtyType.type) || "Not Applicable";
  toggleEditPriceInputs();
  if (editQtyType.value === "Not Applicable") {
    editItemPrice.value = d.qtyType?.itemPrice ?? "";
  } else {
    editHalfPrice.value = d.qtyType?.halfPrice ?? "";
    editFullPrice.value = d.qtyType?.fullPrice ?? "";
  }
  editModal.style.display = "block";
}
function closeEditModal(){ editingId=null; editForm.reset(); editModal.style.display="none"; }
closeEditModalBtn.onclick = closeEditModal;

editQtyType.onchange = toggleEditPriceInputs;
function toggleEditPriceInputs() {
  const v = editQtyType.value;
  editItemPrice.style.display = v === "Not Applicable" ? "block" : "none";
  const showHF = v === "Half & Full";
  editHalfPrice.style.display = editFullPrice.style.display = showHF ? "block" : "none";
}
editForm.onsubmit = async (e) => {
  e.preventDefault(); if (!editingId) return;

  const name = editName.value.trim();
  const description = editDescription.value.trim();
  const category = editCategory.value;
  const foodCourse = editCourse.value;
  const foodType = editType.value;
  const qtyTypeValue = editQtyType.value;

  if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeValue) return alert("Fill all fields");

  let qtyType = {};
  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(editItemPrice.value);
    if (isNaN(price) || price <= 0) return alert("Invalid price");
    qtyType = { type: qtyTypeValue, itemPrice: price };
  } else {
    const half = parseFloat(editHalfPrice.value), full = parseFloat(editFullPrice.value);
    if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) return alert("Invalid Half/Full price");
    qtyType = { type: qtyTypeValue, halfPrice: half, fullPrice: full };
  }

  try {
    let imageUrlUpdate = {};
    const file = editImage.files[0];
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
    console.error(err); alert("Update failed: " + err.message);
  }
};

// ---------- Custom dropdowns (Category/Course) ----------
/* (your existing renderCustomCategoryDropdown & renderCustomCourseDropdown stay unchanged) */

// ---------- Add-ons: custom multi dropdown with inline edit/delete ----------
async function renderCustomAddonDropdown() {
  if (!addonBtn || !addonPanel) return;

  const addons = await fetchAddons();
  const selected = new Set(Array.from(addonsSelect.selectedOptions).map(o=>o.value));

  addonPanel.innerHTML = addons.map(name => {
    const checked = selected.has(name) ? "checked" : "";
    return `
      <div class="addon-row" data-name="${name}">
        <span class="addon-check ${checked}" data-role="check" title="Toggle"></span>
        <span class="addon-label" data-role="label" title="${name}">${name}</span>
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
      const values = new Set(Array.from(addonsSelect.selectedOptions).map(o=>o.value));
      if (isChecked) {
        el.classList.remove("checked"); values.delete(name);
      } else {
        el.classList.add("checked"); values.add(name);
      }
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
            // keep selection if it was selected
            const sel = new Set(Array.from(addonsSelect.selectedOptions).map(o=>o.value));
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
        const sel = new Set(Array.from(addonsSelect.selectedOptions).map(o=>o.value));
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
  const vals = Array.from(addonsSelect.selectedOptions).map(o=>o.value);
  if (!vals.length) addonBtn.textContent = "Select Add-ons ▾";
  else if (vals.length <= 2) addonBtn.textContent = `${vals.join(", ")} ▾`;
  else addonBtn.textContent = `${vals[0]}, ${vals[1]} +${vals.length-2} ▾`;
}

// ---------- Assign Add-ons to a single item ----------
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

  // render list
  (async () => {
    const list = modal.querySelector("#assignAddonList");
    const addons = await fetchAddons();
    const cur = new Set(current || []);
    list.innerHTML = addons.map(a => `
      <label style="display:flex; align-items:center; gap:8px; padding:6px 4px;">
        <input type="checkbox" value="${a}" ${cur.has(a) ? "checked" : ""} />
        <span>${a}</span>
      </label>
    `).join("");

    modal.querySelector("#assignAddonSave").onclick = async () => {
      const chosen = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(el=>el.value);
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

// ---------- Helpers ----------
function setHiddenValue(selectEl, val) {
  let opt = [...selectEl.options].find(o => o.value === val);
  if (!opt) { opt = document.createElement("option"); opt.value = val; opt.textContent = val; selectEl.appendChild(opt); }
  selectEl.value = val;
}
function setMultiHiddenValue(selectEl, values=[]) {
  const set = new Set(values);
  // ensure options exist
  values.forEach(v => {
    if (![...selectEl.options].some(o=>o.value===v)) {
      const opt = document.createElement("option"); opt.value=v; opt.textContent=v; selectEl.appendChild(opt);
    }
  });
  // set selection
  [...selectEl.options].forEach(o => { o.selected = set.has(o.value); });
}
function debounce(fn, delay=300){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); }; }
