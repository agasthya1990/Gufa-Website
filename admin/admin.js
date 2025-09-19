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
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import {
  loadCategories, loadCourses,
  fetchCategories, fetchCourses,
  addCategory, addCourse,
  renameCategoryEverywhere, renameCourseEverywhere
} from "./categoryCourse.js";

// Storage ref
const storage = getStorage(undefined, "gs://gufa-restaurant.firebasestorage.app");

// DOM elements
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

// Auth login/logout
loginBtn.onclick = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => { email.value = ""; password.value = ""; })
    .catch(err => alert("Login failed: " + err.message));
};
logoutBtn.onclick = () => signOut(auth);

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";

    // Load hidden selects once (kept for form compatibility)
    await loadCategories(categoryDropdown);
    await loadCourses(foodCourseDropdown);

    // Render custom dropdowns
    await renderCustomCategoryDropdown();
    await renderCustomCourseDropdown();

    renderMenuItems();
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

// Toggle pricing input logic
qtyTypeSelect.onchange = () => {
  const value = qtyTypeSelect.value;
  itemPrice.style.display = value === "Not Applicable" ? "block" : "none";
  halfPrice.style.display = fullPrice.style.display = value === "Half & Full" ? "block" : "none";
};

// Add Category / Course
addCategoryBtn.onclick = async () => {
  await addCategory(newCategoryInput, () => loadCategories(categoryDropdown));
  await renderCustomCategoryDropdown();
};
addCourseBtn.onclick = async () => {
  await addCourse(newCourseInput, () => loadCourses(foodCourseDropdown));
  await renderCustomCourseDropdown();
};

// Resize uploaded image to 200x200
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
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

// Submit form to Firestore
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

  if (!name || !description || !category || !foodCourse || !foodType || !qtyTypeValue || !imageFile) {
    statusMsg.innerText = "❌ Fill all fields"; return;
  }

  let qtyType = {};
  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(itemPrice.value);
    if (isNaN(price) || price <= 0) { statusMsg.innerText = "❌ Invalid price"; return; }
    qtyType = { type: qtyTypeValue, itemPrice: price };
  } else if (qtyTypeValue === "Half & Full") {
    const half = parseFloat(halfPrice.value);
    const full = parseFloat(fullPrice.value);
    if (isNaN(half) || isNaN(full) || half <= 0 || full <= 0) { statusMsg.innerText = "❌ Invalid Half/Full price"; return; }
    qtyType = { type: qtyTypeValue, halfPrice: half, fullPrice: full };
  }

  try {
    const resizedBlob = await resizeImage(imageFile);
    const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);
    await uploadBytes(imageRef, resizedBlob);
    const imageUrl = await getDownloadURL(imageRef);

    await addDoc(collection(db, "menuItems"), {
      name, description, category, foodCourse, foodType,
      qtyType, imageUrl, inStock: true, createdAt: serverTimestamp()
    });

    form.reset();
    qtyTypeSelect.dispatchEvent(new Event("change"));
    statusMsg.innerText = "✅ Added!";
  } catch (err) {
    console.error(err);
    statusMsg.innerText = "❌ Error: " + err.message;
  }
};

