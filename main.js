import "./firebase.js";
import { initReviews } from "./reviews.js";

const GLOBAL_CATEGORY_ICONS = {
  watches: "fa-watch",
  hoodies: "fa-shirt",
  caps: "fa-hat-cowboy",
  shoes: "fa-shoe-prints",
  sneakers: "fa-shoe-prints",
  slides: "fa-shoe-prints",
  shirts: "fa-shirt",
  "t-shirts": "fa-tshirt",
  accessories: "fa-box-open",
  bags: "fa-shopping-bag",
  jewelry: "fa-gem",
};

const GLOBAL_CATEGORY_LIST = [
  "Watches",
  "Hoodies",
  "Caps",
  "Shoes",
  "Sneakers",
  "Slides",
  "Shirts",
  "T-Shirts",
  "Accessories",
  "Bags",
  "Jewelry",
];

function renderGlobalMobileCategories(categories) {
  const mobileCategoriesEl = document.getElementById("mobileCategories");
  if (!mobileCategoriesEl || mobileCategoriesEl.childElementCount > 0) return;

  mobileCategoriesEl.innerHTML = categories
    .map((category) => {
      const key = category.toLowerCase().replace(/\s+/g, "-");
      const iconClass = GLOBAL_CATEGORY_ICONS[key] || "fa-tags";
      return `
        <li>
          <button type="button" class="mobile-cat-btn" data-category="${category}">
            <span class="mobile-cat-icon"><i class="fas ${iconClass}"></i></span>
            <span class="mobile-cat-label">${category}</span>
            <span class="mobile-cat-arrow"><i class="fas fa-chevron-right"></i></span>
          </button>
        </li>
      `;
    })
    .join("");
}

document.addEventListener("DOMContentLoaded", () => {
  const header = document.getElementById("header");
  function setHeaderVar() {
    if (!header) return;
    const h = header.offsetHeight || 88; // desktop fallback
    document.documentElement.style.setProperty("--header-height", `${h}px`);

    // Mobile fallback via media query detection
    if (window.matchMedia("(max-width: 768px)").matches) {
      // Force mobile height recalc ~120px for top+nav
      const estimatedMobileHeight = Math.max(h, 120);
      document.documentElement.style.setProperty(
        "--header-height",
        `${estimatedMobileHeight}px`,
      );
    }
  }

  setHeaderVar();
  let rh;
  window.addEventListener("resize", () => {
    if (rh) cancelAnimationFrame(rh);
    rh = requestAnimationFrame(setHeaderVar);
  });

  // Enhanced ResizeObserver for viewport/media changes
  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(setHeaderVar);
  });
  if (header) resizeObserver.observe(header);

  if (header) {
    const mo = new MutationObserver(() => {
      if (rh) cancelAnimationFrame(rh);
      rh = requestAnimationFrame(setHeaderVar);
    });
    mo.observe(header, { childList: true, subtree: true, attributes: true });
    window.addEventListener("load", setHeaderVar, { once: true });
  }

  const productEl = document.getElementById("product");
  if (productEl) {
    const productId = productEl.dataset.productId;
    initReviews(productId);
  }

  // Dispatch custom event for other scripts to listen
  window.dispatchEvent(new CustomEvent("header:height-updated"));
  // Mobile menu toggle (open/close side menu + overlay)
  const menuBtn = document.getElementById("menuBtn");
  const sideMenu = document.getElementById("sideMenu");
  const closeMenuBtn = document.getElementById("closeMenu");
  const overlayEl = document.getElementById("overlay");

  function openSideMenu() {
    if (sideMenu) sideMenu.classList.add("is-active");
    if (overlayEl) overlayEl.classList.add("is-active");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
    document.documentElement.style.overflow = "hidden";
  }

  function closeSideMenu() {
    if (sideMenu) sideMenu.classList.remove("is-active");
    if (overlayEl) overlayEl.classList.remove("is-active");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    document.documentElement.style.overflow = "";
  }

  if (menuBtn) menuBtn.addEventListener("click", openSideMenu);
  if (closeMenuBtn) closeMenuBtn.addEventListener("click", closeSideMenu);
  if (overlayEl) overlayEl.addEventListener("click", closeSideMenu);

  renderGlobalMobileCategories(GLOBAL_CATEGORY_LIST);

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".mobile-cat-btn");
    if (!btn) return;
    if (document.getElementById("filter-category")) return;

    const category = btn.dataset.category;
    if (!category) return;

    window.location.href = `shop.html?q=${encodeURIComponent(category)}`;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSideMenu();
  });
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

