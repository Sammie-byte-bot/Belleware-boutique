import "./firebase.js";
import { initReviews } from "./reviews.js";
import {
  fetchAllProducts,
  searchProducts,
  formatProductPreview,
  highlightText,
  debounce as searchDebounce,
  escapeRegExp,
} from "./search.js";

document.addEventListener("DOMContentLoaded", () => {
  const header = document.getElementById("header");
  function setHeaderVar() {
    if (!header) return;
    const h = header.offsetHeight || 0;
    document.documentElement.style.setProperty("--header-height", `${h}px`);
  }
  setHeaderVar();
  let rh;
  window.addEventListener("resize", () => {
    if (rh) cancelAnimationFrame(rh);
    rh = requestAnimationFrame(setHeaderVar);
  });
  if (header) {
    const mo = new MutationObserver(() => {
      if (rh) cancelAnimationFrame(rh);
      rh = requestAnimationFrame(setHeaderVar);
    });
    mo.observe(header, { childList: true, subtree: true, attributes: true });
    window.addEventListener("load", setHeaderVar, { once: true });
  }

  const productEl = document.getElementById("product");
  if (!productEl) return;

  const productId = productEl.dataset.productId;
  initReviews(productId);
});

// =======================
// FIREBASE IMPORTS
// =======================
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
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

let currentUser = null;
let userFirstName = null;

// =======================
// UNIVERSAL HELPERS
// =======================
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 150);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 2300);
  }, 2500);
}

