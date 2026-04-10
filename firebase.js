// firebase.js
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6UqMyedaoaXgqOeddQN47ADgP8joO364",
  authDomain: "bellewear-boutique.firebaseapp.com",
  projectId: "bellewear-boutique",
  storageBucket: "bellewear-boutique.firebasestorage.app",
  messagingSenderId: "795858464616",
  appId: "1:795858464616:web:0bbf307b3da145766ff0dd",
};

// Initialize Firebase once
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// EXPORT these exactly
export const auth = getAuth(app);
export const db = getFirestore(app);

// Export Firestore functions for use in other modules
export {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
  updateDoc,
};

// ================= BEST SELLING PRODUCTS FROM ADMIN DASHBOARD =================
export async function fetchBestSellingProductsFromAdmin() {
  try {
    // First, try to fetch top products from productStats collection (populated by admin dashboard)
    const statsRef = collection(db, "productStats");
    const q = query(statsRef, orderBy("revenue", "desc"), limit(10));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      console.log("No productStats found yet");
      return [];
    }

    // Get product IDs from productStats
    const productIds = snapshot.docs.map((doc) => doc.data().productId);

    // Fetch full product details from products collection
    const productsRef = collection(db, "products");
    const allProductsSnapshot = await getDocs(productsRef);

    const productsMap = {};
    allProductsSnapshot.docs.forEach((doc) => {
      productsMap[doc.id] = { id: doc.id, ...doc.data() };
    });

    // Combine productStats with full product details
    const bestSelling = snapshot.docs
      .map((doc) => {
        const stats = doc.data();
        const productId = stats.productId;
        const fullProduct = productsMap[productId];

        if (!fullProduct) return null;

        return {
          ...fullProduct,
          sales: stats.sales,
          revenue: stats.revenue,
        };
      })
      .filter((p) => p !== null);

    console.log(
      "✅ Fetched best selling products from admin dashboard:",
      bestSelling.length,
    );
    return bestSelling;
  } catch (error) {
    console.error("Error fetching best selling products from admin:", error);
    return [];
  }
}
