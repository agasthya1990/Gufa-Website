// ✅ Fully enhanced admin.js with:
// 1. Firebase storage fix
// 2. Dynamic category management
// 3. Food type support
// 4. Image resizing before upload

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
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const storage = getStorage(undefined, "gs://gufa-restaurant.firebasestorage.app");

// DOM Elements
const email = document.getElementById("email");
const password = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginBox = document.getElementById("loginBox");
const adminContent = document.getElementById("adminContent");
const form = document.getElementById("menuForm");
const statusMsg = document.getElementById("statusMsg");
const menuBody = document.getElementById("menuBody");

const itemPrice = document.getElementById("itemPrice");
const halfPrice = document.getElementById("halfPrice");
const fullPrice = document.getElementById("fullPrice");
const qtyTypeSelect = document.getElementById("qtyType");
const categoryDropdown = document.getElementById("itemCategory");
const newCategoryInput = document.getElementById("newCategoryInput");
const addCategoryBtn = document.getElementById("addCategoryBtn");
const foodTypeSelect = document.getElementById("foodType");

// Show/hide price fields
qtyTypeSelect.addEventListener("change", () => {
  const type = qtyTypeSelect.value;
  itemPrice.style.display = "none";
  halfPrice.style.display = "none";
  fullPrice.style.display = "none";

  if (type === "Not Applicable") itemPrice.style.display = "block";
  else if (type === "Half & Full") {
    halfPrice.style.display = "block";
    fullPrice.style.display = "block";
  }
});

// Login
loginBtn.onclick = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => {
      email.value = "";
      password.value = "";
    })
    .catch(err => alert("Login failed: " + err.message));
};

// Logout
logoutBtn.onclick = () => signOut(auth);

// Auth listener
onAuthStateChanged(auth, user => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";
    loadCategories();
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

// Add new category
addCategoryBtn.onclick = async () => {
  const newCat = newCategoryInput.value.trim();
  if (!newCat) return alert("Enter a category name");

  const categoryRef = doc(db, "menuCategories", newCat);
  await setDoc(categoryRef, { name: newCat });
  newCategoryInput.value = "";
  await loadCategories();
};

// Load category dropdown
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

// Resize image to 200x200 via canvas
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

// Add menu item
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusMsg.innerText = "⏳ Adding item...";

  const name = document.getElementById("itemName").value.trim();
  const description = document.getElementById("itemDescription").value.trim();
  const category = categoryDropdown.value;
  const qtyTypeValue = qtyTypeSelect.value;
  const foodType = foodTypeSelect.value;
  const imageFile = document.getElementById("itemImage").files[0];

  if (!name || !description || !category || !qtyTypeValue || !foodType || !imageFile) {
    statusMsg.innerText = "❌ Please fill all fields.";
    return;
  }

  let qtyType = {};
  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(itemPrice.value);
    if (isNaN(price)) return statusMsg.innerText = "❌ Invalid price.";
    qtyType = { type: qtyTypeValue, itemPrice: price };
  } else if (qtyTypeValue === "Half & Full") {
    const half = parseFloat(halfPrice.value);
    const full = parseFloat(fullPrice.value);
    if (isNaN(half) || isNaN(full)) return statusMsg.innerText = "❌ Invalid half/full price.";
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
      foodType,
      qtyType,
      imageUrl,
      inStock: true,
      createdAt: serverTimestamp()
    });

    statusMsg.innerText = "✅ Item added!";
    form.reset();
    itemPrice.style.display = "none";
    halfPrice.style.display = "none";
    fullPrice.style.display = "none";
    await loadCategories();
  } catch (err) {
    console.error("🔥 Error adding item:", err);
    statusMsg.innerText = "❌ Error: " + err.message;
  }
});

// Render Table
onSnapshot(collection(db, "menuItems"), (snapshot) => {
  menuBody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const docId = docSnap.id;
    const qty = item.qtyType || {};

    let priceText = "—";
    if (qty.type === "Not Applicable" && qty.itemPrice !== undefined) {
      priceText = `₹${qty.itemPrice}`;
    } else if (qty.type === "Half & Full" && qty.halfPrice && qty.fullPrice) {
      priceText = `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}`;
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td>${item.foodType || "—"}</td>
      <td>${qty.type || "—"}</td>
      <td>${priceText}</td>
      <td><img src="${item.imageUrl}" width="50" /></td>
      <td>
        <select class="stockToggle" data-id="${docId}">
          <option value="true" ${item.inStock ? "selected" : ""}>In Stock</option>
          <option value="false" ${!item.inStock ? "selected" : ""}>Out of Stock</option>
        </select>
      </td>
      <td><button class="deleteBtn" data-id="${docId}">Delete</button></td>
    `;
    menuBody.appendChild(row);
  });

  // In-stock toggle
  document.querySelectorAll(".stockToggle").forEach(dropdown => {
    dropdown.addEventListener("change", async (e) => {
      const docId = e.target.dataset.id;
      const newVal = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", docId), { inStock: newVal });
    });
  });

  // Delete item
  document.querySelectorAll(".deleteBtn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.id;
      if (confirm("Are you sure you want to delete this item?")) {
        await deleteDoc(doc(db, "menuItems", docId));
      }
    });
  });
});