function showLoader(message = "Please wait...") {
  const loader = document.createElement("div");
  loader.className = "loader-overlay";
  loader.innerHTML = `
    <div class="loader-content">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
  document.body.appendChild(loader);
}

function hideLoader() {
  const loader = document.querySelector(".loader-overlay");
  if (loader) loader.remove();
}

// =======================
// CART & WISHLIST KEYS
// =======================
function getCartKey() {
  return currentUser ? `cart_${currentUser.uid}` : "cart_guest";
}

function getWishlistKey() {
  return currentUser ? `wishlist_${currentUser.uid}` : "wishlist_guest";
}

// =======================
// CART & WISHLIST STATE
// =======================
let cart = [];
let wishlist = [];
const deliveryFee = 150;

// Expose functions globally for use across all pages
window.getCart = function () {
  const key = getCartKey();
  const stored = localStorage.getItem(key);
  return JSON.parse(stored) || [];
};

window.saveCart = function (cartData) {
  if (cartData !== undefined) {
    cart = cartData;
  }
  localStorage.setItem(getCartKey(), JSON.stringify(cart));
  updateCartCount();
};

// Expose addToCart globally for product.js
window.addToCartGlobal = function (item) {
  // 🔥 BULLETPROOF: Handle null/undefined items
  if (!item) {
    console.error("Null cart item");
    return false;
  }
  item.id =
    item.id ||
    "temp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  if (!item.name) item.name = "Product";

  let cart = getCart();

  const existing = cart.find(
    (p) => p.id === item.id && p.size === item.size && p.color === item.color,
  );

  if (existing) {
    existing.quantity =
      (Number(existing.quantity) || 0) + (Number(item.quantity) || 1);
  } else {
    cart.push({
      id: item.id,
      name: item.name || "Unnamed Product",
      price: Number(item.price) || 0,
      img: item.img || "",
      size: item.size || "",
      color: item.color || "",
      quantity: Number(item.quantity) || 1,
    });
  }

  saveCart(cart);
  return true;
};

// Expose removeFromCart globally
window.removeFromCartGlobal = function (id, size, color) {
  let cart = getCart();
  cart = cart.filter(
    (item) => !(item.id === id && item.size === size && item.color === color),
  );
  saveCart(cart);
};

// Expose updateCartCount globally
window.updateCartCountGlobal = function () {
  updateCartCount();
};

// Expose showToast globally
window.showToastGlobal = function (message) {
  showToast(message);
};

// Alias for backward compatibility
window.addToCart = window.addToCartGlobal;

function saveWishlist() {
  localStorage.setItem(getWishlistKey(), JSON.stringify(wishlist));
}

function loadWishlist() {
  const key = getWishlistKey();
  const stored = localStorage.getItem(key);
  if (!stored) {
    // Try legacy key
    const legacy = localStorage.getItem("wishlist");
    if (legacy) {
      try {
        localStorage.setItem(key, legacy);
        localStorage.removeItem("wishlist");
      } catch (e) {}
    }
  }
  wishlist = JSON.parse(stored || localStorage.getItem(key) || "[]");
  renderWishlist();
  updateWishlistIcons();
}

function renderWishlist() {
  // Check if we're on wishlist page (cart.html has wishlist-page section)
  const container = document.querySelector(".wishlist-items-container");
  if (!container) return;

  container.innerHTML = "";

  if (wishlist.length === 0) {
    container.innerHTML = `
      <div class="empty-wishlist">
        <i class="fas fa-heart" style="font-size: 48px; color: #ccc; margin-bottom: 20px;"></i>
        <p>Your wishlist is empty</p>
        <a href="shop.html" class="continue-shopping">Browse Products</a>
      </div>
    `;
    return;
  }

  wishlist.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "wishlist-item";
    const price = item.price ?? 0;
    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}" class="wishlist-item-img"/>
      <div class="wishlist-item-info">
        <p class="wishlist-item-name">${item.name}</p>
        <p class="wishlist-item-price">Ksh ${price.toLocaleString()}</p>
      </div>
      <div class="wishlist-item-actions">
        <button class="add-cart" data-index="${index}" title="Add to Cart">
          <i class="fas fa-shopping-cart"></i> Add to Cart
        </button>
        <button class="remove-wishlist" data-index="${index}" title="Remove">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });
}

function updateWishlistIcons() {
  document.querySelectorAll(".wishlist").forEach((icon) => {
    const name = icon.dataset.name;
    if (!name) return;
    const inList = wishlist.some((it) => it.name === name);
    icon.classList.remove("fas", "far", "active");
    if (inList) {
      icon.classList.add("fas", "active");
    } else {
      icon.classList.add("far");
    }
  });
}

function loadCart() {
  const key = getCartKey();
  console.log("🛒 Loading cart from key:", key); // 🔍 DEBUG

  let stored = localStorage.getItem(key);

  // 🔥 BULLETPROOF MIGRATION - Clear ALL old keys
  const oldKeys = ["cart", "cart_guest", "wishlist"];
  oldKeys.forEach((oldKey) => {
    const legacy = localStorage.getItem(oldKey);
    if (legacy && localStorage.getItem(key) !== legacy) {
      console.log(`📦 Migrated ${oldKey} → ${key}`);
      localStorage.setItem(key, legacy);
      localStorage.removeItem(oldKey);
      stored = legacy;
    }
  });

  // Migrate old username-based keys
  if (!stored && currentUser) {
    const oldName = (currentUser.displayName || currentUser.email || "").slice(
      0,
      12,
    );
    const oldKey = `cart_${oldName}`;
    const oldStored = localStorage.getItem(oldKey);
    if (oldStored) {
      console.log(`📦 Migrated old user cart ${oldKey} → ${key}`);
      localStorage.setItem(key, oldStored);
      localStorage.removeItem(oldKey);
      stored = oldStored;
    }
  }

  cart = JSON.parse(stored) || [];
  console.log("🛒 Cart loaded:", cart.length, "items");

  renderCart();
  updateCartCount();
}

// ======================================================
// GLOBAL STATE
// ======================================================

window.currentUser = null;

// ======================================================
// CART STORAGE HELPERS
// ======================================================

// ======================================================
// CART COUNT UI
// ======================================================

function updateCartCount(cart = getCart()) {
  const cartCountEl = document.querySelector(".cart-count");
  if (!cartCountEl) return;

  const total = cart.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0,
  );

  cartCountEl.textContent = total;
}

// ======================================================
// ADD TO CART (BULLETPROOF)
// ======================================================

function addToCart(item) {
  if (!item || !item.id) {
    console.error("Invalid cart item:", item);
    return;
  }

  let cart = getCart();

  const existing = cart.find(
    (p) => p.id === item.id && p.size === item.size && p.color === item.color,
  );

  if (existing) {
    existing.quantity =
      (Number(existing.quantity) || 0) + (Number(item.quantity) || 1);
  } else {
    cart.push({
      id: item.id,
      name: item.name || "Unnamed Product",
      price: Number(item.price) || 0,
      img: item.img || "",
      size: item.size || "",
      color: item.color || "",
      quantity: Number(item.quantity) || 1,
    });
  }

  saveCart(cart);

  console.log("Cart Updated:", cart);
}

// ======================================================
// REMOVE FROM CART
// ======================================================

function removeFromCart(id, size, color) {
  let cart = getCart();

  cart = cart.filter(
    (item) => !(item.id === id && item.size === size && item.color === color),
  );

  saveCart(cart);
}

// ======================================================
// UPDATE ITEM QUANTITY
// ======================================================

function updateItemQuantity(id, size, color, newQty) {
  let cart = getCart();

  const item = cart.find(
    (p) => p.id === id && p.size === size && p.color === color,
  );

  if (!item) return;

  item.quantity = Math.max(1, Number(newQty) || 1);

  saveCart(cart);
}

// ======================================================
// CLEAR CART
// ======================================================

function clearCart() {
  saveCart([]);
}

// ======================================================
// CART PAGE RENDER - Improved with full styling
// ======================================================

function renderCart() {
  const container = document.querySelector(".cart-items-container");
  if (!container) return;

  const cart = getCart();

  // Get elements for totals
  const cartCountText = document.getElementById("cart-count-text");
  const subtotalEl = document.getElementById("subtotal");
  const grandTotalEl = document.getElementById("grand-total");

  container.innerHTML = "";

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="empty-cart">
        <i class="fas fa-shopping-cart" style="font-size: 48px; color: #ccc; margin-bottom: 20px;"></i>
        <p>Your cart is empty</p>
        <a href="shop.html" class="continue-shopping">Continue Shopping</a>
      </div>
    `;
    updateCartTotals(0, 0, 0);
    return;
  }

  let totalAmount = 0;
  let totalItems = 0;

  cart.forEach((item, index) => {
    totalAmount += item.price * item.quantity;
    totalItems += item.quantity;

    const div = document.createElement("div");
    div.className = "cart-item";
    div.dataset.index = index;

    // Build variants HTML - text only, each on own row
    let variantsHtml = "";
    if (item.size) {
      variantsHtml += `<div class="variant-row"><span class="variant-label">Size:</span> <span class="variant-value">${item.size}</span></div>`;
    }
    if (item.color) {
      variantsHtml += `<div class="variant-row"><span class="variant-label">Color:</span> <span class="variant-value">${item.color}</span></div>`;
    }

    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}" class="cart-item-img"/>
      <div class="cart-item-info">
        <p class="cart-item-name">${item.name}</p>
        <div class="cart-item-variants">${variantsHtml}</div>
        <p class="cart-item-price">Ksh ${item.price.toLocaleString()}</p>
      </div>
      <div class="cart-item-middle">
        <div class="cart-quantity-container">
          <button class="qty-btn minus" data-index="${index}">
            <i class="fas fa-minus"></i>
          </button>
          <input type="number" min="1" value="${item.quantity}" 
            class="qty-input" data-index="${index}"/>
          <button class="qty-btn plus" data-index="${index}">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      </div>
      <div class="cart-item-actions">
        <p class="cart-item-total">Ksh ${(item.price * item.quantity).toLocaleString()}</p>
        <button class="remove-item" data-index="${index}" title="Remove item">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    `;

    container.appendChild(div);
  });

  // Update totals
  const deliveryFee = 150;
  const grandTotal = totalAmount + deliveryFee;
  updateCartTotals(totalItems, totalAmount, grandTotal);
}

function updateCartTotals(items, subtotal, total) {
  const cartCountText = document.getElementById("cart-count-text");
  const subtotalEl = document.getElementById("subtotal");
  const grandTotalEl = document.getElementById("grand-total");

  if (cartCountText) cartCountText.textContent = items;
  if (subtotalEl) subtotalEl.textContent = subtotal.toLocaleString();
  if (grandTotalEl) grandTotalEl.textContent = total.toLocaleString();
}

// ======================================================
// INIT
// ======================================================

// 🛑 REMOVED: Double cart init causing reset bug
// Cart now ONLY loads ONCE in auth listener

function addToWishlist(item) {
  if (!wishlist.find((i) => i.name === item.name)) {
    wishlist.push(item);
    saveWishlist();
    renderWishlist();
    showToast(`${item.name} added to wishlist`);
    if (typeof updateWishlistIcons === "function") updateWishlistIcons();
  } else showToast(`${item.name} already in wishlist`);
}

// =======================
// SYNC CART ACROSS TABS
// =======================
window.addEventListener("storage", (e) => {
  if (e.key === getCartKey()) {
    cart = JSON.parse(e.newValue) || [];
    updateCartCount();
  }
});

// =======================
// PROFILE DROPDOWN
// =======================
window.renderProfileDropdown = function () {
  const profileGreeting = document.getElementById("profileGreeting");
  const profileUserName = document.getElementById("profileUserName");
  const profileActions = document.getElementById("profileActions");
  const userNameEl = document.getElementById("userName");
  const mobileGreeting = document.getElementById("mobileGreeting");

  if (!profileGreeting && !profileActions && !userNameEl && !mobileGreeting)
    return;

  if (currentUser && mobileGreeting) {
    const displayName =
      userFirstName || currentUser.displayName || currentUser.email;
    mobileGreeting.textContent = `👤 Hello, ${displayName}`;
  }

  if (currentUser) {
    const displayName = currentUser.displayName || currentUser.email;
    if (profileGreeting) profileGreeting.textContent = `Hello, ${displayName}`;
    if (profileUserName) profileUserName.textContent = currentUser.email || "";
    if (userNameEl) userNameEl.textContent = displayName;
    if (profileActions) {
      profileActions.innerHTML = `
        <a href="account.html"><i class="fas fa-users-gear"></i> My Account</a>
        <a href="#" id="ordersLink"><i class="fas fa-box"></i> Orders</a>
        <a href="#" id="wishlistLink"><i class="fas fa-heart"></i> Wishlist</a>
        <a href="#" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Logout</a>
      `;

      document.getElementById("ordersLink")?.addEventListener("click", (e) => {
        e.preventDefault();
        if (currentUser) {
          window.location.href = "orders.html"; // Assume orders.html exists
        } else {
          window.location.href = "auth.html";
        }
      });

      document
        .getElementById("wishlistLink")
        ?.addEventListener("click", (e) => {
          e.preventDefault();
          if (currentUser) {
            window.location.href = "wishlist.html"; // Assume wishlist.html exists
          } else {
            window.location.href = "auth.html";
          }
        });

      document
        .getElementById("logoutBtn")
        ?.addEventListener("click", async (e) => {
          e.preventDefault();
          const btn = e.currentTarget;
          const drop =
            btn.closest(".profile-dropdown") ||
            document.querySelector(".profile-dropdown");
          // small animation to indicate action
          if (drop) drop.classList.add("logout-anim");
          try {
            await signOut(auth);
            showToast("Logout successful");
            if (drop) drop.classList.remove("logout-anim");
          } catch (error) {
            showToast("Logout failed: " + error.message);
            if (drop) drop.classList.remove("logout-anim");
          }
        });
    }
  } else {
    if (profileGreeting) profileGreeting.textContent = "Hello, Guest";
    if (profileUserName) profileUserName.textContent = "";
    if (userNameEl) userNameEl.textContent = "Guest"; // default when not signed in
    if (mobileGreeting) mobileGreeting.textContent = "👤 Hello, Guest";
    if (profileActions) {
      profileActions.innerHTML = `
        <a href="auth.html"><i class="fas fa-sign-in-alt"></i> Sign In</a>
      `;
    }
  }
};

// =======================
// POPULATE MOBILE CATEGORIES
// =======================
async function populateMobileCategories() {
  const mobileCategoriesEl = document.getElementById("mobileCategories");
  if (!mobileCategoriesEl) return;

  try {
    const q = query(collection(db, "products"), where("isActive", "==", true));
    const snap = await getDocs(q);
    const categories = [
      ...new Set(snap.docs.map((doc) => doc.data().category).filter(Boolean)),
    ].sort();

    mobileCategoriesEl.innerHTML = "";
    categories.forEach((cat) => {
      const li = document.createElement("li");
      li.innerHTML = `<a href="shop.html?category=${encodeURIComponent(cat)}">${cat} <span>›</span></a>`;
      mobileCategoriesEl.appendChild(li);
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    // Fallback to static categories
    const fallbackCategories = [
      { name: "Jeans", icon: "👖" },
      { name: "Shoes", icon: "👟" },
      { name: "T-Shirts", icon: "👕" },
      { name: "Watches", icon: "⌚" },
    ];
    mobileCategoriesEl.innerHTML = "";
    fallbackCategories.forEach((cat) => {
      const li = document.createElement("li");
      li.innerHTML = `<a href="shop.html?category=${encodeURIComponent(cat.name)}">${cat.icon} ${cat.name} <span>›</span></a>`;
      mobileCategoriesEl.appendChild(li);
    });
  }
}

// =======================
// AUTH STATE LISTENER
// =======================
let cartInitialized = false; // 🛡️ Prevent double init

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  window.currentUser = user;

  if (user) {
    try {
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        userFirstName = data.fullName
          ? data.fullName.split(" ")[0]
          : user.displayName || user.email;
      } else {
        userFirstName = user.displayName || user.email;
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
      userFirstName = user.displayName || user.email;
    }
  } else {
    userFirstName = null;
  }

  window.renderProfileDropdown();

  // 🔥 SINGLE CART INIT - No more double load/reset bug
  if (!cartInitialized) {
    console.log("🔄 Initializing cart/wishlist...");
    loadCart();
    loadWishlist();
    cartInitialized = true;
  }

  updateCartCount(); // Always update count (safe)
});

// =======================
// INITIALIZATION
// =======================
document.addEventListener("DOMContentLoaded", () => {
  // Review modal close handler - removes carousel blur
  document.addEventListener(
    "click",
    (e) => {
      if (e.target.id === "closeReviewModalECT" || e.target.closest(".modal")) {
        const blurTarget = document.getElementById("carouselBlurTarget");
        const overlay = document.getElementById("reviewOverlay");
        blurTarget?.classList.remove("blurred");
        overlay?.classList.add("hidden");
      }
    },
    { once: false },
  );
  loadCart();
  loadWishlist();

  // Ensure wishlist icons reflect stored state
  function updateWishlistIcons() {
    document.querySelectorAll(".pro .wishlist").forEach((icon) => {
      const name = icon.dataset.name;
      const inList = wishlist.some((it) => it.name === name);
      // ensure icon uses regular (outline) when not in wishlist, solid when in wishlist
      icon.classList.remove("fas", "far", "active");
      if (inList) {
        icon.classList.add("fas", "active");
      } else {
        icon.classList.add("far");
      }
    });
  }
  // sync UI once at load
  updateWishlistIcons();

  // Populate mobile categories
  populateMobileCategories();

  // for highlighting matches

  // Make product cards on home page (#product1) clickable (except wishlist/cart/links)
  document.querySelectorAll("#product1 .pro").forEach((p) => {
    p.addEventListener("click", (e) => {
      if (e.target.closest(".wishlist") || e.target.closest("a")) return;
      const img =
        p.querySelector(".img-wrapper img")?.getAttribute("src") || "";
      const id = img.split("/").pop().split(".")[0];
      if (id)
        window.location.href = `product.html?id=${encodeURIComponent(id)}`;
    });
  });

  // --- Add shop-like price metadata under product descriptions on any page ---
  function formatPrice(n) {
    return "Ksh " + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function computeOldAndDiscount(price) {
    const pct = price > 1000 ? 0.18 : 0.15;
    const old = Math.round(price * (1 + pct));
    const discount = Math.round((1 - price / old) * 100);
    return { old, discount };
  }
  function enhanceProductCards() {
    const cards = document.querySelectorAll("#product1 .pro");
    cards.forEach((card) => {
      const des = card.querySelector(".des");
      if (!des) return;
      if (des.querySelector(".price-row")) return; // already enhanced
      const priceEl = des.querySelector("h4");
      let priceVal = NaN;
      if (priceEl) {
        const txt = priceEl.textContent.trim();
        const num = txt.replace(/[^\d]/g, "");
        priceVal = num ? Number(num) : NaN;
      }

      const priceRow = document.createElement("div");
      priceRow.className = "price-row";

      const currentSpan = document.createElement("span");
      currentSpan.className = "current-price";
      currentSpan.textContent = isNaN(priceVal)
        ? priceEl
          ? priceEl.textContent
          : ""
        : formatPrice(priceVal);

      const oldSpan = document.createElement("span");
      oldSpan.className = "old-price";
      const discSpan = document.createElement("span");
      discSpan.className = "discount-badge";

      if (!isNaN(priceVal)) {
        const { old, discount } = computeOldAndDiscount(priceVal);
        oldSpan.textContent = formatPrice(old);
        discSpan.textContent = `-${discount}%`;
      } else {
        oldSpan.textContent = "";
        discSpan.textContent = "";
      }

      const meta = document.createElement("div");
      meta.className = "price-meta";
      meta.appendChild(oldSpan);
      meta.appendChild(discSpan);

      priceRow.appendChild(currentSpan);
      priceRow.appendChild(meta);

      if (priceEl) priceEl.replaceWith(priceRow);
      else des.appendChild(priceRow);
    });
  }
  // run once on load
  enhanceProductCards();
  // observe for future DOM changes and re-run
  const productsRoot = document.querySelector("#product1");
  if (productsRoot) {
    const mo = new MutationObserver(() => enhanceProductCards());
    mo.observe(productsRoot, { childList: true, subtree: true });
  }

  // Profile dropdown toggle
  const profileLink =
    document.querySelector(".profile-link") ||
    document.querySelector("#profileBtn");
  const dropdownMenu = document.querySelector(".profile-dropdown");
  if (profileLink && dropdownMenu) {
    profileLink.addEventListener("click", (e) => {
      e.preventDefault();
      dropdownMenu.classList.toggle("active");
    });
    document.addEventListener("click", (e) => {
      if (!profileLink.contains(e.target) && !dropdownMenu.contains(e.target))
        dropdownMenu.classList.remove("active");
    });
  }

  // Global sign-out handler (for side menu sign out with id="signOut")
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest && e.target.closest("#signOut");
    if (!btn) return;
    e.preventDefault();
    try {
      await signOut(auth);
      showToast("Logout successful");
      // redirect to homepage after logout
      window.location.href = "index.html";
    } catch (err) {
      showToast("Logout failed: " + err.message);
    }
  });

  // ---------------------------
  // Global header search (opens overlay, navigates to shop with query)
  // ---------------------------
  const searchIcon = document.querySelector(".search");
  const searchOverlay = document.querySelector(".search-overlay");
  const searchInput =
    document.getElementById("searchInput") ||
    document.getElementById("searchInputOverlay");
  const searchButton =
    document.getElementById("searchBtn") ||
    document.getElementById("searchButton") ||
    document.getElementById("searchButtonOverlay");
  const closeSearch = document.getElementById("closeSearch");

  function openSearchOverlay() {
    if (!searchOverlay) return;
    searchOverlay.classList.add("active");
    setTimeout(() => searchInput?.focus(), 60);
  }

  function closeSearchOverlay() {
    if (!searchOverlay) return;
    searchOverlay.classList.remove("active");
  }

  searchIcon?.addEventListener("click", (e) => {
    e.preventDefault();
    openSearchOverlay();
  });

  // Search overlay is opened by dedicated icon (if present). Header button submits.

  closeSearch?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSearchOverlay();
  });

  // Submit search: when clicking the search button inside overlay or pressing Enter
  function submitHeaderSearch() {
    const q = (
      document.getElementById("searchInputOverlay")?.value ||
      searchInput?.value ||
      ""
    ).trim();
    if (!q) return showToast("Please type a product name");

    const isShop = window.location.pathname.endsWith("shop.html");
    if (isShop) {
      const newUrl = `shop.html?q=${encodeURIComponent(q)}`;
      history.replaceState(null, "", newUrl);
      window.dispatchEvent(new CustomEvent("shop:search", { detail: { q } }));
      closeSearchOverlay();
    } else {
      const shopUrl = `shop.html?q=${encodeURIComponent(q)}`;
      window.location.href = shopUrl;
    }
  }

  searchButton?.addEventListener("click", (e) => {
    e.preventDefault();
    submitHeaderSearch();
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitHeaderSearch();
    }
  });
  document
    .getElementById("searchInputOverlay")
    ?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitHeaderSearch();
      }
    });
  // Fallback delegated handler to ensure search buttons always work
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(
      "#searchBtn, #searchButton, #searchButtonOverlay",
    );
    if (!btn) return;
    e.preventDefault();
    submitHeaderSearch();
  });

  // ---------------------------
  // Enhanced Firebase-based live search with previews
  // ---------------------------
  let suggestIndex = -1;
  function getResultsEl() {
    const overlayBox = document.querySelector(
      ".search-overlay.active .search-results",
    );
    if (overlayBox) return overlayBox;
    let dd = document.querySelector(".search-suggestions-dropdown");
    if (!dd) {
      dd = document.createElement("div");
      dd.className = "search-suggestions-dropdown";
      document.body.appendChild(dd);
    }
    positionDropdown(dd);
    dd.classList.add("show");
    return dd;
  }

  function positionDropdown(dd) {
    try {
      const wrapper =
        document.querySelector(".search-input-wrapper") ||
        document.getElementById("searchInput")?.parentElement ||
        document.querySelector(".search-container");
      if (!wrapper || !dd) return;
      const rect = wrapper.getBoundingClientRect();
      const isMobile = window.innerWidth <= 768;
      let width = rect.width;
      let left = rect.left + window.scrollX;
      if (isMobile) {
        const maxWidth = Math.max(
          200,
          Math.min(window.innerWidth - 16, rect.width + 47),
        );
        const extra = maxWidth - rect.width;
        width = maxWidth;
        left = Math.max(8, left - extra / 2);
        const right = left + width;
        if (right > window.innerWidth - 8) {
          left = window.innerWidth - 8 - width;
        }
      }
      dd.style.left = `${left}px`;
      dd.style.top = `${rect.bottom + window.scrollY}px`;
      dd.style.width = `${width}px`;
    } catch {}
  }

  window.addEventListener("scroll", () => {
    const dd = document.querySelector(".search-suggestions-dropdown");
    if (dd) positionDropdown(dd);
  });
  window.addEventListener("resize", () => {
    const dd = document.querySelector(".search-suggestions-dropdown");
    if (dd) positionDropdown(dd);
  });

  // Pinpoint accuracy ranking similar to Jumia
  function normalizeText(s) {
    return (s || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }
  function scoreProduct(product, qNorm) {
    const name = normalizeText(product.name);
    const brand = normalizeText(product.brand);
    const category = normalizeText(product.category);
    const tokens = name.split(/\s+/);
    let score = 0;
    // Exact phrase
    if (name.includes(qNorm)) score += 6;
    // Starts-with on whole name
    if (name.startsWith(qNorm)) score += 6;
    // Token starts-with boosts
    tokens.forEach((t) => {
      if (t.startsWith(qNorm)) score += 3;
      else if (t.includes(qNorm)) score += 1;
    });
    // Brand/category boosts
    if (brand) {
      if (brand.startsWith(qNorm)) score += 4;
      else if (brand.includes(qNorm)) score += 2;
    }
    if (category) {
      if (category.startsWith(qNorm)) score += 2;
      else if (category.includes(qNorm)) score += 1;
    }
    // Optional popularity tie-breakers
    const rating = Number(product.rating) || 0;
    score += Math.min(5, rating); // small bias
    return score;
  }
  function localSearchRank(allProducts, q, limit = 10) {
    const qNorm = normalizeText(q);
    const scored = allProducts
      .map((p) => ({ p, s: scoreProduct(p, qNorm) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map((x) => x.p);
  }

  // Initialize product cache on page load
  fetchAllProducts();

  function renderSuggestions(items, q) {
    const resultsEl = getResultsEl();
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    suggestIndex = -1;

    if (!items.length) {
      resultsEl.innerHTML = `
        <div class="no-suggest">
          <i class="fas fa-search" style="color: #ccc; font-size: 24px; margin-bottom: 8px; display: block;"></i>
          No products found for "${escapeRegExp(q)}"
        </div>
      `;
      return;
    }

    // Add header with count
    const header = document.createElement("div");
    header.className = "search-results-header";
    header.innerHTML = `
      <span>Search Results</span>
      <span class="search-results-count">${items.length} found</span>
    `;
    resultsEl.appendChild(header);

    const frag = document.createDocumentFragment();
    const re = new RegExp("(" + escapeRegExp(q) + ")", "ig");

    items.forEach((product, idx) => {
      const preview = formatProductPreview(product);

      const div = document.createElement("div");
      div.className = "result-item";
      div.tabIndex = 0;
      div.dataset.productId = product.id;

      const img = document.createElement("img");
      img.src = preview.image;
      img.alt = preview.name;

      const meta = document.createElement("div");
      meta.className = "meta";

      const name = document.createElement("div");
      name.className = "name";
      name.innerHTML = highlightText(preview.name, q);

      const brand = document.createElement("div");
      brand.className = "brand";
      brand.textContent = preview.brand || "Product";

      const price = document.createElement("div");
      price.className = "price";
      const priceText =
        preview.oldPrice && preview.oldPrice > preview.price
          ? `Ksh ${preview.price.toLocaleString()}`
          : `Ksh ${preview.price.toLocaleString()}`;
      price.textContent = priceText;

      meta.appendChild(name);
      meta.appendChild(brand);
      meta.appendChild(price);

      div.appendChild(img);
      div.appendChild(meta);

      div.addEventListener("click", () => selectSuggestion(product));
      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter") selectSuggestion(product);
      });

      frag.appendChild(div);
    });

    resultsEl.appendChild(frag);

    // Add "View All" button if more than 5 results
    if (items.length > 5) {
      const viewAll = document.createElement("div");
      viewAll.className = "search-view-all";
      viewAll.textContent = `View all ${items.length} results`;
      viewAll.addEventListener("click", () => {
        selectSuggestionByName(q);
      });
      resultsEl.appendChild(viewAll);
    }
  }

  function selectSuggestion(product) {
    if (!product || !product.id) return;
    window.location.href = `product.html?id=${product.id}`;
  }

  function selectSuggestionByName(q) {
    if (!q) return;
    if (window.location.pathname.endsWith("shop.html")) {
      history.replaceState(null, "", `shop.html?q=${encodeURIComponent(q)}`);
      window.dispatchEvent(new CustomEvent("shop:search", { detail: { q } }));
      closeSearchOverlay();
    } else {
      window.location.href = `shop.html?q=${encodeURIComponent(q)}`;
    }
  }

  const onInput = searchDebounce((e) => {
    const q = (e.target.value || "").trim();
    if (!q || q.length < 1) {
      const el = getResultsEl();
      if (el) el.innerHTML = "";
      return;
    }

    fetchAllProducts().then(() => {
      const matches = searchProducts(q, 10);
      renderSuggestions(matches, q);
    });
  }, 200);

  searchInput?.addEventListener("input", onInput);

  // Keyboard navigation for suggestions
  searchInput?.addEventListener("keydown", (e) => {
    const resultsEl = getResultsEl();
    if (!resultsEl) return;
    const items = Array.from(
      resultsEl.querySelectorAll(
        ".result-item:not(.no-suggest):not(.search-view-all)",
      ),
    );
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestIndex = Math.min(suggestIndex + 1, items.length - 1);
      items.forEach((i) => i.classList.remove("active"));
      items[suggestIndex].classList.add("active");
      items[suggestIndex].focus();
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestIndex = Math.max(suggestIndex - 1, 0);
      items.forEach((i) => i.classList.remove("active"));
      items[suggestIndex].classList.add("active");
      items[suggestIndex].focus();
    }

    if (e.key === "Enter" && suggestIndex >= 0) {
      e.preventDefault();
      const product = {
        id: items[suggestIndex].dataset.productId,
      };
      selectSuggestion(product);
    }
  });

  // Highlight matches on shop page titles
  let searchQuery = "";

  function highlightMatches() {
    const q = (searchQuery || "").trim();
    const productEls = document.querySelectorAll(".pro");
    const re = q ? new RegExp("(" + escapeRegExp(q) + ")", "ig") : null;
    productEls.forEach((p) => {
      const h = p.querySelector(".des h5");
      if (!h) return;
      if (!h.dataset.orig) h.dataset.orig = h.textContent;
      if (re && p.style.display !== "none") {
        h.innerHTML = h.dataset.orig.replace(
          re,
          '<mark class="product-mark">$1</mark>',
        );
      } else {
        h.innerHTML = h.dataset.orig;
      }
    });
  }

  // Mutation observer to re-run highlights after filters change
  const proGridEl =
    document.querySelector("#productsGrid") ||
    document.querySelector(".pro-container");
  if (proGridEl) {
    const mo = new MutationObserver(() => {
      setTimeout(() => highlightMatches(), 20);
    });
    mo.observe(proGridEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  // Close suggestions when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !e.target.closest(".search-box") &&
      !e.target.closest(".search-container") &&
      !e.target.closest(".search-suggestions-content") &&
      !e.target.closest(".search-suggestions-dropdown")
    ) {
      const overlayBox = document.querySelector(
        ".search-overlay.active .search-results",
      );
      if (overlayBox) {
        overlayBox.innerHTML = "";
        return;
      }
      const dd = document.querySelector(".search-suggestions-dropdown");
      if (dd) {
        dd.classList.remove("show");
        dd.innerHTML = "";
      }
    }
  });

  // Mobile menu
  const hamburger = document.querySelector("#hamburgerIcon");
  const nav = document.querySelector("#navbar");
  const overlay = document.querySelector("#overlay");
  if (hamburger && nav && overlay) {
    hamburger.addEventListener("click", () => {
      nav.classList.toggle("active");
      overlay.classList.toggle("active");
      hamburger.classList.toggle("fa-bars");
      hamburger.classList.toggle("fa-xmark");
    });
    overlay.addEventListener("click", () => {
      nav.classList.remove("active");
      overlay.classList.remove("active");
      hamburger.classList.remove("fa-xmark");
      hamburger.classList.add("fa-bars");
    });
  }

  // Side menu (for mobile categories)
  const menuBtn = document.getElementById("menuBtn");
  const closeMenuBtn = document.getElementById("closeMenu");
  const sideMenu = document.getElementById("sideMenu");
  if (menuBtn && closeMenuBtn && sideMenu && overlay) {
    menuBtn.addEventListener("click", () => {
      sideMenu.classList.add("is-active");
      overlay.classList.add("is-active");
    });
    closeMenuBtn.addEventListener("click", () => {
      sideMenu.classList.remove("is-active");
      overlay.classList.remove("is-active");
    });
    overlay.addEventListener("click", () => {
      sideMenu.classList.remove("is-active");
      overlay.classList.remove("is-active");
    });
  }

  // ---------------------------
  // Shop filters (Jumia-like)
  // ---------------------------
  function initShopFilters() {
    const productEls = Array.from(document.querySelectorAll(".pro"));
    if (!productEls.length) return;
    const proContainer = document.querySelector(".pro-container");
    const brandFiltersEl = document.getElementById("brandFilters");
    const brandSearch = document.getElementById("brandSearch");
    const priceRange = document.getElementById("priceRange");
    const priceVal = document.getElementById("priceVal");
    const sortSelect = document.getElementById("sortSelect");
    const clearBtn = document.getElementById("clearFilters");
    const showFiltersBtn = document.getElementById("showFilters");
    const filtersAside = document.querySelector(".filters");
    const applyBtn = document.getElementById("applyFilters");

    const brands = [
      ...new Set(productEls.map((p) => (p.getAttribute("brand") || "").trim())),
    ]
      .filter(Boolean)
      .sort();

    // compute counts per brand (total initially)
    const totalBrandCounts = productEls.reduce((acc, p) => {
      const b = (p.getAttribute("brand") || "").trim();
      if (!b) return acc;
      acc[b] = (acc[b] || 0) + 1;
      return acc;
    }, {});

    brands.forEach((brand) => {
      const label = document.createElement("label");
      label.className = "brand-item";
      label.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" name="brand" value="${brand}">
          <span class="brand-name">${brand}</span>
        </div>
        <span class="brand-count">${totalBrandCounts[brand] || 0}</span>
      `;
      brandFiltersEl.appendChild(label);
    });

    const prices = productEls.map((p) => {
      const priceText = p.querySelector(".des h4")?.textContent || "";
      return parseInt(priceText.replace(/[^\d]/g, "")) || 0;
    });
    const maxPrice = Math.max(...prices, 2000);
    if (priceRange) {
      priceRange.max = maxPrice;
      priceRange.value = maxPrice;
    }
    if (priceVal) priceVal.textContent = maxPrice;

    // Brand search
    brandSearch?.addEventListener("input", () => {
      const q = brandSearch.value.trim().toLowerCase();
      Array.from(brandFiltersEl.querySelectorAll(".brand-item")).forEach(
        (lab) => {
          const name = lab
            .querySelector(".brand-name")
            .textContent.toLowerCase();
          lab.style.display = name.includes(q) ? "flex" : "none";
        },
      );
    });

    if (priceRange)
      priceRange.addEventListener("input", () => {
        if (priceVal) priceVal.textContent = priceRange.value;
        filterProducts();
      });

    brandFiltersEl?.addEventListener("change", filterProducts);
    sortSelect?.addEventListener("change", () => {
      sortProducts();
    });
    clearBtn?.addEventListener("click", () => {
      document
        .querySelectorAll(".filters input[type=checkbox]")
        .forEach((cb) => (cb.checked = false));
      if (priceRange) {
        priceRange.value = maxPrice;
        if (priceVal) priceVal.textContent = maxPrice;
      }
      if (sortSelect) sortSelect.value = "";
      if (brandSearch) brandSearch.value = "";
      filterProducts();
    });

    applyBtn?.addEventListener("click", filterProducts);

    function updateBrandCounts() {
      const visibleCounts = {};
      productEls.forEach((p) => {
        if (p.style.display === "none") return;
        const b = (p.getAttribute("brand") || "").trim();
        if (!b) return;
        visibleCounts[b] = (visibleCounts[b] || 0) + 1;
      });
      Array.from(brandFiltersEl.querySelectorAll(".brand-item")).forEach(
        (lab) => {
          const name = lab.querySelector(".brand-name").textContent;
          const cnt = visibleCounts[name] || 0;
          const countEl = lab.querySelector(".brand-count");
          countEl.textContent = cnt;
          const checkbox = lab.querySelector("input[type=checkbox]");
          if (cnt === 0) {
            lab.classList.add("brand-zero");
            checkbox.disabled = true;
          } else {
            lab.classList.remove("brand-zero");
            checkbox.disabled = false;
          }
        },
      );
    }

    // read search query from URL (if any)
    const urlParams = new URLSearchParams(window.location.search);
    searchQuery = (urlParams.get("q") || "").trim().toLowerCase();

    function filterProducts() {
      const checkedBrands = Array.from(
        document.querySelectorAll("#brandFilters input[type=checkbox]:checked"),
      ).map((i) => i.value);
      const max = parseInt(priceRange?.value) || maxPrice;
      productEls.forEach((p) => {
        const price =
          parseInt(
            (p.querySelector(".des h4")?.textContent || "").replace(
              /[^\d]/g,
              "",
            ),
          ) || 0;
        const brand = (p.getAttribute("brand") || "").trim();
        const brandMatch =
          !checkedBrands.length || checkedBrands.includes(brand);
        const priceMatch = price <= max;

        // search match: check name and brand
        const name = (
          p.querySelector(".des h5")?.textContent || ""
        ).toLowerCase();
        const brandText = brand.toLowerCase();
        const searchMatch =
          !searchQuery ||
          name.includes(searchQuery) ||
          brandText.includes(searchQuery);

        p.style.display = brandMatch && priceMatch && searchMatch ? "" : "none";
      });
      updateBrandCounts();
      sortProducts();

      // Handle no-results UI
      const proGrid = document.querySelector("#productsGrid") || proContainer;
      const visible = Array.from(proGrid.querySelectorAll(".pro")).filter(
        (p) => p.style.display !== "none",
      );
      // Update summary with count
      updateSearchSummary(searchQuery, visible.length);
      let noEl = proGrid.querySelector(".no-results");
      if (visible.length === 0) {
        if (!noEl) {
          noEl = document.createElement("div");
          noEl.className = "no-results";
          noEl.innerHTML = `<div class="no-results-inner"><p>No items found${
            searchQuery ? ' for "' + searchQuery + '"' : ""
          }.</p><button id="clearAllFilters" class="normal">Clear filters</button></div>`;
          proGrid.appendChild(noEl);
          document
            .getElementById("clearAllFilters")
            ?.addEventListener("click", () => {
              document
                .querySelectorAll(".filters input[type=checkbox]")
                .forEach((cb) => (cb.checked = false));
              if (priceRange) {
                priceRange.value = maxPrice;
                if (priceVal) priceVal.textContent = maxPrice;
              }
              searchQuery = "";
              if (searchInput) searchInput.value = "";
              if (sortSelect) sortSelect.value = "";
              filterProducts();
            });
        } else {
          const p = noEl.querySelector("p");
          if (p)
            p.textContent = `No items found${
              searchQuery ? ' for "' + searchQuery + '"' : ""
            }.`;
        }
      } else {
        if (noEl) noEl.remove();
      }
    }
    function updateSearchSummary(q, count) {
      const header = document.querySelector("#page-header");
      if (!header) return;
      let summary = header.querySelector(".results-summary");
      if (!summary) {
        summary = document.createElement("div");
        summary.className = "results-summary";
        header.appendChild(summary);
      }
      const qText = (q || "").trim();
      // compute top brands among currently visible products
      const proGrid =
        document.querySelector("#productsGrid") ||
        document.querySelector(".pro-container") ||
        document;
      const visible = Array.from(proGrid.querySelectorAll(".pro")).filter(
        (p) => p.style.display !== "none",
      );
      const brandCounts = {};
      visible.forEach((p) => {
        let b =
          (p.getAttribute("brand") || "").trim() ||
          p.querySelector(".des span")?.textContent?.trim() ||
          "";
        if (!b) return;
        brandCounts[b] = (brandCounts[b] || 0) + 1;
      });
      const topBrands = Object.entries(brandCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name);
      const brandText = topBrands.length
        ? ` • Top brands: ${topBrands.join(", ")}`
        : "";
      summary.textContent = `${count} item${count === 1 ? "" : "s"} found${
        qText ? ' for "' + qText + '"' : ""
      }${brandText}`;
    }
    function sortProducts() {
      const val = sortSelect?.value;
      const visible = Array.from(document.querySelectorAll(".pro")).filter(
        (p) => p.style.display !== "none",
      );
      if (val === "price-asc" || val === "price-desc") {
        visible.sort((a, b) => {
          const pa =
            parseInt(
              a.querySelector(".des h4").textContent.replace(/[^\d]/g, ""),
            ) || 0;
          const pb =
            parseInt(
              b.querySelector(".des h4").textContent.replace(/[^\d]/g, ""),
            ) || 0;
          return val === "price-asc" ? pa - pb : pb - pa;
        });
      }
      visible.forEach((p) => proContainer.appendChild(p));
    }

    // initialize counts
    updateBrandCounts();

    // If there's a search query in the URL, prefill header search and run filter
    if (typeof searchQuery !== "undefined" && searchQuery) {
      if (searchInput) searchInput.value = decodeURIComponent(searchQuery);
      const pageHeader = document.querySelector("#page-header");
      if (pageHeader) {
        let existing = pageHeader.querySelector(".search-hint");
        if (!existing) {
          existing = document.createElement("div");
          existing.className = "search-hint";
          existing.style.marginTop = "10px";
          existing.style.fontSize = "14px";
          existing.style.color = "#333";
          pageHeader.appendChild(existing);
        }
        existing.textContent = `Showing results for "${searchQuery}"`;
      }
      filterProducts();
      document
        .querySelector("#productsGrid")
        ?.scrollIntoView({ behavior: "smooth" });
    }

    // Listen for search events (header search while on shop page)
    window.addEventListener("shop:search", (e) => {
      const q = (e.detail?.q || "").trim();
      searchQuery = q.toLowerCase();
      if (searchInput) searchInput.value = q;
      const pageHeader = document.querySelector("#page-header");
      if (pageHeader) {
        let existing = pageHeader.querySelector(".search-hint");
        if (!existing) {
          existing = document.createElement("div");
          existing.className = "search-hint";
          existing.style.marginTop = "10px";
          existing.style.fontSize = "14px";
          existing.style.color = "#333";
          pageHeader.appendChild(existing);
        }
        existing.textContent = `Showing results for "${q}"`;
      }
      filterProducts();
      document
        .querySelector("#productsGrid")
        ?.scrollIntoView({ behavior: "smooth" });
    });

    // Make sections collapsible and accessible
    document.querySelectorAll(".filter-section").forEach((section) => {
      // ensure there is a .filter-body (some sections already have it)
      const head = section.querySelector(".filter-head");
      const body = section.querySelector(".filter-body");
      if (!head || !body) return;
      const btn = head.querySelector(".toggle-section");
      if (!btn) return;

      // click handler
      btn.addEventListener("click", () => {
        const expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!expanded));
        section.classList.toggle("collapsed", expanded);
        const icon = btn.querySelector("i");
        if (icon) {
          icon.classList.toggle("fa-chevron-up", !expanded);
          icon.classList.toggle("fa-chevron-down", expanded);
        }
      });
    });

    // default: keep all filter sections expanded by default
    document.querySelectorAll(".filter-section").forEach((section) => {
      const btn = section.querySelector(".toggle-section");
      if (!btn) return;
      // ensure section is expanded
      section.classList.remove("collapsed");
      btn.setAttribute("aria-expanded", "true");
      const icon = btn.querySelector("i");
      if (icon) {
        icon.classList.remove("fa-chevron-down");
        icon.classList.add("fa-chevron-up");
      }
    });

    // keyboard accessibility: allow Enter/Space to toggle
    document.addEventListener("keydown", (e) => {
      if (
        (e.key === "Enter" || e.key === " ") &&
        document.activeElement?.classList?.contains("toggle-section")
      ) {
        e.preventDefault();
        document.activeElement.click();
      }
    });

    if (showFiltersBtn && filtersAside) {
      showFiltersBtn.addEventListener("click", () => {
        filtersAside.classList.toggle("active");
      });
      document.addEventListener("click", (e) => {
        if (
          !filtersAside.contains(e.target) &&
          !showFiltersBtn.contains(e.target)
        )
          filtersAside.classList.remove("active");
      });
    }
  }

  initShopFilters();

  // 🔥 FULLY FUNCTIONAL ADD TO CART & WISHLIST - Event Delegation
  document.body.addEventListener("click", (e) => {
    const target = e.target.closest("button, i, a"); // Target buttons/icons/links
    if (!target) return;

    // 🎯 ADD TO CART (.Cart buttons or .add-cart)
    if (
      target.classList.contains("Cart") ||
      target.closest(".Cart") ||
      target.classList.contains("add-cart")
    ) {
      e.preventDefault();
      e.stopPropagation();

      const btn = target.closest(".Cart, .add-cart");
      const productData = extractProductData(btn.closest(".pro"));

      if (!productData.id) {
        showToast("Product not found");
        return;
      }

      const success = window.addToCartGlobal(productData);
      if (success) {
        showToast(`${productData.name} added to cart! 🛒`);
        btn.style.animation = "pulse-cart 0.6s ease";
        setTimeout(() => (btn.style.animation = ""), 600);
      }
      return;
    }

    // ❤️ ADD/REMOVE WISHLIST (.wishlist icons)
    if (target.classList.contains("wishlist") || target.closest(".wishlist")) {
      e.preventDefault();
      e.stopPropagation();

      const icon = target.closest(".wishlist");
      const productData = extractProductData(icon.closest(".pro"));

      if (!productData.id) {
        showToast("Product not found");
        return;
      }

      // Toggle wishlist
      const wasInList = icon.classList.contains("active");
      if (wasInList) {
        wishlist = wishlist.filter((p) => p.id !== productData.id);
        showToast("Removed from wishlist ❤️");
      } else {
        wishlist.push(productData);
        showToast("Added to wishlist ❤️");
      }

      saveWishlist();
      updateWishlistIcons(); // Sync all icons
      icon.classList.toggle("active", !wasInList);
      icon.classList.toggle("far", wasInList);
      icon.classList.toggle("fas", !wasInList);

      // Pulse animation
      icon.style.transform = "scale(1.3)";
      setTimeout(() => (icon.style.transform = "scale(1)"), 200);
      return;
    }

    // ➕➖ CART QUANTITY (existing logic improved)
    if (
      target.classList.contains("qty-btn") ||
      target.classList.contains("plus") ||
      target.classList.contains("minus")
    ) {
      e.preventDefault();
      const btn = target.closest(".qty-btn");
      const container = btn.closest(".cart-quantity-container");
      const idx = parseInt(container.dataset.index);
      const input = container.querySelector("input[type='number']");

      let cart = getCart();
      if (!cart[idx]) return;

      const delta = btn.classList.contains("plus") ? 1 : -1;
      cart[idx].quantity = Math.max(1, cart[idx].quantity + delta);

      input.value = cart[idx].quantity;
      saveCart(cart);
      updateCartCount();
      showToast(`Quantity updated: ${cart[idx].quantity}`);
      renderCart(); // Re-render for totals
      return;
    }

    // 🗑️ REMOVE ITEM
    if (target.classList.contains("remove-item")) {
      e.preventDefault();
      const idx = parseInt(target.dataset.index);
      const removed = cart[idx].name;
      cart.splice(idx, 1);
      saveCart();
      renderCart();
      showToast(`${removed} removed 🗑️`);
      return;
    }

    // ✅ Existing handlers (wishlist page, checkout, etc.)
    // ... keep all previous logic for remove-wishlist, checkout-btn, etc.
    if (target.closest(".remove-wishlist")) {
      // ... existing code
    }

    if (target.closest(".checkout-btn")) {
      // ... existing code
    }
  });

  // 🔥 EXTRACT PRODUCT DATA FROM .pro CARD
  function extractProductData(proCard) {
    if (!proCard?.classList?.contains("pro")) return null;

    return {
      id:
        proCard.dataset.id ||
        proCard.querySelector("img")?.src?.split("/").pop()?.split(".")[0] ||
        Date.now(),
      name: proCard.querySelector(".des h5")?.textContent?.trim() || "Product",
      price:
        parseFloat(
          proCard
            .querySelector(".des h4, .current-price")
            ?.textContent?.replace(/[^\d.]/g, ""),
        ) || 0,
      img: proCard.querySelector("img")?.src || "",
      size: proCard.dataset.size || "",
      color: proCard.dataset.color || "",
      quantity: 1,
    };
  }

  // 💯 AUTO-WIRE ALL PRODUCT CARDS ON PAGE LOAD + MUTATIONS
  function wireProductCards() {
    document.querySelectorAll(".pro").forEach((card, idx) => {
      // Skip if already wired
      if (card.dataset.wired === "true") return;
      card.dataset.wired = "true";
      card.dataset.index = idx;

      // Add missing buttons if not present
      let cartBtn = card.querySelector(".Cart");
      if (!cartBtn) {
        const des = card.querySelector(".des");
        if (des) {
          cartBtn = document.createElement("div");
          cartBtn.className = "Cart";
          cartBtn.innerHTML = '<i class="fas fa-shopping-cart"></i>';
          des.appendChild(cartBtn);
        }
      }

      let wishBtn = card.querySelector(".wishlist");
      if (!wishBtn) {
        const imgWrapper = card.querySelector(".img-wrapper");
        if (imgWrapper) {
          wishBtn = document.createElement("i");
          wishBtn.className = "far fa-heart wishlist";
          imgWrapper.appendChild(wishBtn);
        }
      }

      // Extract and store product data on card
      const data = extractProductData(card);
      if (data) {
        Object.entries(data).forEach(([key, val]) => {
          card.dataset[key] = val;
        });
      }
    });
  }

  // 🔄 OBSERVE DOM CHANGES (dynamic content, AJAX loads)
  const observer = new MutationObserver(() => {
    setTimeout(wireProductCards, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial wiring
  document.addEventListener("DOMContentLoaded", wireProductCards);

  // 💥 INSTANT FEEDBACK ANIMATIONS (CSS keyframe will be added)
  const style = document.createElement("style");
  style.textContent = `
  @keyframes pulse-cart { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
  .Cart:hover { background: #065f55 !important; transform:scale(1.05) }
  .wishlist:hover { transform:scale(1.2) !important }
`;
  document.head.appendChild(style);

  // Quantity input change
  document.body.addEventListener("change", (e) => {
    if (e.target.matches(".cart-quantity-container input[type='number']")) {
      const idx = e.target.dataset.index;
      let qty = parseInt(e.target.value);
      if (isNaN(qty) || qty < 1) qty = 1;
      cart[idx].quantity = qty;
      saveCart();
      renderCart();
      showToast("Quantity updated");
    }
  });
});

const wrapper = document.querySelector(".carousel-wrapper");
const slides = document.querySelectorAll(".carousel-slide");
const prevBtn = document.querySelector(".carousel-prev");
const nextBtn = document.querySelector(".carousel-next");
const dotsContainer = document.querySelector(".carousel-dots");

let currentIndex = 0;
let interval;

// =====================
// SETUP DOTS
// =====================
if (dotsContainer) {
  slides.forEach((_, index) => {
    const dot = document.createElement("span");
    dot.classList.add("dot");
    if (index === 0) dot.classList.add("active");
    dot.addEventListener("click", () => goToSlide(index));
    dotsContainer.appendChild(dot);
  });
}

const dots = document.querySelectorAll(".carousel-dots .dot");

// =====================
// CORE FUNCTIONS
// =====================
function updateCarousel() {
  // Guard: carousel elements may not exist on every page
  if (!wrapper || !slides || slides.length === 0) return;

  // clamp currentIndex to available slides
  currentIndex = Math.max(0, Math.min(currentIndex, slides.length - 1));

  // NO TRANSFORM - use opacity only for perfect stacking
  wrapper.style.transform = "translateX(0px)";

  // Toggle active class for opacity transitions + z-index via CSS
  slides.forEach((slide, i) => {
    slide.classList.toggle("active", i === currentIndex);
  });

  if (dots && dots.length) {
    dots.forEach((dot) => dot.classList.remove("active"));
    if (dots[currentIndex]) dots[currentIndex].classList.add("active");
  }
}

function goToSlide(index) {
  currentIndex = index;
  updateCarousel();
  resetAutoplay();
}

function nextSlide() {
  if (!slides || slides.length === 0) return;
  currentIndex = (currentIndex + 1) % slides.length;
  updateCarousel();
}

function prevSlide() {
  currentIndex = (currentIndex - 1 + slides.length) % slides.length;
  updateCarousel();
}

// =====================
// AUTOPLAY
// =====================
function startAutoplay() {
  interval = setInterval(nextSlide, 5000);
}

function resetAutoplay() {
  clearInterval(interval);
  startAutoplay();
}

// =====================
// EVENTS
// =====================
if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    nextSlide();
    resetAutoplay();
  });
}

