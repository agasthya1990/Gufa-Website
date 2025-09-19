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

// Import category management helpers
import { loadCategories, renderCategoryList, addCategory } from "./categoryCourse.js";

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

// Optional container for category list (if present in HTML)
const categoryListContainer = document.getElementById("categoryList");

// Auth login/logout
loginBtn.onclick = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => {
      email.value = "";
      password.value = "";
    })
    .catch(err => alert("Login failed: " + err.message));
};
logoutBtn.onclick = () => signOut(auth);

// Auth state listener
onAuthStateChanged(auth, user => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";

    // Categories via helper
    loadCategories(categoryDropdown);
    if (categoryListContainer) {
      renderCategoryList(categoryListContainer);
    }

    loadCourses();
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

// Add Category (using helper)
addCategoryBtn.onclick = () => {
  addCategory(newCategoryInput, () => loadCategories(categoryDropdown));
  if (categoryListContainer) {
    renderCategoryList(categoryListContainer);
  }
};

// Food Course add/load
addCourseBtn.onclick = async () => {
  const newCourse = newCourseInput.value.trim();
  if (!newCourse) return alert("Enter a course");
  await setDoc(doc(db, "menuCourses", newCourse), { name: newCourse });
  newCourseInput.value = "";
  loadCourses();
};
async function loadCourses() {
  foodCourseDropdown.innerHTML = '<option value="">-- Select Food Course --</option>';
  const snapshot = await getDocs(collection(db, "menuCourses"));
  snapshot.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.id;
    foodCourseDropdown.appendChild(opt);
  });
}

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
    return statusMsg.innerText = "❌ Fill all fields";
  }

  let qtyType = {};
  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(itemPrice.value);
    if (isNaN(price)) return statusMsg.innerText = "❌ Invalid price";
    qtyType = { type: qtyTypeValue, itemPrice: price };
  } else if (qtyTypeValue === "Half & Full") {
    const half = parseFloat(halfPrice.value);
    const full = parseFloat(fullPrice.value);
    if (isNaN(half) || isNaN(full)) return statusMsg.innerText = "❌ Invalid Half/Full price";
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
      createdAt: serverTimestamp()
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
          alert("Edit coming soon!");
        }
      };
    });
  });
}
// === Add to admin.js ===
import { fetchCategories, renameCategoryEverywhere } from "./categoryCourse.js";

const catBtn = document.getElementById("categoryDropdownBtn");
const catPanel = document.getElementById("categoryDropdownPanel");

// Renders custom category dropdown and keeps #itemCategory (hidden) in sync
async function renderCustomCategoryDropdown() {
  const categories = await fetchCategories();
  const current = categoryDropdown.value || ""; // hidden <select> value

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

  // Event delegation
  catPanel.onclick = async (e) => {
    const row = e.target.closest(".cat-row");
    if (!row) return;
    const role = e.target.getAttribute("data-role");
    const name = row.getAttribute("data-name");

    // Select (single-select behavior)
    if (role === "check" || role === "label") {
      // Uncheck all
      catPanel.querySelectorAll(".cat-check").forEach(c => c.classList.remove("checked"));
      // Check this one
      row.querySelector(".cat-check").classList.add("checked");
      // Sync hidden select
      setHiddenCategoryValue(name);
      // Update button label
      catBtn.textContent = `${name} ▾`;
      // Close panel
      catPanel.style.display = "none";
      return;
    }

    // Edit inline
    if (role === "edit") {
      // Replace label with input + ✔/✖
      const labelEl = row.querySelector('[data-role="label"]');
      const oldName = name;
      const oldHTML = row.innerHTML;

      row.innerHTML = `
        <div class="inline-controls" style="width:100%;">
          <input class="cat-input" type="text" value="${oldName}" />
          <button class="cat-btn" data-role="save" title="Save">✔</button>
          <button class="cat-btn" data-role="cancel" title="Cancel">✖</button>
        </div>
      `;

      row.onclick = async (ev) => {
        const r = ev.target.getAttribute("data-role");
        if (r === "cancel") {
          // Restore original row (no change)
          await renderCustomCategoryDropdown();
          // Keep panel open so user can see the result
          catPanel.style.display = "block";
          return;
        }
        if (r === "save") {
          const inputVal = row.querySelector(".cat-input").value.trim();
          if (!inputVal) return alert("Enter a valid category name");

          if (inputVal === oldName) {
            // No change
            await renderCustomCategoryDropdown();
            catPanel.style.display = "block";
            return;
          }

          // Rename across system (categories + items)
          try {
            // Optimistic UI: show a small busy state
            row.querySelector(".cat-input").disabled = true;

            await renameCategoryEverywhere(oldName, inputVal);

            // If the renamed category was currently selected, update hidden select & button
            if (categoryDropdown.value === oldName) {
              setHiddenCategoryValue(inputVal);
              catBtn.textContent = `${inputVal} ▾`;
            }

            // Re-render dropdown list (will not show oldName anymore)
            await renderCustomCategoryDropdown();
            catPanel.style.display = "block";
          } catch (err) {
            console.error(err);
            alert("Rename failed: " + (err?.message || err));
            // Re-render original state
            await renderCustomCategoryDropdown();
            catPanel.style.display = "block";
          }
        }
      };
    }
  };
}

function setHiddenCategoryValue(val) {
  // Ensure the hidden select has this option; if not, add it
  let opt = [...categoryDropdown.options].find(o => o.value === val);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    categoryDropdown.appendChild(opt);
  }
  categoryDropdown.value = val;
}

// Toggle panel visibility
if (catBtn && catPanel) {
  catBtn.onclick = () => {
    catPanel.style.display = (catPanel.style.display === "none" || !catPanel.style.display) ? "block" : "none";
  };
  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!catPanel.contains(e.target) && !catBtn.contains(e.target)) {
      catPanel.style.display = "none";
    }
  });
}
