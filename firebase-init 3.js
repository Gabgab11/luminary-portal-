// ============================================================
// Firebase connection — shared by admin.html and the client portal.
// Your config values are not secret; access control comes from the
// Firestore rules you pasted in, not from hiding these.
//
// Note: Cloud Storage isn't used here on purpose — PDFs are read
// entirely in the browser for extraction and never uploaded, so this
// project only needs the free Spark plan (Auth + Firestore).
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCDp5TcLGVfsBBRIjd6tAPYAFFlXP--OIc",
  authDomain: "luminary-client-portal.firebaseapp.com",
  projectId: "luminary-client-portal",
  storageBucket: "luminary-client-portal.firebasestorage.app",
  messagingSenderId: "451735321941",
  appId: "1:451735321941:web:9e1f42fe01cb0b7e1383dc",
  measurementId: "G-6QXE42D1TB",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
