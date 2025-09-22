// Customer Firebase init (ES module). Exposes window.app and window.db for non-module scripts.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const app = initializeApp({
  apiKey: "AIzaSyD4Pob4ftpSkA0Tn22KShkinIniWiOv5IQ",
  authDomain: "gufa-restaurant.firebaseapp.com",
  projectId: "gufa-restaurant",
  storageBucket: "gufa-restaurant.appspot.com",
  messagingSenderId: "105496307977",
  appId: "1:105496307977:web:f9e61bf7ccc09ac5c7cbd8"
});
export const db = getFirestore(app);

// expose for window-based scripts
window.app = app;
window.db = db;
