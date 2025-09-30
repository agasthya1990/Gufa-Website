// categoryCourse.js — shared helpers for Categories & Courses (no body scroll lock)
import { db } from "./firebase.js";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const el  = (id) => document.getElementById(id);
const qs  = (s, c=document) => c.querySelector(s);

// === public fetchers ===
export async function fetchCategories() {
  const out = [];
  const snap = await getDocs(collection(db, "menuCategories"));
  snap.forEach(d => { const v = d.data(); if (v?.name) out.push(v.name); });
  return out.sort((a,b)=>a.localeCompare(b));
}

export async function fetchCourses() {
  const out = [];
  const snap = await getDocs(collection(db, "menuCourses")); // <-- final name
  snap.forEach(d => { const v = d.data(); if (v?.name) out.push(v.name); });
  return out.sort((a,b)=>a.localeCompare(b));
}

export async function loadCategories(selectEl) {
  if (!selectEl) return;
  const prev = selectEl.value;
  const cats = await fetchCategories();
  selectEl.innerHTML = `<option value="">-- Select Category --</option>` + cats.map(c=>`<option>${c}</option>`).join("");
  selectEl.value = prev || "";
}

export async function loadCourses(selectEl) {
  if (!selectEl) return;
  const prev = selectEl.value;
  const courses = await fetchCourses();
  selectEl.innerHTML = `<option value="">-- Select Food Course --</option>` + courses.map(c=>`<option>${c}</option>`).join("");
  selectEl.value = prev || "";
}

export async function addCategoryFromInput(inputEl) {
  const name = (inputEl?.value || "").trim();
  if (!name) return alert("Enter category name");
  await addDoc(collection(db, "menuCategories"), { name });
  inputEl.value = "";
}

export async function addCourseFromInput(inputEl) {
  const name = (inputEl?.value || "").trim();
  if (!name) return alert("Enter course name");
  await addDoc(collection(db, "menuCourses"), { name }); // <-- final name
  inputEl.value = "";
}

// === comic popovers (no page lock; click-outside to close) ===
function openPopover(button, panel) {
  if (!button || !panel) return;
  const open = panel.style.display !== "block";
  panel.style.display = open ? "block" : "none";

  if (!open) return;

  // "genie" origin (simple)
  const r = button.getBoundingClientRect();
  const cx = r.left + r.width/2;
  panel.style.setProperty("--adm-origin", `${(cx / Math.max(window.innerWidth, 1))*100}% 0%`);

  panel.classList.remove("adm-anim-out");
  panel.classList.add("adm-anim-in");

  const close = (ev) => {
    if (!panel.contains(ev.target) && ev.target !== button) {
      panel.classList.remove("adm-anim-in");
      panel.classList.add("adm-anim-out");
      setTimeout(() => { panel.style.display = "none"; document.removeEventListener("mousedown", close); }, 160);
    }
  };
  document.addEventListener("mousedown", close);
}

