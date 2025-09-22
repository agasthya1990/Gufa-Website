// Customer-side Firebase init (reuse the same project as Admin)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// IMPORTANT: use the SAME config as your Admin (public web keys are safe to expose)
export const app = initializeApp({
  apiKey: "AIzaSyD4Pob4ftpSkA0Tn22KShkinIniWiOv5IQ",
  authDomain: "gufa-restaurant.firebaseapp.com",
  projectId: "gufa-restaurant",
  storageBucket: "gufa-restaurant.appspot.com",
  messagingSenderId: "105496307977",
  appId: "1:105496307977:web:f9e61bf7ccc09ac5c7cbd8"
});

export const db = getFirestore(app);

// ALSO expose to window so non-module scripts can use window.db / window.app
if (typeof window !== "undefined") {
  window.app = app;
  window.db = db;
}
