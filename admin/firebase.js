// firebase.js
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Your web app's Firebase configuration (unchanged)
const firebaseConfig = {
  apiKey: "AIzaSyD4Pob4ftpSkA0Tn22KShkinIniWiOv5IQ",
  authDomain: "gufa-restaurant.firebaseapp.com",
  projectId: "gufa-restaurant",
  storageBucket: "gufa-restaurant.firebasestorage.app", // ← kept as-is
  messagingSenderId: "105496307977",
  appId: "1:105496307977:web:f9e61bf7ccc09ac5c7cbd8"
};

// Avoid re-initializing if the module is imported more than once
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// (optional) default export for convenience in some bundlers
export default { auth, db, storage };
