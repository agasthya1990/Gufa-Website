// ✅ Fully revised admin.js with explicit Firebase bucket fix
// Logic untouched — only corrected the getStorage() reference

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
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ✅ FIX: Use your actual bucket explicitly
const storage = getStorage(undefined, "gs://gufa-restaurant.firebasestorage.app");

// DOM elements
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

// Show/Hide pricing fields based on qtyType
qtyTypeSelect.addEventListener("change", () => {
  const type = qtyTypeSelect.value;
  itemPrice.style.display = "none";
  halfPrice.style.display = "none";
  fullPrice.style.display = "none";

  if (type === "Not Applicable") {
    itemPrice.style.display = "block";
  } else if (type === "Half & Full") {
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
    .catch(err => {
      alert("Login failed: " + err.message);
    });
};

// Logout
logoutBtn.onclick = () => {
  signOut(auth);
};

// Auth tracking
onAuthStateChanged(auth, user => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

// Add Menu Item
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusMsg.innerText = "⏳ Adding item...";

  const name = document.getElementById("itemName").value.trim();
  const description = document.getElementById("itemDescription").value.trim();
  const category = document.getElementById("itemCategory").value;
  const qtyTypeValue = qtyTypeSelect.value;
  const imageFile = document.getElementById("itemImage").files[0];

  if (!name || !description || !category || !qtyTypeValue) {
    statusMsg.innerText = "❌ Please fill all fields.";
    return;
  }

  if (!imageFile) {
    statusMsg.innerText = "❌ Please upload an image.";
    return;
  }

  let qtyType = {};

  if (qtyTypeValue === "Not Applicable") {
    const price = parseFloat(itemPrice.value);
    if (isNaN(price)) {
      statusMsg.innerText = "❌ Invalid price.";
      return;
    }
    qtyType = { type: "Not Applicable", itemPrice: price };
  } else if (qtyTypeValue === "Half & Full") {
    const half = parseFloat(halfPrice.value);
    const full = parseFloat(fullPrice.value);
    if (isNaN(half) || isNaN(full)) {
      statusMsg.innerText = "❌ Invalid half/full price.";
      return;
    }
    qtyType = { type: "Half & Full", halfPrice: half, fullPrice: full };
  } else {
    statusMsg.innerText = "❌ Invalid quantity type.";
    return;
  }

  const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);

  try {
    await uploadBytes(imageRef, imageFile);
    const imageUrl = await getDownloadURL(imageRef);

    await addDoc(collection(db, "menuItems"), {
      name,
      description,
      category,
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
  } catch (err) {
    console.error("🔥 Error adding item:", err);
    statusMsg.innerText = "❌ Error: " + err.message;
  }
});

// Load & Render Table
onSnapshot(collection(db, "menuItems"), (snapshot) => {
  menuBody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const docId = docSnap.id;
    const qty = item.qtyType || {};

    let priceText = "—";
    if (qty.type === "Not Applicable" && qty.itemPrice !== undefined) {
      priceText = `₹${qty.itemPrice}`;
    } else if (qty.type === "Half & Full" && qty.halfPrice !== undefined && qty.fullPrice !== undefined) {
      priceText = `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}`;
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td>${qty.type || "—"}</td>
      <td>${priceText}</td>
      <td><img src="${item.imageUrl}" width="50"/></td>
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

  // Stock Toggle
  document.querySelectorAll(".stockToggle").forEach((dropdown) => {
    dropdown.addEventListener("change", async (e) => {
      const docId = e.target.dataset.id;
      const newVal = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", docId), { inStock: newVal });
    });
  });

  // Delete Item
  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.id;
      if (confirm("Are you sure you want to delete this item?")) {
        await deleteDoc(doc(db, "menuItems", docId));
      }
    });
  });
});