// CATEGORY popover: Use / Edit / Delete
export async function renderCustomCategoryDropdown() {
  const catBtn   = el("categoryDropdownBtn");
  const catPanel = el("categoryDropdownPanel");
  const select   = el("itemCategory");
  if (!catBtn || !catPanel || !select) return;

  const cats = await fetchCategories();
  catPanel.innerHTML = cats.map(name => `
    <div class="adm-list-row" data-name="${name}">
      <span class="_name" data-role="label" title="${name}">${name}</span>
      <button class="adm-chip-btn" data-role="select" title="Use">Use</button>
      <span class="adm-icon" data-role="edit"   aria-label="Edit"   title="Edit">🖉</span>
      <span class="adm-icon" data-role="delete" aria-label="Delete" title="Delete">🗑</span>
    </div>`).join("");

  catBtn.onclick = (e) => { e.stopPropagation(); openPopover(catBtn, catPanel); };

  catPanel.onclick = async (e) => {
    const row = e.target.closest(".adm-list-row");
    if (!row) return;
    const role = e.target.getAttribute("data-role");
    const oldName = row.getAttribute("data-name");

    if (role === "select") {
      if (![...select.options].some(o => o.value === oldName)) {
        const o = document.createElement("option"); o.value = oldName; o.textContent = oldName; select.appendChild(o);
      }
      select.value = oldName;
      catBtn.textContent = `${oldName} ▾`;
      catPanel.style.display = "none";
      return;
    }

    if (role === "edit") {
      const labelEl = row.querySelector('[data-role="label"]');
      const cur = labelEl?.textContent || oldName;
      labelEl.innerHTML = `<input type="text" class="adm-input" value="${cur}" style="min-width:160px" />`;

      // hide edit/delete, show ✓/✕
      row.querySelector('[data-role="edit"]').style.display = 'none';
      row.querySelector('[data-role="delete"]').style.display = 'none';

      const saveBtn = document.createElement('span');
      saveBtn.className = 'adm-icon';
      saveBtn.setAttribute('data-role','save');
      saveBtn.textContent = '✓';

      const cancelBtn = document.createElement('span');
      cancelBtn.className = 'adm-icon';
      cancelBtn.setAttribute('data-role','cancel');
      cancelBtn.textContent = '✕';

      row.appendChild(saveBtn);
      row.appendChild(cancelBtn);
      return;
    }

    if (role === "cancel") {
      const input = row.querySelector('input.adm-input');
      const val = input ? input.value : oldName;
      const labelEl = row.querySelector('[data-role="label"]'); if (labelEl) labelEl.textContent = val;
      row.querySelector('[data-role="edit"]').style.display = '';
      row.querySelector('[data-role="delete"]').style.display = '';
      row.querySelector('[data-role="save"]')?.remove();
      row.querySelector('[data-role="cancel"]')?.remove();
      return;
    }

    if (role === "save") {
      const input = row.querySelector('input.adm-input');
      const newName = (input?.value || '').trim();
      if (!newName) return alert('Category name cannot be empty');

      try {
        const qref = query(collection(db, 'menuCategories'), where('name','==', oldName));
        const snap = await getDocs(qref);
        const ops = [];
        snap.forEach(d => ops.push(updateDoc(doc(db, 'menuCategories', d.id), { name: newName })));
        await Promise.all(ops);

        row.setAttribute('data-name', newName);
        const labelEl = row.querySelector('[data-role="label"]'); if (labelEl) labelEl.textContent = newName;
        row.querySelector('[data-role="edit"]').style.display = '';
        row.querySelector('[data-role="delete"]').style.display = '';
        row.querySelector('[data-role="save"]')?.remove();
        row.querySelector('[data-role="cancel"]')?.remove();
        await loadCategories(select);
      } catch (err) {
        console.error(err);
        alert('Rename failed: ' + (err?.message || err));
      }
      return;
    }

    if (role === "delete") {
      if (!confirm(`Delete category "${oldName}"?`)) return;
      try {
        const qref = query(collection(db, 'menuCategories'), where('name','==', oldName));
        const snap = await getDocs(qref);
        const ops = [];
        snap.forEach(d => ops.push(deleteDoc(doc(db, 'menuCategories', d.id))));
        await Promise.all(ops);
        row.remove();
        await loadCategories(select);
      } catch (err) {
        console.error(err);
        alert('Delete failed: ' + (err?.message || err));
      }
    }
  };
}

