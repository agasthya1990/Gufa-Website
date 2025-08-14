import {
  collection, doc, deleteDoc, getDocs, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

// Load & Render Categories
export async function loadCategories(categoryDropdown) {
  categoryDropdown.innerHTML = '<option value="">-- Select Category --</option>';
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.id;
    categoryDropdown.appendChild(opt);
  });
}

// Render List with Delete
export async function renderCategoryList(container) {
  container.innerHTML = "";
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach(docSnap => {
    const div = document.createElement("div");
    div.innerHTML = `
      ${docSnap.id}
      <button data-id="${docSnap.id}" class="deleteCatBtn">🗑️</button>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll(".deleteCatBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      if (confirm(`Delete category "${id}"?`)) {
        await deleteDoc(doc(db, "menuCategories", id));
        renderCategoryList(container);
        loadCategories(document.getElementById("itemCategory"));
      }
    };
  });
}

// Add Category
export async function addCategory(input, callback) {
  const value = input.value.trim();
  if (!value) return alert("Enter category");
  await setDoc(doc(db, "menuCategories", value), { name: value });
  input.value = "";
  callback(); // Refresh dropdown
}
