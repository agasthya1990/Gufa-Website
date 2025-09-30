// /admin/categoryCourse.js
import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ===== fetchers =====
export async function fetchCategories() {
  const out = []; const snap = await getDocs(collection(db, "menuCategories"));
  snap.forEach(d => { const v=d.data(); if (v?.name) out.push(v.name); });
  return out.sort((a,b)=>a.localeCompare(b));
}
export async function fetchCourses() {
  const out = []; const snap = await getDocs(collection(db, "foodCourses"));
  snap.forEach(d => { const v=d.data(); if (v?.name) out.push(v.name); });
  return out.sort((a,b)=>a.localeCompare(b));
}

// ===== loaders (native selects) =====
export async function loadCategories(select) {
  if (!select) return; const prev = select.value; const cats = await fetchCategories();
  select.innerHTML = `<option value="">-- Select Category --</option>` + cats.map(c=>`<option>${c}</option>`).join("");
  select.value = prev || "";
}
export async function loadCourses(select) {
  if (!select) return; const prev = select.value; const courses = await fetchCourses();
  select.innerHTML = `<option value="">-- Select Food Course --</option>` + courses.map(c=>`<option>${c}</option>`).join("");
  select.value = prev || "";
}

// ===== creators =====
export async function addCategory(inputEl) {
  const name = (inputEl?.value || "").trim();
  if (!name) return alert("Enter category name");
  await addDoc(collection(db, "menuCategories"), { name });
  inputEl.value = "";
}
export async function addCourse(inputEl) {
  const name = (inputEl?.value || "").trim();
  if (!name) return alert("Enter course name");
  await addDoc(collection(db, "foodCourses"), { name });
  inputEl.value = "";
}

// ===== rename everywhere =====
export async function renameCategoryEverywhere(oldName, newName){
  // update masters
  const qs = query(collection(db, "menuCategories"), where("name","==", oldName));
  const snap = await getDocs(qs);
  const ops = [];
  snap.forEach(d => ops.push(updateDoc(doc(db,"menuCategories", d.id), { name:newName })));
  await Promise.all(ops);

  // NOTE: menu items’ category is a string field; only update those matching oldName
  const itemsSnap = await getDocs(collection(db,"menuItems"));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const val = d.data()?.category || "";
    if (val === oldName) itemOps.push(updateDoc(doc(db,"menuItems", d.id), { category:newName }));
  });
  await Promise.all(itemOps);
}
export async function renameCourseEverywhere(oldName, newName){
  const qs = query(collection(db, "foodCourses"), where("name","==", oldName));
  const snap = await getDocs(qs);
  const ops = [];
  snap.forEach(d => ops.push(updateDoc(doc(db,"foodCourses", d.id), { name:newName })));
  await Promise.all(ops);

  const itemsSnap = await getDocs(collection(db,"menuItems"));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const val = d.data()?.foodCourse || "";
    if (val === oldName) itemOps.push(updateDoc(doc(db,"menuItems", d.id), { foodCourse:newName }));
  });
  await Promise.all(itemOps);
}

// ===== delete everywhere =====
export async function deleteCategoryEverywhere(name){
  const qs = query(collection(db, "menuCategories"), where("name","==", name));
  const snap = await getDocs(qs);
  const ops = [];
  snap.forEach(d => ops.push(deleteDoc(doc(db,"menuCategories", d.id))));
  await Promise.all(ops);

  // clear category field on matching menu items (don’t delete items)
  const itemsSnap = await getDocs(collection(db,"menuItems"));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const val = d.data()?.category || "";
    if (val === name) itemOps.push(updateDoc(doc(db,"menuItems", d.id), { category:"" }));
  });
  await Promise.all(itemOps);
}
export async function deleteCourseEverywhere(name){
  const qs = query(collection(db, "foodCourses"), where("name","==", name));
  const snap = await getDocs(qs);
  const ops = [];
  snap.forEach(d => ops.push(deleteDoc(doc(db,"foodCourses", d.id))));
  await Promise.all(ops);

  const itemsSnap = await getDocs(collection(db,"menuItems"));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const val = d.data()?.foodCourse || "";
    if (val === name) itemOps.push(updateDoc(doc(db,"menuItems", d.id), { foodCourse:"" }));
  });
  await Promise.all(itemOps);
}

// ===== add-ons helpers (so admin.js has a single import place) =====
export async function fetchAddons(){
  const out = []; const snap = await getDocs(collection(db, "menuAddons"));
  snap.forEach(d => { const v=d.data()||{}; out.push({ name: v.name || d.id, price: Number(v.price || 0) }); });
  return out.sort((a,b)=>a.name.localeCompare(b.name));
}
export async function loadAddons(select){
  if (!select) return;
  const keep = new Set(Array.from(select.selectedOptions || []).map(o=>o.value));
  const rows = await fetchAddons();
  select.innerHTML = rows.map(a => `<option value="${a.name}" data-price="${a.price}">${a.name} (₹${a.price})</option>`).join("");
  Array.from(select.options).forEach(o => o.selected = keep.has(o.value));
}
export async function addAddon(nameEl, priceEl){
  const name = (nameEl?.value || "").trim();
  const price = Number(priceEl?.value || 0);
  if (!name) return alert("Enter add-on name");
  if (!Number.isFinite(price) || price < 0) return alert("Enter valid price");
  await addDoc(collection(db, "menuAddons"), { name, price });
  nameEl.value = ""; if (priceEl) priceEl.value = "";
}

export async function renameAddonEverywhere(oldName, newName, newPrice){
  // update masters
  const qref = query(collection(db,"menuAddons"), where("name","==", oldName));
  const snap = await getDocs(qref);
  const ops = [];
  snap.forEach(d => ops.push(updateDoc(doc(db,"menuAddons", d.id), { ...(d.data()||{}), name:newName, price:Number(newPrice) })));
  await Promise.all(ops);
  // update items
  const itemsSnap = await getDocs(collection(db,"menuItems"));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const data = d.data() || {};
    if (!Array.isArray(data.addons)) return;
    let changed = false;
    const updated = data.addons.map(a => {
      if (a == null) return a;
      if (typeof a === "string") { if (a === oldName) { changed = true; return newName; } return a; }
      if (a.name === oldName) { changed = true; return { ...a, name:newName, price:Number(newPrice) }; }
      return a;
    });
    if (changed) itemOps.push(updateDoc(doc(db,"menuItems", d.id), { addons: updated }));
  });
  await Promise.all(itemOps);
}
export async function deleteAddonEverywhere(name){
  // delete master
  const qref = query(collection(db,"menuAddons"), where("name","==", name));
  const snap = await getDocs(qref);
  const ops = [];
  snap.forEach(d => ops.push(deleteDoc(doc(db,"menuAddons", d.id))));
  await Promise.all(ops);
  // clean items
  const itemsSnap = await getDocs(collection(db,"menuItems"));
  const itemOps = [];
  itemsSnap.forEach(d => {
    const data = d.data() || {};
    if (!Array.isArray(data.addons)) return;
    const updated = data.addons.filter(a => (typeof a === "string") ? (a !== name) : (a?.name !== name));
    if (updated.length !== data.addons.length) itemOps.push(updateDoc(doc(db,"menuItems", d.id), { addons: updated }));
  });
  await Promise.all(itemOps);
}
