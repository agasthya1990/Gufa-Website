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
// === Add to categoryCourse.js ===
import {
  collection, doc, getDocs, setDoc, updateDoc, query, where, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

// Fetch all categories as array of ids
export async function fetchCategories() {
  const out = [];
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach(d => out.push(d.id));
  return out;
}

// Rename a category safely: create new doc, migrate items, delete old doc
export async function renameCategoryEverywhere(oldName, newName) {
  const newId = newName.trim();
  if (!newId || newId === oldName) return;

  // 1) Create/overwrite new category doc
  await setDoc(doc(db, "menuCategories", newId), { name: newId });

  // 2) Migrate all menuItems (category == oldName) -> newName
  const q = query(collection(db, "menuItems"), where("category", "==", oldName));
  const snap = await getDocs(q);
  const updates = [];
  snap.forEach(s => updates.push(updateDoc(s.ref, { category: newId })));
  await Promise.all(updates);

  // 3) Delete the old category doc so it won't show as duplicate
  if (newId !== oldName) {
    await deleteDoc(doc(db, "menuCategories", oldName));
  }
}

// (Existing exports like loadCategories, renderCategoryList, addCategory can remain)
