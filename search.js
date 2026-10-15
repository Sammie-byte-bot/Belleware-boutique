// ================= FIREBASE IMPORTS =================
import { db, collection, getDocs, query, where, orderBy } from "./firebase.js";

// ================= CACHE =================
let productCache = null;
let cacheTimestamp = 0;
let productRequest = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// ================= FETCH ALL PRODUCTS =================
export async function fetchAllProducts() {
  const now = Date.now();

  // Return cached data if still fresh
  if (productCache && now - cacheTimestamp < CACHE_DURATION) {
    return productCache;
  }

  if (productRequest) return productRequest;

  productRequest = (async () => {
    try {
      const activeQuery = query(
        collection(db, "products"),
        where("isActive", "==", true),
        orderBy("createdAt", "desc"),
      );

      let snap;
      try {
        snap = await getDocs(activeQuery);
      } catch (error) {
        console.warn(
          "Active products search failed, falling back to all products:",
          error,
        );
      }

      if (!snap || snap.empty) {
        snap = await getDocs(
          query(collection(db, "products"), orderBy("createdAt", "desc")),
        );
      }

      productCache = snap.docs
        .map((productDoc) => ({
          id: productDoc.id,
          ...productDoc.data(),
        }))
        .filter((product) => product.id && product.name);

      cacheTimestamp = Date.now();
      return productCache;
    } catch (error) {
      console.error("Error fetching products for search:", error);
      productCache = null;
      throw error;
    } finally {
      productRequest = null;
    }
  })();

  return productRequest;
}

// ================= SEARCH PRODUCTS =================
export function searchProducts(query, maxResults = 10) {
  if (!productCache) {
    return [];
  }

  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const matches = productCache
    .map((product) => {
      const name = (product.name || "").toLowerCase();
      const brand = (product.brand || "").toLowerCase();
      const description = (product.description || "").toLowerCase();
      const category = (product.category || "").toLowerCase();
      const searchableText = `${name} ${brand} ${description} ${category}`;
      const allTermsMatch = terms.every((term) =>
        searchableText.includes(term),
      );
      if (!allTermsMatch) return null;

      const score = terms.reduce((total, term) => {
        if (name.startsWith(term)) return total + 4;
        if (name.includes(term)) return total + 3;
        if (brand.includes(term) || category.includes(term))
          return total + 2;
        return total + 1;
      }, 0);

      return { product, score };
    })
    .filter(Boolean);

  matches.sort((a, b) => b.score - a.score);

  return matches.slice(0, maxResults).map(({ product }) => product);
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