// Render items in table
function renderMenuItems() {
  onSnapshot(collection(db, "menuItems"), (snapshot) => {
    menuBody.innerHTML = "";
    snapshot.forEach(docSnap => {
      const d = docSnap.data();
      const qty = d.qtyType || {};
      const priceText = qty.type === "Half & Full"
        ? `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}`
        : `₹${qty.itemPrice}`;
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${d.name}</td>
        <td>${d.description}</td>
        <td>${d.category}</td>
        <td>${d.foodCourse}</td>
        <td>${d.foodType}</td>
        <td>${qty.type}</td>
        <td>${priceText}</td>
        <td><img src="${d.imageUrl}" width="50" /></td>
        <td>
          <select class="stockToggle" data-id="${docSnap.id}">
            <option value="true" ${d.inStock ? "selected" : ""}>In Stock</option>
            <option value="false" ${!d.inStock ? "selected" : ""}>Out of Stock</option>
          </select>
        </td>
        <td>
          <button class="editBtn" data-id="${docSnap.id}">Edit</button>
          <button class="deleteBtn" data-id="${docSnap.id}">Delete</button>
        </td>
      `;
      menuBody.appendChild(row);
    });

    document.querySelectorAll(".stockToggle").forEach(el => {
      el.onchange = async (e) => {
        const id = e.target.dataset.id;
        const val = e.target.value === "true";
        await updateDoc(doc(db, "menuItems", id), { inStock: val });
      };
    });

    document.querySelectorAll(".deleteBtn").forEach(el => {
      el.onclick = async () => {
        const id = el.dataset.id;
        if (confirm("Are you sure?")) {
          await deleteDoc(doc(db, "menuItems", id));
        }
      };
    });

    document.querySelectorAll(".editBtn").forEach(el => {
      el.onclick = async () => {
        const id = el.dataset.id;
        const snap = await getDoc(doc(db, "menuItems", id));
        if (snap.exists()) {
          alert("Edit coming soon!"); // hook up later
        }
      };
    });
  });
}

/* ============================
   Custom Dropdowns (inline edit)
   ============================ */
// Category
async function renderCustomCategoryDropdown() {
  const categories = await fetchCategories();
  const current = categoryDropdown.value || "";
  const rows = categories.map(name => {
    const checked = name === current ? "checked" : "";
    return `
      <div class="cat-row" data-name="${name}">
        <span class="cat-check ${checked}" data-role="check"></span>
        <span class="cat-label" data-role="label" title="${name}">${name}</span>
        <button class="cat-btn" title="Edit" data-role="edit">✏️</button>
      </div>
    `;
  }).join("");
  catPanel.innerHTML = rows;

  catPanel.onclick = async (e) => {
    const row = e.target.closest(".cat-row");
    if (!row) return;
    const role = e.target.getAttribute("data-role");
    const name = row.getAttribute("data-name");

    // select
    if (role === "check" || role === "label") {
      catPanel.querySelectorAll(".cat-check").forEach(c => c.classList.remove("checked"));
      row.querySelector(".cat-check").classList.add("checked");
      setHiddenValue(categoryDropdown, name);
      catBtn.textContent = `${name} ▾`;
      catPanel.style.display = "none";
      return;
    }

    // edit inline
    if (role === "edit") {
      row.innerHTML = `
        <div class="inline-controls">
          <input class="cat-input" type="text" value="${name}" />
          <button class="cat-btn" data-role="save">✔</button>
          <button class="cat-btn" data-role="cancel">✖</button>
        </div>
      `;
      row.onclick = async (ev) => {
        const r = ev.target.getAttribute("data-role");
        if (r === "cancel") { await renderCustomCategoryDropdown(); catPanel.style.display = "block"; return; }
        if (r === "save") {
          const newVal = row.querySelector(".cat-input").value.trim();
          if (!newVal) return alert("Enter a valid category");
          if (newVal === name) { await renderCustomCategoryDropdown(); catPanel.style.display = "block"; return; }
          try {
            row.querySelector(".cat-input").disabled = true;
            await renameCategoryEverywhere(name, newVal);
            if (categoryDropdown.value === name) {
              setHiddenValue(categoryDropdown, newVal);
              catBtn.textContent = `${newVal} ▾`;
            }
            await loadCategories(categoryDropdown);
            await renderCustomCategoryDropdown();
            catPanel.style.display = "block";
          } catch (err) {
            console.error(err); alert("Rename failed: " + (err?.message || err));
            await renderCustomCategoryDropdown(); catPanel.style.display = "block";
          }
        }
      };
    }
  };
}

// Course
async function renderCustomCourseDropdown() {
  const courses = await fetchCourses();
  const current = foodCourseDropdown.value || "";
  const rows = courses.map(name => {
    const checked = name === current ? "checked" : "";
    return `
      <div class="course-row" data-name="${name}">
        <span class="course-check ${checked}" data-role="check"></span>
        <span class="course-label" data-role="label" title="${name}">${name}</span>
        <button class="course-btn" title="Edit" data-role="edit">✏️</button>
      </div>
    `;
  }).join("");
  coursePanel.innerHTML = rows;

  coursePanel.onclick = async (e) => {
    const row = e.target.closest(".course-row");
    if (!row) return;
    const role = e.target.getAttribute("data-role");
    const name = row.getAttribute("data-name");

    // select
    if (role === "check" || role === "label") {
      coursePanel.querySelectorAll(".course-check").forEach(c => c.classList.remove("checked"));
      row.querySelector(".course-check").classList.add("checked");
      setHiddenValue(foodCourseDropdown, name);
      courseBtn.textContent = `${name} ▾`;
      coursePanel.style.display = "none";
      return;
    }

    // edit inline
    if (role === "edit") {
      row.innerHTML = `
        <div class="inline-controls">
          <input class="course-input" type="text" value="${name}" />
          <button class="course-btn" data-role="save">✔</button>
          <button class="course-btn" data-role="cancel">✖</button>
        </div>
      `;
      row.onclick = async (ev) => {
        const r = ev.target.getAttribute("data-role");
        if (r === "cancel") { await renderCustomCourseDropdown(); coursePanel.style.display = "block"; return; }
        if (r === "save") {
          const newVal = row.querySelector(".course-input").value.trim();
          if (!newVal) return alert("Enter a valid course");
          if (newVal === name) { await renderCustomCourseDropdown(); coursePanel.style.display = "block"; return; }
          try {
            row.querySelector(".course-input").disabled = true;
            await renameCourseEverywhere(name, newVal);
            if (foodCourseDropdown.value === name) {
              setHiddenValue(foodCourseDropdown, newVal);
              courseBtn.textContent = `${newVal} ▾`;
            }
            await loadCourses(foodCourseDropdown);
            await renderCustomCourseDropdown();
            coursePanel.style.display = "block";
          } catch (err) {
            console.error(err); alert("Rename failed: " + (err?.message || err));
            await renderCustomCourseDropdown(); coursePanel.style.display = "block";
          }
        }
      };
    }
  };
}

// Helpers
function setHiddenValue(selectEl, val) {
  let opt = [...selectEl.options].find(o => o.value === val);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = val; opt.textContent = val;
    selectEl.appendChild(opt);
  }
  selectEl.value = val;
}

// Toggle panel visibility + outside click
if (catBtn && catPanel) {
  catBtn.onclick = () => { catPanel.style.display = (catPanel.style.display === "none" || !catPanel.style.display) ? "block" : "none"; };
  document.addEventListener("click", (e) => { if (!catPanel.contains(e.target) && !catBtn.contains(e.target)) catPanel.style.display = "none"; });
}
if (courseBtn && coursePanel) {
  courseBtn.onclick = () => { coursePanel.style.display = (coursePanel.style.display === "none" || !coursePanel.style.display) ? "block" : "none"; };
  document.addEventListener("click", (e) => { if (!coursePanel.contains(e.target) && !courseBtn.contains(e.target)) coursePanel.style.display = "none"; });
}
