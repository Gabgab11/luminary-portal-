import { auth, db } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  getDocs,
  limit,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

/* ==========================================================================
   Luminary Digital Group — Unified login
   One email+password form for both clients and the admin. The Client/Admin
   toggle is just framing for the visitor — actual routing is decided AFTER
   sign-in by checking who the authenticated email actually belongs to.
   Never trust the toggle for access control; only the lookup below does.
   ========================================================================== */

// Keep this in sync with the ADMIN_EMAIL used in firestore.rules.
const ADMIN_EMAIL = "gabrieliyanu2014@gmail.com";

const tabClient = document.getElementById("tabClient");
const tabAdmin = document.getElementById("tabAdmin");
const subCopy = document.getElementById("subCopy");
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const loginInfo = document.getElementById("loginInfo");
const forgotBtn = document.getElementById("forgotBtn");

let selectedRole = "client";

function setRole(role) {
  selectedRole = role;
  tabClient.classList.toggle("is-active", role === "client");
  tabClient.setAttribute("aria-selected", role === "client");
  tabAdmin.classList.toggle("is-active", role === "admin");
  tabAdmin.setAttribute("aria-selected", role === "admin");
  subCopy.textContent =
    role === "admin"
      ? "Sign in with your Luminary admin account."
      : "Enter your email and password to reach your portal.";
}

tabClient.addEventListener("click", () => setRole("client"));
tabAdmin.addEventListener("click", () => setRole("admin"));

function showError(message) {
  loginInfo.style.display = "none";
  loginError.textContent = message;
  loginError.style.display = "block";
}

function showInfo(message) {
  loginError.style.display = "none";
  loginInfo.textContent = message;
  loginInfo.style.display = "block";
}

async function findClientSlugForEmail(email) {
  const clientsRef = collection(db, "clients");
  const q = query(clientsRef, where("clientEmail", "==", email), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].id;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.style.display = "none";
  loginInfo.style.display = "none";
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";

  const email = loginEmail.value.trim().toLowerCase();
  const password = loginPassword.value;

  try {
    await signInWithEmailAndPassword(auth, email, password);

    if (email === ADMIN_EMAIL) {
      window.location.href = "admin.html";
      return;
    }

    const slug = await findClientSlugForEmail(email);
    if (slug) {
      window.location.href = `index.html?client=${slug}`;
      return;
    }

    // Signed in successfully but this email isn't linked to any client or
    // the admin account — don't leave them signed in to nothing.
    await signOut(auth);
    showError("This account isn't linked to a client portal yet. Contact Luminary Digital Group.");
  } catch (err) {
    showError(
      err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found"
        ? "Couldn't sign in — check your email and password."
        : "Something went wrong signing in. Please try again."
    );
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign in";
  }
});

forgotBtn.addEventListener("click", async () => {
  const email = loginEmail.value.trim().toLowerCase();
  if (!email) {
    showError("Type your email above first, then tap this again.");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showInfo(`Check ${email} for a link to set your password.`);
  } catch (err) {
    showError("Couldn't send a reset email for that address. Double-check it's correct.");
  }
});