// COURSE popover to parity (Use / Edit / Delete)
export async function renderCustomCourseDropdown() {
  const courseBtn   = el("courseDropdownBtn");
  const coursePanel = el("courseDropdownPanel");
  const select      = el("foodCourse");
  if (!courseBtn || !coursePanel || !select) return;

  const courses = await fetchCourses();
  coursePanel.innerHTML = courses.map(name => `
    <div class="adm-list-row" data-name="${name}">
      <span class="_name" data-role="label" title="${name}">${name}</span>
      <button class="adm-chip-btn" data-role="select" title="Use">Use</button>
      <span class="adm-icon" data-role="edit"   aria-label="Edit"   title="Edit">🖉</span>
      <span class="adm-icon" data-role="delete" aria-label="Delete" title="Delete">🗑</span>
    </div>`).join("");

  courseBtn.onclick = (e) => { e.stopPropagation(); openPopover(courseBtn, coursePanel); };

  coursePanel.onclick = async (e) => {
    const row = e.target.closest(".adm-list-row");
    if (!row) return;
    const role = e.target.getAttribute("data-role");
    const oldName = row.getAttribute("data-name");

    if (role === "select") {
      if (![...select.options].some(o => o.value === oldName)) {
        const o = document.createElement("option"); o.value = oldName; o.textContent = oldName; select.appendChild(o);
      }
      select.value = oldName;
      courseBtn.textContent = `${oldName} ▾`;
      coursePanel.style.display = "none";
      return;
    }

    if (role === "edit") {
      const labelEl = row.querySelector('[data-role="label"]');
      const cur = labelEl?.textContent || oldName;
      labelEl.innerHTML = `<input type="text" class="adm-input" value="${cur}" style="min-width:160px" />`;
      row.querySelector('[data-role="edit"]').style.display = 'none';
      row.querySelector('[data-role="delete"]').style.display = 'none';

      const saveBtn = document.createElement('span');
      saveBtn.className = 'adm-icon';
      saveBtn.setAttribute('data-role','save');
      saveBtn.textContent = '✓';

      const cancelBtn = document.createElement('span');
      cancelBtn.className = 'adm-icon';
      cancelBtn.setAttribute('data-role','cancel');
      cancelBtn.textContent = '✕';

      row.appendChild(saveBtn);
      row.appendChild(cancelBtn);
      return;
    }

    if (role === "cancel") {
      const input = row.querySelector('input.adm-input');
      const val = input ? input.value : oldName;
      const labelEl = row.querySelector('[data-role="label"]'); if (labelEl) labelEl.textContent = val;
      row.querySelector('[data-role="edit"]').style.display = '';
      row.querySelector('[data-role="delete"]').style.display = '';
      row.querySelector('[data-role="save"]')?.remove();
      row.querySelector('[data-role="cancel"]')?.remove();
      return;
    }

    if (role === "save") {
      const input = row.querySelector('input.adm-input');
      const newName = (input?.value || '').trim();
      if (!newName) return alert('Course name cannot be empty');

      try {
        const qref = query(collection(db, 'menuCourses'), where('name','==', oldName)); // final name
        const snap = await getDocs(qref);
        const ops = [];
        snap.forEach(d => ops.push(updateDoc(doc(db, 'menuCourses', d.id), { name: newName })));
        await Promise.all(ops);

        row.setAttribute('data-name', newName);
        const labelEl = row.querySelector('[data-role="label"]'); if (labelEl) labelEl.textContent = newName;
        row.querySelector('[data-role="edit"]').style.display = '';
        row.querySelector('[data-role="delete"]').style.display = '';
        row.querySelector('[data-role="save"]')?.remove();
        row.querySelector('[data-role="cancel"]')?.remove();
        await loadCourses(select);
      } catch (err) {
        console.error(err);
        alert('Rename failed: ' + (err?.message || err));
      }
      return;
    }

    if (role === "delete") {
      if (!confirm(`Delete course "${oldName}"?`)) return;
      try {
        const qref = query(collection(db, 'menuCourses'), where('name','==', oldName)); // final name
        const snap = await getDocs(qref);
        const ops = [];
        snap.forEach(d => ops.push(deleteDoc(doc(db, 'menuCourses', d.id))));
        await Promise.all(ops);
        row.remove();
        await loadCourses(select);
      } catch (err) {
        console.error(err);
        alert('Delete failed: ' + (err?.message || err));
      }
    }
  };
}
