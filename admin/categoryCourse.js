import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

// Load & Render Categories into dropdown
export async function loadCategories(categoryDropdown) {
  categoryDropdown.innerHTML = '<option value="">-- Select Category --</option>';
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach(docSnap => {
    const opt = document.createElement("option");
    opt.value = docSnap.id;
    opt.textContent = docSnap.id;
    categoryDropdown.appendChild(opt);
  });
}

// Render list of categories with Edit button
export async function renderCategoryList(container) {
  container.innerHTML = "";
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach(docSnap => {
    const div = document.createElement("div");
    div.innerHTML = `
      ${docSnap.id}
      <button data-id="${docSnap.id}" class="editCatBtn">✏️ Edit</button>
    `;
    container.appendChild(div);
  });

  // Edit category button handler
  container.querySelectorAll(".editCatBtn").forEach(btn => {
    btn.onclick = async () => {
      const oldName = btn.dataset.id;
      const newName = prompt(`Enter new name for category "${oldName}":`, oldName);
      if (!newName || newName.trim() === "" || newName === oldName) return;

      // Update the category document (rename)
      await setDoc(doc(db, "menuCategories", newName), { name: newName });

      // Sync all menuItems that used oldName
      await updateMenuItemsCategory(oldName, newName);

      // Optionally remove old category doc if different
      if (newName !== oldName) {
        // Note: safer to delete only after migration succeeds
        // But since we just copied into new doc, we can remove the old
        await updateDoc(doc(db, "menuCategories", oldName), { renamedTo: newName }).catch(() => {});
      }

      renderCategoryList(container);
      loadCategories(document.getElementById("itemCategory"));
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

// Helper: update all menuItems using oldName
async function updateMenuItemsCategory(oldName, newName) {
  const q = query(collection(db, "menuItems"), where("category", "==", oldName));
  const snapshot = await getDocs(q);
  const updates = [];
  snapshot.forEach(docSnap => {
    updates.push(updateDoc(docSnap.ref, { category: newName }));
  });
  await Promise.all(updates);
}
