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
