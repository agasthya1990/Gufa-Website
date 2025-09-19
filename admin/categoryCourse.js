import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

/** ========== Hidden-select loaders ========== */
export async function loadCategories(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Select Category --</option>';
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.id;
    selectEl.appendChild(opt);
  });
}
export async function loadCourses(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Select Food Course --</option>';
  const snapshot = await getDocs(collection(db, "menuCourses"));
  snapshot.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.id;
    selectEl.appendChild(opt);
  });
}

/** ========== List fetchers (arrays) ========== */
export async function fetchCategories() {
  const out = [];
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach((d) => out.push(d.id));
  return out;
}
export async function fetchCourses() {
  const out = [];
  const snapshot = await getDocs(collection(db, "menuCourses"));
  snapshot.forEach((d) => out.push(d.id));
  return out;
}

/** ========== Add new entries ========== */
export async function addCategory(input, after) {
  const value = (input?.value || "").trim();
  if (!value) return alert("Enter category");
  await setDoc(doc(db, "menuCategories", value), { name: value });
  if (input) input.value = "";
  if (after) after();
}
export async function addCourse(input, after) {
  const value = (input?.value || "").trim();
  if (!value) return alert("Enter course");
  await setDoc(doc(db, "menuCourses", value), { name: value });
  if (input) input.value = "";
  if (after) after();
}

/** ========== Rename everywhere (safe) ========== */
export async function renameCategoryEverywhere(oldName, newName) {
  const newId = (newName || "").trim();
  if (!newId || newId === oldName) return;

  // 1) Upsert new category doc
  await setDoc(doc(db, "menuCategories", newId), { name: newId });

  // 2) Migrate items
  const q = query(collection(db, "menuItems"), where("category", "==", oldName));
  const snap = await getDocs(q);
  const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { category: newId })));
  await Promise.all(ops);

  // 3) Delete old doc
  if (newId !== oldName) await deleteDoc(doc(db, "menuCategories", oldName));
}
export async function renameCourseEverywhere(oldName, newName) {
  const newId = (newName || "").trim();
  if (!newId || newId === oldName) return;

  await setDoc(doc(db, "menuCourses", newId), { name: newId });

  const q = query(collection(db, "menuItems"), where("foodCourse", "==", oldName));
  const snap = await getDocs(q);
  const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { foodCourse: newId })));
  await Promise.all(ops);

  if (newId !== oldName) await deleteDoc(doc(db, "menuCourses", oldName));
}

/** ========== Delete everywhere (non-destructive) ========== */
// Clears the field on items; DOES NOT delete items.
export async function deleteCategoryEverywhere(name) {
  const id = (name || "").trim();
  if (!id) return;

  const q = query(collection(db, "menuItems"), where("category", "==", id));
  const snap = await getDocs(q);
  const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { category: "" })));
  await Promise.all(ops);

  await deleteDoc(doc(db, "menuCategories", id));
}
export async function deleteCourseEverywhere(name) {
  const id = (name || "").trim();
  if (!id) return;

  const q = query(collection(db, "menuItems"), where("foodCourse", "==", id));
  const snap = await getDocs(q);
  const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { foodCourse: "" })));
  await Promise.all(ops);

  await deleteDoc(doc(db, "menuCourses", id));
}
