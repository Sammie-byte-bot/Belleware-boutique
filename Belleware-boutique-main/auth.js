// auth.js
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   FIREBASE CONFIG
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyD6UqMyedaoaXgqOeddQN47ADgP8joO364",
  authDomain: "bellewear-boutique.firebaseapp.com",
  projectId: "bellewear-boutique",
  storageBucket: "bellewear-boutique.firebasestorage.app",
  messagingSenderId: "795858464616",
  appId: "1:795858464616:web:0bbf307b3da145766ff0dd",
};

/* =========================
   INIT
========================= */
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
let googlePopupPending = false;

async function processGoogleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    if (!result || !result.user) return;

    const user = result.user;
    localStorage.setItem("userName", user.displayName || user.email);
    window.location.href = "index.html";
  } catch (err) {
    console.warn("Google redirect result error", err);
  }
}

processGoogleRedirectResult();

/* =========================
   DOM ELEMENTS
========================= */
const form = document.getElementById("authForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");
const authMessage = document.getElementById("authMessage");
const switchMode = document.getElementById("switchMode");
const togglePassword = document.getElementById("togglePassword");
const googleBtn = document.getElementById("googleSignInBtn");
const submitBtn = form.querySelector("button");

let isLoginMode = false;

/* =========================
   PASSWORD TOGGLE
========================= */
togglePassword.addEventListener("click", () => {
  passwordInput.type = passwordInput.type === "password" ? "text" : "password";
});

/* =========================
   SWITCH LOGIN / SIGNUP
========================= */
switchMode.addEventListener("click", (e) => {
  e.preventDefault();
  isLoginMode = !isLoginMode;

  if (isLoginMode) {
    submitBtn.textContent = "Log in";
    document.getElementById("formTitle").textContent = "Log in";
    firstNameInput.style.display = "none";
    lastNameInput.style.display = "none";
    document.getElementById("terms-checkbox").parentElement.style.display =
      "none";
  } else {
    submitBtn.textContent = "Create account";
    document.getElementById("formTitle").textContent = "Create an account";
    firstNameInput.style.display = "block";
    lastNameInput.style.display = "block";
    document.getElementById("terms-checkbox").parentElement.style.display =
      "flex";
  }
});

/* =========================
   FORM SUBMIT
========================= */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  authMessage.textContent = "";

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const firstName = firstNameInput.value.trim();
  const lastName = lastNameInput.value.trim();

  if (!isLoginMode && !document.getElementById("terms-checkbox").checked) {
    authMessage.style.color = "red";
    authMessage.textContent = "You must accept Terms & Conditions";
    return;
  }

  try {
    let userCredential;

    /* ===== LOGIN ===== */
    if (isLoginMode) {
      userCredential = await signInWithEmailAndPassword(auth, email, password);
    } else {
      /* ===== SIGNUP ===== */
      userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );

      const user = userCredential.user;
      const fullName = `${firstName} ${lastName}`;

      // Update Auth profile
      await updateProfile(user, { displayName: fullName });

      // Create Firestore profile
      await setDoc(doc(db, "users", user.uid), {
        firstName,
        lastName,
        fullName,
        email,
        phone: "",
        wallet: 0,
        createdAt: serverTimestamp(),
      });
    }

    /* =========================
       ENSURE FIRESTORE PROFILE
    ========================= */
    const user = userCredential.user;
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, {
        fullName: user.displayName || "User",
        email: user.email,
        phone: "",
        wallet: 0,
        createdAt: serverTimestamp(),
      });
    }

    /* =========================
       UI UPDATE
    ========================= */
    const name = user.displayName || user.email;
    const displayName = name.length > 12 ? name.slice(0, 12) + "..." : name;

    localStorage.setItem("userName", displayName);

    if (window.renderProfileDropdown) {
      window.renderProfileDropdown();
    }

    authMessage.style.color = "green";
    authMessage.textContent = isLoginMode
      ? "Logged in successfully!"
      : "Account created successfully!";

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);
  } catch (err) {
    authMessage.style.color = "red";
    authMessage.textContent = err.message;
  }
});

/* =========================
   GOOGLE SIGN IN
========================= */
googleBtn.addEventListener("click", async () => {
  if (googlePopupPending) return;
  googlePopupPending = true;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, {
        fullName: user.displayName || "User",
        email: user.email,
        phone: "",
        wallet: 0,
        createdAt: serverTimestamp(),
      });
    }

    const name = user.displayName || user.email;
    const displayName = name.length > 12 ? name.slice(0, 12) + "..." : name;

    localStorage.setItem("userName", displayName);

    if (window.renderProfileDropdown) {
      window.renderProfileDropdown();
    }

    authMessage.style.color = "green";
    authMessage.textContent = "Signed in with Google!";

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);
  } catch (err) {
    const message = err?.message || "Google sign-in failed";
    if (
      message.includes("Pending promise was never set") ||
      message.includes("popup blocked") ||
      message.includes("operation-not-supported-in-this-environment")
    ) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    authMessage.style.color = "red";
    authMessage.textContent = message;
  } finally {
    googlePopupPending = false;
  }
});