if (prevBtn) {
  prevBtn.addEventListener("click", () => {
    prevSlide();
    resetAutoplay();
  });
}

// =====================
// INIT
// =====================
updateCarousel();
startAutoplay();

// ---------------- Profile Dropdown ----------------
const profileDropdown = document.getElementById("profileDropdown");
const logoutBtn = document.getElementById("logoutBtn");
const logoutSuccessMsg = document.getElementById("logoutSuccessMsg");

if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    logoutSuccessMsg.style.display = "none";
    try {
      await signOut(auth);
      logoutSuccessMsg.style.display = "block";
      anime({
        targets: ".shape",
        opacity: 1,
        scale: 1.5,
        duration: 500,
        easing: "easeInOutSine",
        complete: () => {
          anime({
            targets: ".shape",
            opacity: 0,
            scale: 0.5,
            duration: 500,
            easing: "easeInOutSine",
            complete: () => (logoutSuccessMsg.style.display = "none"),
          });
        },
      });
    } catch (error) {
      logoutSuccessMsg.textContent = error.message;
    }
  });
}

function showReviewAfterLogin(product) {
  const blurTarget = document.getElementById("carouselBlurTarget");
  const overlay = document.getElementById("reviewOverlay");

  if (!blurTarget || !overlay) return;

  // Inject product info
  document.getElementById("reviewProductImage").src = product.image;
  document.getElementById("reviewProductName").textContent = product.name;

  blurTarget.classList.add("blurred");
  overlay.classList.remove("hidden");
}

// Ensure proper cleanup on modal close
document.addEventListener(
  "click",
  (e) => {
    if (
      e.target.id === "closeReviewModalECT" ||
      e.target.classList.contains("modal")
    ) {
      const blurTarget = document.getElementById("carouselBlurTarget");
      if (blurTarget) blurTarget.classList.remove("blurred");
    }
  },
  true,
);

// Select the elements
const menuBtn = document.getElementById("menuBtn");
const closeMenuBtn = document.getElementById("closeMenu");
const sideMenu = document.getElementById("sideMenu");
const overlay = document.getElementById("overlay");

// Function to open the menu
function openMenu() {
  sideMenu.classList.add("is-active");
  overlay.classList.add("is-active");
}

// Function to close the menu
function closeMenu() {
  sideMenu.classList.remove("is-active");
  overlay.classList.remove("is-active");
}

// Add event listeners
menuBtn.addEventListener("click", openMenu);
closeMenuBtn.addEventListener("click", closeMenu);
overlay.addEventListener("click", closeMenu); // Close when clicking outside the menu
