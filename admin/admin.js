// admin.js
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

qtyType.addEventListener("change", () => {
  itemPrice.style.display = "none";
  halfPrice.style.display = "none";
  fullPrice.style.display = "none";

  if (qtyType.value === "na") {
    itemPrice.style.display = "block";
  } else if (qtyType.value === "half_full") {
    halfPrice.style.display = "block";
    fullPrice.style.display = "block";
  }
});

loginBtn.onclick = () => {
  signInWithEmailAndPassword(auth, email.value, password.value)
    .then(() => {})
    .catch((err) => alert("Login failed: " + err.message));
};

logoutBtn.onclick = () => {
  signOut(auth);
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginBox.style.display = "none";
    adminContent.style.display = "block";
  } else {
    loginBox.style.display = "block";
    adminContent.style.display = "none";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("itemName").value;
  const description = document.getElementById("itemDescription").value;
  const category = document.getElementById("itemCategory").value;
  const imageFile = document.getElementById("itemImage").files[0];
  const qty = qtyType.value;

  let qtyData = {};

  if (qty === "na") {
    qtyData = {
      type: "na",
      price: parseFloat(itemPrice.value),
    };
  } else if (qty === "half_full") {
    qtyData = {
      type: "half_full",
      half: parseFloat(halfPrice.value),
      full: parseFloat(fullPrice.value),
    };
  } else {
    statusMsg.innerText = "❌ Invalid quantity type.";
    return;
  }

  if (!imageFile) {
    statusMsg.innerText = "❌ Please upload an image.";
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
      qty: qtyData,
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
    statusMsg.innerText = "❌ Error: " + err.message;
  }
});

onSnapshot(collection(db, "menuItems"), (snapshot) => {
  menuBody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const row = document.createElement("tr");

    let priceDisplay = "";
    if (item.qty.type === "half_full") {
      priceDisplay = `Half: ₹${item.qty.half} / Full: ₹${item.qty.full}`;
    } else if (item.qty.type === "na") {
      priceDisplay = `₹${item.qty.price}`;
    }

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td>${item.qty.type}</td>
      <td>${priceDisplay}</td>
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

  document.querySelectorAll(".stockToggle").forEach((dropdown) => {
    dropdown.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const newVal = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", id), { inStock: newVal });
    });
  });

  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (confirm("Delete this item?")) {
        await deleteDoc(doc(db, "menuItems", id));
      }
    });
  });
});
