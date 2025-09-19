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
  getDocs,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import {
  loadCategories,
  loadCourses,
  fetchCategories,
  fetchCourses,
  addCategory,
  addCourse,
  renameCategoryEverywhere,
  renameCourseEverywhere,
  deleteCategoryEverywhere,
  deleteCourseEverywhere,
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

// Custom dropdown DOM
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
    .then(() => {
      email.value = "";
      password.value = "";
    })
    .catch((err) => alert("Login failed: " + err.message));
};
logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";

    // Hidden selects for form value
    await loadCategories(categoryDropdown);
    await loadCourses(foodCourseDropdown);

    // Custom dropdowns
    await renderCustomCategoryDropdown();
    await renderCustomCourseDropdown();

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

// ---------- Add Category/Course ----------
addCategoryBtn.onclick = async () => {
  await addCategory(newCategoryInput, () => loadCategories(categoryDropdown));
  await renderCustomCategoryDropdown();
  await populateFilterDropdowns();
};
addCourseBtn.onclick = async () => {
  await addCourse(newCourseInput, () => loadCourses(foodCourseDropdown));
  await renderCustomCourseDropdown();
  await populateFilterDropdowns();
};

// ---------- Image resize ----------
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 200;
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

  if (
    !name ||
    !description ||
    !category ||
    !foodCourse ||
    !foodType ||
    !qtyTypeValue ||
    !imageFile
  ) {
    statusMsg.innerText = "❌ Fill all fields";
    return;
  }

  let qtyType = {};
  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(itemPrice.value);
    if (isNaN(price) || price <= 0) {
      statusMsg.innerText = "❌ Invalid price";
      return;
    }
    qtyType = { type: qtyTypeValue, itemPrice: price };
  } else if (qtyTypeValue === "Half & Full") {
    const half = parseFloat(halfPrice.value);
    const full = parseFloat(fullPrice.value);
    if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) {
      statusMsg.innerText = "❌ Invalid Half/Full price";
      return;
    }
    qtyType = { type: qtyTypeValue, halfPrice: half, fullPrice: full };
  }

  try {
    const resizedBlob = await resizeImage(imageFile);
    const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);
    await uploadBytes(imageRef, resizedBlob);
    const imageUrl = await getDownloadURL(imageRef);

    await addDoc(collection(db, "menuItems"), {
      name,
      description,
      category,
      foodCourse,
      foodType,
      qtyType,
      imageUrl,
      inStock: true,
      createdAt: serverTimestamp(),
    });

    form.reset();
    qtyTypeSelect.dispatchEvent(new Event("change"));
    statusMsg.innerText = "✅ Added!";
  } catch (err) {
    console.error(err);
    statusMsg.innerText = "❌ Error: " + err.message;
  }
};

// ---------- Live snapshot + render ----------
function attachSnapshot() {
  onSnapshot(collection(db, "menuItems"), (snapshot) => {
    allItems = [];
    snapshot.forEach((docSnap) =>
      allItems.push({ id: docSnap.id, data: docSnap.data() })
    );
    ensureSelectAllHeader();
    renderTable();
    updateBulkBar();
  });
}

