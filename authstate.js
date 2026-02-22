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
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6UqMyedaoaXgqOeddQN47ADgP8joO364",
  authDomain: "bellewear-boutique.firebaseapp.com",
  projectId: "bellewear-boutique",
  storageBucket: "bellewear-boutique.firebasestorage.app",
  messagingSenderId: "795858464616",
  appId: "1:795858464616:web:0bbf307b3da145766ff0dd",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const form = document.getElementById("authForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");
const authMessage = document.getElementById("authMessage");
const switchMode = document.getElementById("switchMode");
const togglePassword = document.getElementById("togglePassword");
const googleBtn = document.getElementById("googleSignInBtn");

let isLoginMode = false;

// Password toggle
togglePassword.addEventListener("click", () => {
  passwordInput.type = passwordInput.type === "password" ? "text" : "password";
});

// Switch login/register
switchMode.addEventListener("click", (e) => {
  e.preventDefault();
  isLoginMode = !isLoginMode;
  if (isLoginMode) {
    form.querySelector("button").textContent = "Log in";
    document.getElementById("formTitle").textContent = "Log in";
    firstNameInput.style.display = "none";
    lastNameInput.style.display = "none";
  } else {
    form.querySelector("button").textContent = "Create account";
    document.getElementById("formTitle").textContent = "Create an account";
    firstNameInput.style.display = "block";
    lastNameInput.style.display = "block";
  }
});

// Form submit
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  authMessage.textContent = "";

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const firstName = firstNameInput.value.trim();
  const lastName = lastNameInput.value.trim();

  if (!isLoginMode && !document.getElementById("terms-checkbox").checked) {
    authMessage.textContent = "You must accept Terms & Conditions";
    return;
  }

  try {
    let userCredential;
    if (isLoginMode) {
      userCredential = await signInWithEmailAndPassword(auth, email, password);
    } else {
      userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      await userCredential.user.updateProfile({
        displayName: `${firstName} ${lastName}`,
      });
    }

    localStorage.setItem(
      "userName",
      userCredential.user.displayName || userCredential.user.email
    );
    window.location.href = "index.html"; // redirect
  } catch (err) {
    authMessage.textContent = err.message;
  }
});

// Google Sign-In
googleBtn.addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    localStorage.setItem("userName", user.displayName || user.email);
    window.location.href = "index.html"; // redirect
  } catch (err) {
    authMessage.textContent = err.message;
  }
});