const CART_DELIVERY_FEE = 150;

function parseJSON(value, fallback = []) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function initGlobalSearch() {
  const headerSearchInput = document.getElementById("searchInput");
  const headerSearchBtn = document.getElementById("searchBtn");
  if (!headerSearchInput || !headerSearchBtn) return;

  headerSearchBtn.addEventListener("click", () => {
    navigateToSearchPage(headerSearchInput.value);
  });

  headerSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateToSearchPage(headerSearchInput.value);
    }
  });
}

function formatDisplayName(rawName) {
  if (!rawName) return "Guest";
  const name = String(rawName)
    .trim()
    .split(/[\s@]+/)[0]
    .replace(/[^a-zA-Z0-9]/g, "");
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : "Guest";
}

function getStoredUserName() {
  const stored = localStorage.getItem("userName");
  return stored ? String(stored).trim() : "";
}

function updateProfileUI() {
  const stored = getStoredUserName();
  const authEmail = currentUser?.email || "";
  const authDisplay = currentUser?.displayName || stored || authEmail;
  const rawName = currentUser?.displayName || stored || authEmail;
  const greetingName = rawName
    ? formatDisplayName(rawName.split("@")[0])
    : "Guest";

  const profileGreeting = document.getElementById("profileGreeting");
  const profileUserName = document.getElementById("profileUserName");
  const userNameSpan = document.getElementById("userName");
  const mobileGreeting = document.getElementById("mobileGreeting");
  const profileActions = document.getElementById("profileActions");

  if (profileGreeting) {
    profileGreeting.textContent = currentUser
      ? `Hello, ${greetingName}`
      : stored
        ? `Hello, ${greetingName}`
        : "Sign In";
  }

  if (profileUserName) {
    profileUserName.textContent = currentUser
      ? authEmail
      : stored
        ? authDisplay
        : "";
  }

  if (userNameSpan) {
    userNameSpan.textContent = greetingName;
  }

  if (mobileGreeting) {
    mobileGreeting.textContent = `👤 Hello, ${greetingName}`;
  }

  if (profileActions) {
    if (currentUser) {
      profileActions.innerHTML = `
        <a href="account.html"><i class="fas fa-user"></i> My Account</a>
        <a href="#" id="signOutBtn"><i class="fas fa-sign-out-alt"></i> Sign Out</a>
      `;
    } else if (stored) {
      profileActions.innerHTML =
        '<a href="#" id="signOutBtn"><i class="fas fa-sign-out-alt"></i> Sign Out</a>';
    } else {
      profileActions.innerHTML =
        '<a href="auth.html"><i class="fas fa-sign-in-alt"></i> Sign In</a>';
    }
    initSignOutButton();
  }
}

function initSignOutButton() {
  const signOutBtn = document.getElementById("signOutBtn");
  if (!signOutBtn) return;

  signOutBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await signOut(auth);
      localStorage.removeItem("userName");
      updateProfileUI();
      window.location.reload();
    } catch (err) {
      showToast("Unable to sign out. Please try again.");
      console.error("Sign out failed:", err);
    }
  });
}

function initProfileDropdown() {
  const profileWrapper = document.querySelector(".profile-wrapper");
  const profileLink = document.querySelector(".profile-link");
  if (!profileWrapper || !profileLink) return;

  profileLink.addEventListener("click", (event) => {
    event.preventDefault();
    profileWrapper.classList.toggle("active");
  });

  document.addEventListener("click", (event) => {
    if (!profileWrapper.contains(event.target)) {
      profileWrapper.classList.remove("active");
    }
  });
}

