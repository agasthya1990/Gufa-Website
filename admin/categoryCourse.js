import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./firebase.js";

/** =========================
 *  Hidden-select loaders
 *  =======================*/
export async function loadCategories(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Select Category --</option>';
  const snapshot = await getDocs(collection(db, "menuCategories"));
  snapshot.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id; opt.textContent = d.id;
    selectEl.appendChild(opt);
  });
}
export async function loadCourses(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Select Food Course --</option>';
  const snapshot = await getDocs(collection(db, "menuCourses"));
  snapshot.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id; opt.textContent = d.id;
    selectEl.appendChild(opt);
  });
}
/** Add-ons (multi) */
export async function loadAddons(selectEl) {
  if (!selectEl) return;
  // keep selections while reloading
  const prev = new Set([...selectEl.options].filter(o=>o.selected).map(o=>o.value));
  selectEl.innerHTML = ""; // multi-select (no placeholder)
  const snapshot = await getDocs(collection(db, "menuAddons"));
  snapshot.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id; opt.textContent = d.id;
    if (prev.has(d.id)) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

/** =========================
 *  List fetchers (arrays)
 *  =======================*/
export async function fetchCategories() {
  const out = []; const snap = await getDocs(collection(db, "menuCategories"));
  snap.forEach((d) => out.push(d.id)); return out;
}
export async function fetchCourses() {
  const out = []; const snap = await getDocs(collection(db, "menuCourses"));
  snap.forEach((d) => out.push(d.id)); return out;
}
export async function fetchAddons() {
  const out = []; const snap = await getDocs(collection(db, "menuAddons"));
  snap.forEach((d) => out.push(d.id)); return out;
}

/** =========================
 *  Add new entries
 *  =======================*/
export async function addCategory(input, after) {
  const value = (input?.value || "").trim();
  if (!value) return alert("Enter category");
  await setDoc(doc(db, "menuCategories", value), { name: value });
  if (input) input.value = ""; if (after) after();
}
export async function addCourse(input, after) {
  const value = (input?.value || "").trim();
  if (!value) return alert("Enter course");
  await setDoc(doc(db, "menuCourses", value), { name: value });
  if (input) input.value = ""; if (after) after();
}
export async function addAddon(input, after) {
  const value = (input?.value || "").trim();
  if (!value) return alert("Enter add-on");
  await setDoc(doc(db, "menuAddons", value), { name: value });
  if (input) input.value = ""; if (after) after();
}

/** =========================
 *  Rename everywhere (safe)
 *  =======================*/
export async function renameCategoryEverywhere(oldName, newName) {
  const newId = (newName || "").trim();
  if (!newId || newId === oldName) return;

  await setDoc(doc(db, "menuCategories", newId), { name: newId });

  const qCat = query(collection(db, "menuItems"), where("category", "==", oldName));
  const snap = await getDocs(qCat);
  const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { category: newId })));
  await Promise.all(ops);

  if (newId !== oldName) await deleteDoc(doc(db, "menuCategories", oldName));
}
export async function renameCourseEverywhere(oldName, newName) {
  const newId = (newName || "").trim();
  if (!newId || newId === oldName) return;

  await setDoc(doc(db, "menuCourses", newId), { name: newId });

  const qCrs = query(collection(db, "menuItems"), where("foodCourse", "==", oldName));
  const snap = await getDocs(qCrs);
  const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { foodCourse: newId })));
  await Promise.all(ops);

  if (newId !== oldName) await deleteDoc(doc(db, "menuCourses", oldName));
}
/** Add-ons rename across arrays */
export async function renameAddonEverywhere(oldName, newName) {
  const newId = (newName || "").trim();
  if (!newId || newId === oldName) return;

  // upsert new addon doc
  await setDoc(doc(db, "menuAddons", newId), { name: newId });

  // find items containing oldName in addons array
  const qAdd = query(collection(db, "menuItems"), where("addons", "array-contains", oldName));
  const snap = await getDocs(qAdd);
  const ops = [];
  snap.forEach((s) => {
    const data = s.data();
    const arr = Array.isArray(data.addons) ? data.addons : [];
    const next = Array.from(new Set(arr.map(a => a === oldName ? newId : a)));
    ops.push(updateDoc(s.ref, { addons: next }));
  });
  await Promise.all(ops);

  if (newId !== oldName) await deleteDoc(doc(db, "menuAddons", oldName));
}

/** =========================
 *  Delete everywhere (non-destructive)
 *  =======================*/
export async function deleteCategoryEverywhere(name) {
  const id = (name || "").trim(); if (!id) return;
  const q = query(collection(db, "menuItems"), where("category", "==", id));
  const snap = await getDocs(q); const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { category: "" })));
  await Promise.all(ops);
  await deleteDoc(doc(db, "menuCategories", id));
}
export async function deleteCourseEverywhere(name) {
  const id = (name || "").trim(); if (!id) return;
  const q = query(collection(db, "menuItems"), where("foodCourse", "==", id));
  const snap = await getDocs(q); const ops = [];
  snap.forEach((s) => ops.push(updateDoc(s.ref, { foodCourse: "" })));
  await Promise.all(ops);
  await deleteDoc(doc(db, "menuCourses", id));
}
/** Add-ons: remove from arrays; do not delete items */
export async function deleteAddonEverywhere(name) {
  const id = (name || "").trim(); if (!id) return;
  const q = query(collection(db, "menuItems"), where("addons", "array-contains", id));
  const snap = await getDocs(q); const ops = [];
  snap.forEach((s) => {
    const data = s.data();
    const arr = Array.isArray(data.addons) ? data.addons : [];
    const next = arr.filter(a => a !== id);
    ops.push(updateDoc(s.ref, { addons: next }));
  });
  await Promise.all(ops);
  await deleteDoc(doc(db, "menuAddons", id));
}
