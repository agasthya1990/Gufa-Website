// admin.js
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
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Elements
const email = document.getElementById("email");
const password = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginBox = document.getElementById("loginBox");
const adminContent = document.getElementById("adminContent");
const form = document.getElementById("menuForm");
const statusMsg = document.getElementById("statusMsg");
const menuBody = document.getElementById("menuBody");

// Login
loginBtn.onclick = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => {})
    .catch((err) => alert("Login failed: " + err.message));
};

// Logout
logoutBtn.onclick = () => signOut(auth);

// Auth state change
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

// Form submission
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusMsg.innerText = "Adding item...";

  const name = document.getElementById("itemName").value.trim();
  const description = document.getElementById("itemDescription").value.trim();
  const category = document.getElementById("itemCategory").value;
  const qtyType = document.getElementById("qtyType").value;
  const imageFile = document.getElementById("itemImage").files[0];

  if (!name || !description || !category || !qtyType || !imageFile) {
    statusMsg.innerText = "❌ All fields are required!";
    return;
  }

  let qty = {};
  if (qtyType === "half_full") {
    const half = parseFloat(document.getElementById("halfPrice").value);
    const full = parseFloat(document.getElementById("fullPrice").value);
    if (isNaN(half) || isNaN(full)) {
      statusMsg.innerText = "❌ Please provide both half and full prices.";
      return;
    }
    qty = { type: "half_full", half, full };
  } else if (qtyType === "na") {
    const price = parseFloat(document.getElementById("itemPrice").value);
    if (isNaN(price)) {
      statusMsg.innerText = "❌ Please provide a valid price.";
      return;
    }
    qty = { type: "na", price };
  } else {
    statusMsg.innerText = "❌ Invalid Qty Type.";
    return;
  }

  try {
    const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);
    await uploadBytes(imageRef, imageFile);
    const imageUrl = await getDownloadURL(imageRef);

    await addDoc(collection(db, "menuItems"), {
      name,
      description,
      category,
      qtyType: qty,
      imageUrl,
      createdAt: serverTimestamp(),
      inStock: true
    });

    statusMsg.innerText = "✅ Menu item added!";
    form.reset();
    document.getElementById("itemPrice").style.display = "none";
    document.getElementById("halfPrice").style.display = "none";
    document.getElementById("fullPrice").style.display = "none";
  } catch (err) {
    console.error("🔥 Add Menu Error:", err);
    statusMsg.innerText = "❌ Failed to add item: " + err.message;
  }
});

// Load menu items
onSnapshot(collection(db, "menuItems"), (snapshot) => {
  menuBody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const row = document.createElement("tr");

    let priceHTML = "";
    if (item.qtyType.type === "half_full") {
      priceHTML = `Half: ₹${item.qtyType.half}<br/>Full: ₹${item.qtyType.full}`;
    } else if (item.qtyType.type === "na") {
      priceHTML = `₹${item.qtyType.price}`;
    }

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td>${item.qtyType.type}</td>
      <td>${priceHTML}</td>
      <td><img src="${item.imageUrl}" width="50" /></td>
      <td>
        <select data-id="${docSnap.id}" class="stockToggle">
          <option value="true" ${item.inStock ? "selected" : ""}>In Stock</option>
          <option value="false" ${!item.inStock ? "selected" : ""}>Out of Stock</option>
        </select>
      </td>
      <td><button class="deleteBtn" data-id="${docSnap.id}">Delete</button></td>
    `;

    menuBody.appendChild(row);
  });

  // Stock toggle
  document.querySelectorAll(".stockToggle").forEach((dropdown) => {
    dropdown.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const newVal = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", id), { inStock: newVal });
    });
  });

  // Delete item
  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (confirm("Delete this item?")) {
        await deleteDoc(doc(db, "menuItems", id));
      }
    });
  });
});
