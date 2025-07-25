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

const itemPrice = document.getElementById("itemPrice");
const halfPrice = document.getElementById("halfPrice");
const fullPrice = document.getElementById("fullPrice");
const qtyType = document.getElementById("qtyType");

// Quantity logic display
qtyType.addEventListener("change", () => {
  itemPrice.style.display = "none";
  halfPrice.style.display = "none";
  fullPrice.style.display = "none";

  const type = qtyType.value;
  if (type === "na") {
    itemPrice.style.display = "block";
  } else if (type === "half_full") {
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

// Auth state
onAuthStateChanged(auth, user => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

// Add menu item
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("itemName").value.trim();
  const description = document.getElementById("itemDescription").value.trim();
  const category = document.getElementById("itemCategory").value;
  const imageFile = document.getElementById("itemImage").files[0];
  const qty = qtyType.value;

  if (!name || !description || !category) {
    statusMsg.innerText = "❌ Please fill all fields.";
    return;
  }

  if (!imageFile) {
    statusMsg.innerText = "❌ Please upload an image.";
    return;
  }

  let qtyData = {};
  if (qty === "na") {
    const price = parseFloat(itemPrice.value);
    if (isNaN(price)) {
      statusMsg.innerText = "❌ Invalid price.";
      return;
    }
    qtyData = {
      type: "na",
      itemPrice: price
    };
  } else if (qty === "half_full") {
    const half = parseFloat(halfPrice.value);
    const full = parseFloat(fullPrice.value);
    if (isNaN(half) || isNaN(full)) {
      statusMsg.innerText = "❌ Invalid half/full price.";
      return;
    }
    qtyData = {
      type: "half_full",
      halfPrice: half,
      fullPrice: full
    };
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
      qtyType: qtyData, // <-- store in qtyType to match DB
      imageUrl,
      inStock: true,
      createdAt: serverTimestamp()
    });

    statusMsg.innerText = "✅ Menu item added!";
    form.reset();
    itemPrice.style.display = "none";
    halfPrice.style.display = "none";
    fullPrice.style.display = "none";
  } catch (err) {
    console.error(err);
    statusMsg.innerText = "❌ Error: " + err.message;
  }
});

// Display menu items
onSnapshot(collection(db, "menuItems"), (snapshot) => {
  menuBody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const docId = docSnap.id;

    const qty = item.qtyType || {};
    let priceText = "";

    if (qty.type === "na") {
      priceText = `₹${qty.itemPrice}`;
    } else if (qty.type === "half_full") {
      priceText = `Half: ₹${qty.halfPrice} / Full: ₹${qty.fullPrice}`;
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td>${qty.type || ''}</td>
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

  // Stock toggle
  document.querySelectorAll(".stockToggle").forEach((dropdown) => {
    dropdown.addEventListener("change", async (e) => {
      const docId = e.target.dataset.id;
      const newVal = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", docId), { inStock: newVal });
    });
  });

  // Delete buttons
  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.id;
      if (confirm("Are you sure you want to delete this item?")) {
        await deleteDoc(doc(db, "menuItems", docId));
      }
    });
  });
});