function isShopPage() {
  const pathname = window.location.pathname;
  return pathname.endsWith("shop.html") || pathname.endsWith("/shop.html");
}

function navigateToSearchPage(query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    showToast("Enter at least 2 characters to search.");
    return;
  }

  if (isShopPage()) {
    const event = new CustomEvent("shop:search", {
      detail: { q: normalizedQuery },
    });
    window.dispatchEvent(event);
    const url = new URL(window.location.href);
    url.searchParams.set("q", normalizedQuery);
    history.replaceState({}, "", url);
    return;
  }

  window.location.href = `shop.html?q=${encodeURIComponent(normalizedQuery)}`;
}

function getCartKey(user = currentUser) {
  return user ? `cart_${user.uid}` : "cart_guest";
}

function getWishlistKey(user = currentUser) {
  return user ? `wishlist_${user.uid}` : "wishlist_guest";
}

function getLocalItems(key) {
  return parseJSON(localStorage.getItem(key), []);
}

function saveLocalItems(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function mergeCartItems(baseItems, incomingItems) {
  const merged = baseItems.map((item) => ({
    ...item,
    quantity: Number(item.quantity || 1),
  }));

  incomingItems.forEach((incoming) => {
    if (!incoming || !incoming.id) return;

    const existingIndex = merged.findIndex(
      (item) =>
        item.id === incoming.id &&
        item.size === incoming.size &&
        item.color === incoming.color,
    );

    if (existingIndex >= 0) {
      merged[existingIndex].quantity += Number(incoming.quantity || 1);
    } else {
      merged.push({
        ...incoming,
        quantity: Number(incoming.quantity || 1),
      });
    }
  });

  return merged;
}

function mergeWishlistItems(baseItems, incomingItems) {
  const merged = [...baseItems];

  incomingItems.forEach((incoming) => {
    if (!incoming || !incoming.id) return;
    const exists = merged.some((item) => item.id === incoming.id);
    if (!exists) merged.push(incoming);
  });

  return merged;
}

function loadCartItems() {
  const guestCart = getLocalItems("cart_guest");
  if (!currentUser) return guestCart;

  const userCart = getLocalItems(getCartKey(currentUser));
  const merged = mergeCartItems(userCart, guestCart);

  if (merged.length > 0) {
    saveLocalItems(getCartKey(currentUser), merged);
  }

  if (guestCart.length) {
    localStorage.removeItem("cart_guest");
  }

  return merged;
}

function loadWishlistItems() {
  const guestWishlist = getLocalItems("wishlist_guest");
  if (!currentUser) return guestWishlist;

  const userWishlist = getLocalItems(getWishlistKey(currentUser));
  const merged = mergeWishlistItems(userWishlist, guestWishlist);

  if (merged.length > 0) {
    saveLocalItems(getWishlistKey(currentUser), merged);
  }

  if (guestWishlist.length) {
    localStorage.removeItem("wishlist_guest");
  }

  return merged;
}

function migrateGuestData(user) {
  if (!user) return;
  const guestCart = getLocalItems("cart_guest");
  if (guestCart.length) {
    const userCart = getLocalItems(getCartKey(user));
    const mergedCart = mergeCartItems(userCart, guestCart);
    saveLocalItems(getCartKey(user), mergedCart);
    localStorage.removeItem("cart_guest");
  }

  const guestWishlist = getLocalItems("wishlist_guest");
  if (guestWishlist.length) {
    const userWishlist = getLocalItems(getWishlistKey(user));
    const mergedWishlist = mergeWishlistItems(userWishlist, guestWishlist);
    saveLocalItems(getWishlistKey(user), mergedWishlist);
    localStorage.removeItem("wishlist_guest");
  }
}

function updateCartCountHeader() {
  const countEl = document.querySelector(".cart-count");
  if (!countEl) return;
  const cartItems = loadCartItems();
  const total = cartItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  countEl.textContent = total;
}

function isCartPage() {
  return !!document.querySelector(".cart-items-container");
}

function isWishlistPage() {
  return !!document.querySelector(".wishlist-items-container");
}

function renderCartPage() {
  const cartContainer = document.querySelector(".cart-items-container");
  if (!cartContainer) return;

  const cart = loadCartItems();
  const countText = document.getElementById("cart-count-text");
  const subtotalEl = document.getElementById("subtotal");
  const grandTotalEl = document.getElementById("grand-total");
  const checkoutBtn = document.querySelector(".checkout-btn");

  if (!cart.length) {
    cartContainer.innerHTML = `
      <div class="empty-cart-message">
        Your cart is empty. Add products from the shop or product pages.
      </div>
    `;
    if (countText) countText.textContent = "0";
    if (subtotalEl) subtotalEl.textContent = "0";
    if (grandTotalEl) grandTotalEl.textContent = "0";
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  if (checkoutBtn) checkoutBtn.disabled = false;

  let subtotal = 0;
  cartContainer.innerHTML = cart
    .map((item, index) => {
      const quantity = Number(item.quantity || 1);
      const itemTotal = Number(item.price || 0) * quantity;
      subtotal += itemTotal;
      const hasOldPrice =
        Number.isFinite(Number(item.oldPrice)) &&
        Number(item.oldPrice) > Number(item.price);
      const discount = hasOldPrice
        ? Math.floor(
            ((Number(item.oldPrice) - Number(item.price)) /
              Number(item.oldPrice)) *
              100,
          )
        : 0;

      return `
        <div class="cart-item">
          <div class="cart-item-image">
            <img src="${item.img || "img/products/default.jpg"}" alt="${item.name || "Product"}" />
          </div>
          <div class="cart-item-details">
            <h4>${item.name || "Product"}</h4>
            <div class="cart-prices">
              <span class="cart-current-price">Ksh ${item.price || 0}</span>
              ${hasOldPrice ? `<span class="cart-old-price">Ksh ${item.oldPrice}</span>` : ""}
              ${discount ? `<span class="cart-discount">${discount}% OFF</span>` : ""}
            </div>
            <div class="cart-quantity-controls">
              <button class="quantity-btn" data-index="${index}" data-action="decrease" type="button">−</button>
              <span class="quantity-value">${quantity}</span>
              <button class="quantity-btn" data-index="${index}" data-action="increase" type="button">+</button>
            </div>
            ${item.size ? `<p>Size: ${item.size}</p>` : ""}
            ${item.color ? `<p>Color: ${item.color}</p>` : ""}
          </div>
          <button class="remove-cart-item trash-btn" data-index="${index}" type="button">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;
    })
    .join("");

  if (countText)
    countText.textContent = cart.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );
  if (subtotalEl) subtotalEl.textContent = subtotal;
  if (grandTotalEl) grandTotalEl.textContent = subtotal + CART_DELIVERY_FEE;

  cartContainer.querySelectorAll(".remove-cart-item").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index)) return;
      cart.splice(index, 1);
      saveLocalItems(getCartKey(), cart);
      renderCartPage();
      updateCartCountHeader();
      showToast("Item removed from cart.");
    });
  });

  cartContainer.querySelectorAll(".quantity-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const action = button.dataset.action;
      if (!Number.isInteger(index)) return;
      const item = cart[index];
      if (!item) return;

      const currentQty = Number(item.quantity || 1);
      const nextQty = action === "increase" ? currentQty + 1 : currentQty - 1;

      if (nextQty <= 0) {
        cart.splice(index, 1);
      } else {
        cart[index].quantity = nextQty;
      }

      saveLocalItems(getCartKey(), cart);
      renderCartPage();
      updateCartCountHeader();
    });
  });
}

function renderWishlistPage() {
  const wishlistContainer = document.querySelector(".wishlist-items-container");
  if (!wishlistContainer) return;

  const wishlist = loadWishlistItems();
  if (!wishlist.length) {
    wishlistContainer.innerHTML = `
      <div class="empty-wishlist-message">
        Your wishlist is empty. Add favorites from the product page.
      </div>
    `;
    return;
  }

  wishlistContainer.innerHTML = wishlist
    .map((item, index) => {
      const hasOldPrice =
        Number.isFinite(Number(item.oldPrice)) &&
        Number(item.oldPrice) > Number(item.price);
      const discount = hasOldPrice
        ? Math.floor(
            ((Number(item.oldPrice) - Number(item.price)) /
              Number(item.oldPrice)) *
              100,
          )
        : 0;

      return `
        <div class="wishlist-item">
          <div class="wishlist-image">
            <img src="${item.img || "img/products/default.jpg"}" alt="${item.name || "Wishlist item"}" />
          </div>
          <div class="wishlist-details">
            <h4>${item.name || "Product"}</h4>
            <div class="wishlist-prices">
              <span class="wishlist-current-price">Ksh ${item.price || 0}</span>
              ${hasOldPrice ? `<span class="wishlist-old-price">Ksh ${item.oldPrice}</span>` : ""}
              ${discount ? `<span class="wishlist-discount">${discount}% OFF</span>` : ""}
            </div>
          </div>
          <div class="wishlist-actions">
            <button class="add-wishlist-to-cart" data-index="${index}" type="button">Add to Cart</button>
            <button class="remove-wishlist-item trash-btn" data-index="${index}" type="button">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  wishlistContainer
    .querySelectorAll(".add-wishlist-to-cart")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        if (!Number.isInteger(index)) return;

        const wishlist = getLocalItems(getWishlistKey());
        const item = wishlist[index];
        if (!item) return;

        const cart = getLocalItems(getCartKey());
        const existingIndex = cart.findIndex(
          (cartItem) =>
            cartItem.id === item.id &&
            cartItem.size === item.size &&
            cartItem.color === item.color,
        );

        if (existingIndex >= 0) {
          cart[existingIndex].quantity =
            Number(cart[existingIndex].quantity || 1) + 1;
        } else {
          cart.push({
            ...item,
            quantity: 1,
          });
        }

        saveLocalItems(getCartKey(), cart);
        updateCartCountHeader();
        if (isCartPage()) renderCartPage();
        showToast(`${item.name || "Product"} added to cart.`);
      });
    });

  wishlistContainer
    .querySelectorAll(".remove-wishlist-item")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        if (!Number.isInteger(index)) return;
        wishlist.splice(index, 1);
        saveLocalItems(getWishlistKey(), wishlist);
        renderWishlistPage();
        showToast("Removed from wishlist.");
      });
    });
}

