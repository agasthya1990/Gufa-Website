// admin.js
import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const email = document.getElementById("email");
const password = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginBox = document.getElementById("loginBox");
const adminContent = document.getElementById("adminContent");

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
import { db, storage } from "./firebase.js";
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const form = document.getElementById("menuForm");
const statusMsg = document.getElementById("statusMsg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("itemName").value;
  const description = document.getElementById("itemDescription").value;
  const price = parseFloat(document.getElementById("itemPrice").value);
  const category = document.getElementById("itemCategory").value;
  const imageFile = document.getElementById("itemImage").files[0];

  if (!imageFile) {
    statusMsg.innerText = "Please upload an image.";
    return;
  }

  const imageRef = ref(storage, `menuImages/${Date.now()}_${imageFile.name}`);

  try {
    await uploadBytes(imageRef, imageFile);
    const imageUrl = await getDownloadURL(imageRef);

    await addDoc(collection(db, "menuItems"), {
      name,
      description,
      price,
      category,
      imageUrl,
      createdAt: serverTimestamp(),
      inStock: true
    });

    statusMsg.innerText = "✅ Menu item added!";
    form.reset();
  } catch (err) {
    statusMsg.innerText = "❌ Error: " + err.message;
  }
});
import {
  onSnapshot,
  collection,
  doc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const menuBody = document.getElementById("menuBody");

onSnapshot(collection(db, "menuItems"), (snapshot) => {
  menuBody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.name}</td>
      <td>${item.category}</td>
      <td>₹${item.price}</td>
      <td>
        <select data-id="${docSnap.id}" class="stockToggle">
          <option value="true" ${item.inStock ? "selected" : ""}>In Stock</option>
          <option value="false" ${!item.inStock ? "selected" : ""}>Out of Stock</option>
        </select>
      </td>
      <td>
        <button class="deleteBtn" data-id="${docSnap.id}">Delete</button>
      </td>
    `;

    menuBody.appendChild(row);
  });

  // Stock toggle listener
  document.querySelectorAll(".stockToggle").forEach((dropdown) => {
    dropdown.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const newVal = e.target.value === "true";
      await updateDoc(doc(db, "menuItems", id), { inStock: newVal });
    });
  });

  // Delete button listener
  document.querySelectorAll(".deleteBtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (confirm("Delete this item?")) {
        await deleteDoc(doc(db, "menuItems", id));
      }
    });
  });
});