function ensureSelectAllHeader() {
  const thead = document.querySelector("#menuTable thead tr");
  if (!thead) return;
  if (!thead.querySelector("#selectAll")) {
    const th = document.createElement("th");
    th.innerHTML = `<input type="checkbox" id="selectAll" title="Select all" />`;
    thead.insertBefore(th, thead.firstElementChild);
    document.getElementById("selectAll").onchange = (e) => {
      const checked = e.target.checked;
      if (checked) selectedIds = new Set(allItems.map((i) => i.id));
      else selectedIds.clear();
      renderTable();
      updateBulkBar();
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
      <td><img src="${d.imageUrl}" width="50" /></td>
      <td>
        <select class="stockToggle" data-id="${id}">
          <option value="true" ${d.inStock ? "selected" : ""}>In Stock</option>
          <option value="false" ${!d.inStock ? "selected" : ""}>Out of Stock</option>
        </select>
      </td>
      <td>
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
      if (e.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateBulkBar();
      syncSelectAllHeader(items);
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

  // Delete single
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

  // Edit open
  document.querySelectorAll(".editBtn").forEach((el) => {
    el.onclick = async () => {
      const id = el.dataset.id;
      const snap = await getDoc(doc(db, "menuItems", id));
      if (!snap.exists()) return alert("Item not found!");
      openEditModal(id, snap.data());
    };
  });

  // Header select-all sync
  syncSelectAllHeader(items);
}

// ---------- Bulk bar ----------
function ensureBulkBar() {
  if (document.getElementById("bulkBar")) return;
  const bar = document.createElement("div");
  bar.id = "bulkBar";
  bar.style.margin = "8px 0";
  bar.innerHTML = `<button id="bulkDeleteBtn" disabled>Delete Selected (0)</button>`;
  const table = document.getElementById("menuTable");
  table.parentNode.insertBefore(bar, table);
  document.getElementById("bulkDeleteBtn").onclick = async () => {
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
  const btn = document.getElementById("bulkDeleteBtn");
  if (!btn) return;
  const n = selectedIds.size;
  btn.textContent = `Delete Selected (${n})`;
  btn.disabled = n === 0;
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
  const selected = itemsRendered.filter(({ id }) => selectedIds.has(id)).length;
  cb.checked = selected === total;
  cb.indeterminate = selected > 0 && selected < total;
}

// ---------- Search & Filters ----------
function wireSearchAndFilters() {
  const debounced = debounce(() => {
    renderTable();
    updateBulkBar();
  }, 200);
  searchInput?.addEventListener("input", debounced);
  filterCategory?.addEventListener("change", () => {
    renderTable();
    updateBulkBar();
  });
  filterCourse?.addEventListener("change", () => {
    renderTable();
    updateBulkBar();
  });
  filterType?.addEventListener("change", () => {
    renderTable();
    updateBulkBar();
  });
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
      const hay = `${d.name} ${d.description} ${d.category || ""} ${d.foodCourse || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
async function populateFilterDropdowns() {
  if (filterCategory) {
    const cats = await fetchCategories();
    const cur = filterCategory.value;
    filterCategory.innerHTML =
      `<option value="">All Categories</option>` +
      cats.map((c) => `<option value="${c}">${c}</option>`).join("");
    if (cur && cats.includes(cur)) filterCategory.value = cur;
  }
  if (filterCourse) {
    const crs = await fetchCourses();
    const cur = filterCourse.value;
    filterCourse.innerHTML =
      `<option value="">All Courses</option>` +
      crs.map((c) => `<option value="${c}">${c}</option>`).join("");
    if (cur && crs.includes(cur)) filterCourse.value = cur;
  }
}

// ---------- Edit modal ----------
function openEditModal(id, d) {
  editingId = id;
  editName.value = d.name || "";
  editDescription.value = d.description || "";
  Promise.all([loadCategories(editCategory), loadCourses(editCourse)]).then(() => {
    editCategory.value = d.category || "";
    editCourse.value = d.foodCourse || "";
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
function closeEditModal() {
  editingId = null;
  editForm.reset();
  editModal.style.display = "none";
}
closeEditModalBtn.onclick = closeEditModal;

editQtyType.onchange = toggleEditPriceInputs;
function toggleEditPriceInputs() {
  const v = editQtyType.value;
  editItemPrice.style.display = v === "Not Applicable" ? "block" : "none";
  const showHF = v === "Half & Full";
  editHalfPrice.style.display = editFullPrice.style.display = showHF ? "block" : "none";
}

editForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!editingId) return;

  const name = editName.value.trim();
  const description = editDescription.value.trim();
  const category = editCategory.value;
  const foodCourse = editCourse.value;
  const foodType = editType.value;
  const qtyTypeValue = editQtyType.value;

  if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeValue) {
    return alert("Fill all fields");
  }

  let qtyType = {};
  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(editItemPrice.value);
    if (isNaN(price) || price <= 0) return alert("Invalid price");
    qtyType = { type: qtyTypeValue, itemPrice: price };
  } else {
    const half = parseFloat(editHalfPrice.value);
    const full = parseFloat(editFullPrice.value);
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
      name,
      description,
      category,
      foodCourse,
      foodType,
      qtyType,
      updatedAt: serverTimestamp(),
      ...imageUrlUpdate,
    });

    closeEditModal();
  } catch (err) {
    console.error(err);
    alert("Update failed: " + err.message);
  }
};

// ---------- Custom dropdowns (inline edit/delete) ----------
async function renderCustomCategoryDropdown() {
  if (!catBtn || !catPanel) return;

  const categories = await fetchCategories();
  const current = categoryDropdown.value || "";

  catPanel.innerHTML = categories
    .map((name) => {
      const checked = name === current ? "checked" : "";
      return `
        <div class="cat-row" data-name="${name}">
          <span class="cat-check ${checked}" data-role="check" title="Select"></span>
          <span class="cat-label" data-role="label" title="${name}">${name}</span>
          <button class="cat-btn" title="Edit" data-role="edit">✏️</button>
          <button class="cat-btn" title="Delete" data-role="delete">🗑️</button>
        </div>
      `;
    })
    .join("");

  // Keep open (no stacking listeners)
  catPanel.onmousedown = (e) => e.stopPropagation();
  catPanel.onclick = (e) => e.stopPropagation();

  catPanel.onclick = async (e) => {
    const row = e.target.closest(".cat-row");
    if (!row) return;
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
      catPanel.querySelectorAll(".cat-check").forEach((c) => c.classList.remove("checked"));
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
        if (r === "cancel") {
          await renderCustomCategoryDropdown();
          return;
        }
        if (r === "save") {
          const newVal = row.querySelector(".cat-input").value.trim();
          if (!newVal) return alert("Enter a valid category");
          if (newVal === oldName) {
            await renderCustomCategoryDropdown();
            return;
          }
          try {
            row.querySelector(".cat-input").disabled = true;
            await renameCategoryEverywhere(oldName, newVal);
            if (categoryDropdown.value === oldName) {
              setHiddenValue(categoryDropdown, newVal);
              catBtn.textContent = `${newVal} ▾`;
            }
            await loadCategories(categoryDropdown);
            await renderCustomCategoryDropdown();
            await populateFilterDropdowns();
          } catch (err) {
            console.error(err);
            alert("Rename failed: " + (err?.message || err));
            await renderCustomCategoryDropdown();
          }
        }
      };
      return;
    }

    // Delete
    if (role === "delete") {
      if (!confirm(`Delete category "${name}"?\n(Items will NOT be deleted; category field will be cleared.)`))
        return;
      try {
        if (categoryDropdown.value === name) {
          setHiddenValue(categoryDropdown, "");
          catBtn.textContent = `Select Category ▾`;
        }
        await deleteCategoryEverywhere(name);
        await loadCategories(categoryDropdown);
        await renderCustomCategoryDropdown();
        await populateFilterDropdowns();
      } catch (err) {
        console.error(err);
        alert("Delete failed: " + (err?.message || err));
      }
      return;
    }
  };

  catBtn.onclick = (e) => {
    e.stopPropagation();
    catPanel.style.display =
      catPanel.style.display === "none" || !catPanel.style.display ? "block" : "none";
  };
  document.addEventListener("mousedown", outsideCloser_cat);
  function outsideCloser_cat(ev) {
    if (!catPanel.contains(ev.target) && !catBtn.contains(ev.target)) {
      catPanel.style.display = "none";
      document.removeEventListener("mousedown", outsideCloser_cat);
    }
  }
}

async function renderCustomCourseDropdown() {
  if (!courseBtn || !coursePanel) return;

  const courses = await fetchCourses();
  const current = foodCourseDropdown.value || "";

  coursePanel.innerHTML = courses
    .map((name) => {
      const checked = name === current ? "checked" : "";
      return `
        <div class="course-row" data-name="${name}">
          <span class="course-check ${checked}" data-role="check" title="Select"></span>
          <span class="course-label" data-role="label" title="${name}">${name}</span>
          <button class="course-btn" title="Edit" data-role="edit">✏️</button>
          <button class="course-btn" title="Delete" data-role="delete">🗑️</button>
        </div>
      `;
    })
    .join("");

  coursePanel.onmousedown = (e) => e.stopPropagation();
  coursePanel.onclick = (e) => e.stopPropagation();

  coursePanel.onclick = async (e) => {
    const row = e.target.closest(".course-row");
    if (!row) return;
    const role = e.target.getAttribute("data-role");
    const name = row.getAttribute("data-name");

    if (role === "check" || role === "label") {
      const isChecked = row.querySelector(".course-check").classList.contains("checked");
      if (isChecked) {
        row.querySelector(".course-check").classList.remove("checked");
        setHiddenValue(foodCourseDropdown, "");
        courseBtn.textContent = `Select Course ▾`;
        return;
      }
      coursePanel.querySelectorAll(".course-check").forEach((c) => c.classList.remove("checked"));
      row.querySelector(".course-check").classList.add("checked");
      setHiddenValue(foodCourseDropdown, name);
      courseBtn.textContent = `${name} ▾`;
      return;
    }

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
        if (r === "cancel") {
          await renderCustomCourseDropdown();
          return;
        }
        if (r === "save") {
          const newVal = row.querySelector(".course-input").value.trim();
          if (!newVal) return alert("Enter a valid course");
          if (newVal === oldName) {
            await renderCustomCourseDropdown();
            return;
          }
          try {
            row.querySelector(".course-input").disabled = true;
            await renameCourseEverywhere(oldName, newVal);
            if (foodCourseDropdown.value === oldName) {
              setHiddenValue(foodCourseDropdown, newVal);
              courseBtn.textContent = `${newVal} ▾`;
            }
            await loadCourses(foodCourseDropdown);
            await renderCustomCourseDropdown();
            await populateFilterDropdowns();
          } catch (err) {
            console.error(err);
            alert("Rename failed: " + (err?.message || err));
            await renderCustomCourseDropdown();
          }
        }
      };
      return;
    }

    if (role === "delete") {
      if (!confirm(`Delete course "${name}"?\n(Items will NOT be deleted; course field will be cleared.)`))
        return;
      try {
        if (foodCourseDropdown.value === name) {
          setHiddenValue(foodCourseDropdown, "");
          courseBtn.textContent = `Select Course ▾`;
        }
        await deleteCourseEverywhere(name);
        await loadCourses(foodCourseDropdown);
        await renderCustomCourseDropdown();
        await populateFilterDropdowns();
      } catch (err) {
        console.error(err);
        alert("Delete failed: " + (err?.message || err));
      }
      return;
    }
  };

  courseBtn.onclick = (e) => {
    e.stopPropagation();
    coursePanel.style.display =
      coursePanel.style.display === "none" || !coursePanel.style.display ? "block" : "none";
  };
  document.addEventListener("mousedown", outsideCloser_course);
  function outsideCloser_course(ev) {
    if (!coursePanel.contains(ev.target) && !courseBtn.contains(ev.target)) {
      coursePanel.style.display = "none";
      document.removeEventListener("mousedown", outsideCloser_course);
    }
  }
}

// ---------- Helpers ----------
function setHiddenValue(selectEl, val) {
  let opt = [...selectEl.options].find((o) => o.value === val);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    selectEl.appendChild(opt);
  }
  selectEl.value = val;
}
function debounce(fn, delay = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
