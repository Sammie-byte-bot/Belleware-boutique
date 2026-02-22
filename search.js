// ================= FIREBASE IMPORTS =================
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase.js";

// ================= CACHE =================
let productCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// ================= FETCH ALL PRODUCTS =================
export async function fetchAllProducts() {
  const now = Date.now();

  // Return cached data if still fresh
  if (
    productCache &&
    productCache.length > 0 &&
    now - cacheTimestamp < CACHE_DURATION
  ) {
    return productCache;
  }

  try {
    const q = query(
      collection(db, "products"),
      where("isActive", "==", true),
      orderBy("createdAt", "desc"),
    );

    const snap = await getDocs(q);
    productCache = [];

    snap.forEach((doc) => {
      const product = { id: doc.id, ...doc.data() };
      // Validate product
      if (
        product.id &&
        product.name &&
        Array.isArray(product.images) &&
        product.images.length
      ) {
        productCache.push(product);
      }
    });

    cacheTimestamp = now;
    return productCache;
  } catch (error) {
    console.error("Error fetching products for search:", error);
    return [];
  }
}

// ================= SEARCH PRODUCTS =================
export function searchProducts(query, maxResults = 10) {
  if (!productCache || productCache.length === 0) {
    return [];
  }

  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];

  // Search in name, brand, and description
  const matches = productCache.filter((product) => {
    const name = (product.name || "").toLowerCase();
    const brand = (product.brand || "").toLowerCase();
    const description = (product.description || "").toLowerCase();
    const category = (product.category || "").toLowerCase();

    return (
      name.includes(q) ||
      brand.includes(q) ||
      description.includes(q) ||
      category.includes(q)
    );
  });

  // Sort by relevance: startsWith name is best, then contains in name, then other fields
  matches.sort((a, b) => {
    const an = (a.name || "").toLowerCase();
    const bn = (b.name || "").toLowerCase();

    const aStartsWith = an.startsWith(q) ? 0 : 1;
    const bStartsWith = bn.startsWith(q) ? 0 : 1;

    if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith;

    const aIndex = an.indexOf(q);
    const bIndex = bn.indexOf(q);

    return aIndex - bIndex;
  });

  return matches.slice(0, maxResults);
}

// ================= FORMAT PRODUCT FOR DISPLAY =================
export function formatProductPreview(product) {
  return {
    id: product.id,
    name: product.name || "",
    brand: product.brand || "",
    price: product.price || 0,
    oldPrice: product.oldPrice || null,
    image: (product.images && product.images[0]) || "img/placeholder.png",
    rating: product.rating || 0,
    description: product.description || "",
  };
}

// ================= CLEAR CACHE =================
export function clearSearchCache() {
  productCache = null;
  cacheTimestamp = 0;
}

// ================= ESCAPE REGEX =================
export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ================= HIGHLIGHT TEXT =================
export function highlightText(text, query) {
  const escaped = escapeRegExp(query);
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.replace(regex, "<mark>$1</mark>");
}

// ================= DEBOUNCE UTILITY =================
export function debounce(fn, wait = 200) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), wait);
  };
}