function handleProceedToCheckout() {
  if (!currentUser) {
    showToast("You must be signed in to checkout.");
    window.location.href = "auth.html";
    return;
  }

  const cartItems = loadCartItems();
  if (!cartItems.length) {
    showToast("Your cart is empty.");
    return;
  }

  const subtotal = cartItems.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0,
  );

  const pendingOrder = {
    items: cartItems,
    subtotal,
    deliveryFee: CART_DELIVERY_FEE,
    total: subtotal + CART_DELIVERY_FEE,
    createdAt: Date.now(),
  };

  localStorage.setItem("pendingOrder", JSON.stringify(pendingOrder));
  window.location.href = "checkout.html";
}

function initCartWishlistPages() {
  updateCartCountHeader();

  if (isCartPage()) {
    renderCartPage();
    const checkoutBtn = document.querySelector(".checkout-btn");
    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", handleProceedToCheckout);
    }
  }

  if (isWishlistPage()) {
    renderWishlistPage();
  }
}

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (user) {
    migrateGuestData(user);
    const userNameValue = user.displayName || user.email || "";
    if (userNameValue) {
      localStorage.setItem("userName", userNameValue);
    }
  } else {
    localStorage.removeItem("userName");
  }

  updateCartCountHeader();
  if (isCartPage()) renderCartPage();
  if (isWishlistPage()) renderWishlistPage();
  updateProfileUI();
});

document.addEventListener("DOMContentLoaded", initCartWishlistPages);
window.addEventListener("cart:updated", () => {
  updateCartCountHeader();
  if (isCartPage()) renderCartPage();
});
document.addEventListener("DOMContentLoaded", initGlobalSearch);
document.addEventListener("DOMContentLoaded", () => {
  updateProfileUI();
  initProfileDropdown();
});

// =======================
