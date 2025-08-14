// admin.js (with full foodCourse dropdown support, edit placeholder, and table rendering)

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

const storage = getStorage(undefined, "gs://gufa-restaurant.firebasestorage.app");

// DOM elements (shortened for clarity)
const email = document.getElementById("email");
const password = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginBox = document.getElementById("loginBox");
const adminContent = document.getElementById("adminContent");
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
const foodTypeSelect = document.getElementById("foodType");
const foodCourseDropdown = document.getElementById("foodCourse");
const newCourseInput = document.getElementById("newCourseInput");
const addCourseBtn = document.getElementById("addCourseBtn");
const editModal = document.getElementById("editModal");
const closeEditModalBtn = document.getElementById("closeEditModal");
const editForm = document.getElementById("editForm");

let currentEditId = null;

qtyTypeSelect.addEventListener("change", () => togglePriceInputs(qtyTypeSelect.value));
function togglePriceInputs(type) {
  itemPrice.style.display = "none";
  halfPrice.style.display = "none";
  fullPrice.style.display = "none";
  if (type === "Not Applicable") itemPrice.style.display = "block";
  if (type === "Half & Full") {
    halfPrice.style.display = "block";
    fullPrice.style.display = "block";
  }
}

loginBtn.onclick = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => { email.value = ""; password.value = ""; })
    .catch(err => alert("Login failed: " + err.message));
};
logoutBtn.onclick = () => signOut(auth);

onAuthStateChanged(auth, user => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";
    loadCategories();
    loadCourses();
    renderMenuItems();
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

async function loadCategories() {
  categoryDropdown.innerHTML = '<option value="">-- Select Category --</option>';
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.id;
    categoryDropdown.appendChild(opt);
  });
}

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

addCategoryBtn.onclick = async () => {
  const cat = newCategoryInput.value.trim();
  if (!cat) return alert("Enter category");
  await setDoc(doc(db, "menuCategories", cat), { name: cat });
  newCategoryInput.value = "";
  loadCategories();
};

addCourseBtn.onclick = async () => {
  const course = newCourseInput.value.trim();
  if (!course) return alert("Enter course");
  await setDoc(doc(db, "menuCourses", course), { name: course });
  newCourseInput.value = "";
  loadCourses();
};

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

form.onsubmit = async (e) => {
  e.preventDefault();
  statusMsg.innerText = "Adding...";

  const name = itemName.value.trim();
  const description = itemDescription.value.trim();
  const category = categoryDropdown.value;
  const foodCourse = foodCourseDropdown.value;
  const qtyTypeValue = qtyTypeSelect.value;
  const foodType = foodTypeSelect.value;
  const imageFile = itemImage.files[0];

  if (!name || !description || !category || !foodCourse || !qtyTypeValue || !foodType || !imageFile) {
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
    const blob = await resizeImage(imageFile);
    const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);
    await uploadBytes(imageRef, blob);
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
    togglePriceInputs("");
    statusMsg.innerText = "✅ Added!";
  } catch (err) {
    console.error(err);
    statusMsg.innerText = "❌ Error: " + err.message;
  }
};

function renderMenuItems() {
  onSnapshot(collection(db, "menuItems"), (snapshot) => {
    menuBody.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      const id = docSnap.id;
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
        <td><img src="${d.imageUrl}" width="50"/></td>
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

    document.querySelectorAll(".stockToggle").forEach(drop => {
      drop.onchange = async (e) => {
        const id = e.target.dataset.id;
        const val = e.target.value === "true";
        await updateDoc(doc(db, "menuItems", id), { inStock: val });
      };
    });

    document.querySelectorAll(".deleteBtn").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        if (confirm("Delete this item?")) {
          await deleteDoc(doc(db, "menuItems", id));
        }
      };
    });

    document.querySelectorAll(".editBtn").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        currentEditId = id;
        const docRef = await getDoc(doc(db, "menuItems", id));
        const d = docRef.data();
        alert("Edit feature will be available shortly");
      };
    });
  });
}

if (closeEditModalBtn) {
  closeEditModalBtn.onclick = () => {
    editModal.style.display = "none";
    currentEditId = null;
  };
}
