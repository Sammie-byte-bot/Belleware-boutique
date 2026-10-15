import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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
const db = getFirestore(app);

// Verify that the signed-in user is an admin (reads users/{uid}.role)
async function checkIsAdmin(user) {
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    return snap.exists() && snap.data().role?.trim() === "admin";
  } catch (err) {
    console.error("checkIsAdmin error", err);
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // NOT logged in → admin login page
    window.location.replace("login.html");
    return;
  }

  try {
    const isAdmin = await checkIsAdmin(user);

    if (!isAdmin) {
      // Logged in but NOT admin
      await auth.signOut();
      window.location.replace("auth.html");
      return;
    }

    // ✅ Admin verified — DO NOTHING
    console.log("Admin access granted");
    window.isAdmin = true;
    window.adminUid = user.uid;
    window.dispatchEvent(new CustomEvent("admin:ready"));
  } catch (err) {
    console.error("Admin guard failed", err);
    await auth.signOut();
    window.location.replace("login.html");
  }
});
