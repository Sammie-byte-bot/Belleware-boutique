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

function saveCart() {
  localStorage.setItem(getCartKey(), JSON.stringify(cart));
  updateCartCount();
}

function saveWishlist() {
  localStorage.setItem(getWishlistKey(), JSON.stringify(wishlist));
}

function loadCart() {
  // Load cart using the per-user key. If nothing found, migrate legacy 'cart' key.
  const key = getCartKey();
  let stored = localStorage.getItem(key);
  if (!stored) {
    // migrate from legacy key if present
    const legacy = localStorage.getItem("cart");
    if (legacy) {
      try {
        localStorage.setItem(key, legacy);
        localStorage.removeItem("cart");
        stored = legacy;
      } catch (e) {
        // ignore quota errors
      }
    }
  }
  if (!stored && currentUser) {
    // Try to migrate from old userName based key
    const oldName = currentUser.displayName || currentUser.email || "";
    const truncated =
      oldName.length > 12 ? oldName.slice(0, 12) + "..." : oldName;
    const oldKey = `cart_${truncated}`;
    const oldStored = localStorage.getItem(oldKey);
    if (oldStored) {
      try {
        localStorage.setItem(key, oldStored);
        localStorage.removeItem(oldKey);
        stored = oldStored;
      } catch (e) {
        // ignore
      }
    }
  }
  cart = JSON.parse(stored) || [];
  renderCart();
  updateCartCount();
}

function loadWishlist() {
  // Load wishlist using per-user key, fallback/migrate legacy 'wishlist'
  const wkey = getWishlistKey();
  let stored = localStorage.getItem(wkey);
  if (!stored) {
    const legacy = localStorage.getItem("wishlist");
    if (legacy) {
      try {
        localStorage.setItem(wkey, legacy);
        localStorage.removeItem("wishlist");
        stored = legacy;
      } catch (e) {}
    }
  }
  wishlist = JSON.parse(stored) || [];
  renderWishlist();
}

// =======================
// CART COUNT
// =======================
function updateCartCount() {
  const cartCountEls = document.querySelectorAll(".cart-count");
  const count = cart.reduce((total, item) => total + item.quantity, 0);
  cartCountEls.forEach((el) => (el.textContent = count));
}

// =======================
// RENDER CART & WISHLIST
// =======================
function renderCart() {
  const cartContainer = document.querySelector(".cart-items-container");
  const subtotalEl = document.getElementById("subtotal");
  const grandTotalEl = document.getElementById("grand-total");
  if (!cartContainer) return;

  cartContainer.innerHTML = "";
  if (cart.length === 0) {
    cartContainer.innerHTML =
      "<p>Your cart is empty. Shop now to add items!</p>";
    if (subtotalEl) subtotalEl.textContent = "0";
    if (grandTotalEl) grandTotalEl.textContent = "0";
    return;
  }

  let subtotal = 0;
  cart.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;
    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}">
      <div class="cart-item-info">
        <p>${item.name}</p>
        <span>Ksh ${item.price}</span>
      </div>
      <div class="cart-quantity-container">
        <button class="minus" data-index="${index}">-</button>
        <input type="number" min="1" value="${item.quantity}" data-index="${index}">
        <button class="plus" data-index="${index}">+</button>
        <button class="remove-item" data-index="${index}">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <span class="item-total">Ksh ${itemTotal}</span>
    `;
    cartContainer.appendChild(div);
  });

  if (subtotalEl) subtotalEl.textContent = subtotal;
  if (grandTotalEl) grandTotalEl.textContent = subtotal + deliveryFee;
}

function renderWishlist() {
  const wishlistContainer = document.querySelector(".wishlist-items-container");
  if (!wishlistContainer) return;

  wishlistContainer.innerHTML = "";
  if (wishlist.length === 0) {
    wishlistContainer.innerHTML = "<p>Your wishlist is empty.</p>";
    return;
  }

  wishlist.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "wishlist-item";
    div.innerHTML = `
      <img src="${item.img}" alt="${item.name}">
      <div class="product-info">
        <p>${item.name}</p>
        <span>Ksh ${item.price}</span>
      </div>
      <div class="wishlist-actions">
        <button class="remove-wishlist" data-index="${index}">
          <i class="fas fa-trash"></i> Remove
        </button>
        <button class="add-cart" data-index="${index}">
          <i class="fas fa-cart-plus"></i> Add to Cart
        </button>
      </div>
    `;
    wishlistContainer.appendChild(div);
  });
}

// =======================
// ADD TO CART & WISHLIST
// =======================
function addToCart(item) {
  const existing = cart.find((i) => i.name === item.name);
  if (existing) existing.quantity += 1;
  else ((item.quantity = 1), cart.push(item));
  saveCart();
  renderCart();
  showToast(`${item.name} added to cart`);
}

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
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  window.currentUser = user; // Make it global for other scripts

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
  // Reload cart and wishlist when auth state changes
  loadCart();
  loadWishlist();
});

// =======================
// INITIALIZATION
// =======================
document.addEventListener("DOMContentLoaded", () => {
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
      if (
        e.target.closest(".wishlist") ||
        e.target.closest(".Cart") ||
        e.target.closest("a")
      )
        return;
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

  if (searchButton && !searchIcon) {
    searchButton.addEventListener("click", (e) => {
      e.preventDefault();
      openSearchOverlay();
    });
  }

  closeSearch?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSearchOverlay();
  });

  // Submit search: when clicking the search button inside overlay or pressing Enter
  function submitHeaderSearch() {
    const q = (searchInput?.value || "").trim();
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

  // ---------------------------
  // Enhanced Firebase-based live search with previews
  // ---------------------------
  let suggestIndex = -1;
  const resultsEl = document.querySelector(".search-results");

  // Initialize product cache on page load
  fetchAllProducts();

  function renderSuggestions(items, q) {
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
    if (!q || q.length < 2) {
      if (resultsEl) resultsEl.innerHTML = "";
      return;
    }

    fetchAllProducts().then((allProducts) => {
      const matches = searchProducts(q, 8);
      renderSuggestions(matches, q);
    });
  }, 200);

  searchInput?.addEventListener("input", onInput);

  // Keyboard navigation for suggestions
  searchInput?.addEventListener("keydown", (e) => {
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
    if (!e.target.closest(".search-box")) {
      resultsEl && (resultsEl.innerHTML = "");
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

  // Event delegation for cart and wishlist
  document.body.addEventListener("click", (e) => {
    const target = e.target;

    // CART / WISHLIST BUTTONS
    if (target.closest(".Cart")) {
      e.preventDefault();
      const btn = target.closest(".Cart");
      addToCart({
        name: btn.dataset.name,
        price: parseFloat(btn.dataset.price),
        img: btn.dataset.img,
      });
    }

    if (target.closest(".wishlist")) {
      e.preventDefault();
      const btn = target.closest(".wishlist");
      addToWishlist({
        name: btn.dataset.name,
        price: parseFloat(btn.dataset.price),
        img: btn.dataset.img,
      });
      // Visual feedback: animate and ensure solid icon when added
      btn.classList.add("wish-anim");
      setTimeout(() => btn.classList.remove("wish-anim"), 450);
      // switch FontAwesome style to solid when item is in wishlist
      const inList = wishlist.some((it) => it.name === btn.dataset.name);
      if (inList) {
        btn.classList.remove("far");
        btn.classList.add("fas", "active");
      } else {
        btn.classList.remove("fas", "active");
        btn.classList.add("far");
      }
      // Keep wishlist icons sync'd
      if (typeof updateWishlistIcons === "function") updateWishlistIcons();
    }

    // QUANTITY
    if (target.closest(".plus") || target.closest(".minus")) {
      e.preventDefault();
      const idx = target.closest("button").dataset.index;
      if (target.closest(".plus")) cart[idx].quantity += 1;
      if (target.closest(".minus") && cart[idx].quantity > 1)
        cart[idx].quantity -= 1;
      saveCart();
      renderCart();
      showToast("Quantity updated");
    }

    // REMOVE ITEM
    if (target.closest(".remove-item")) {
      e.preventDefault();
      const idx = target.closest(".remove-item").dataset.index;
      const removed = cart[idx].name;
      cart.splice(idx, 1);
      saveCart();
      renderCart();
      showToast(`${removed} removed`);
    }

    // WISHLIST REMOVE / ADD TO CART
    if (target.closest(".remove-wishlist")) {
      e.preventDefault();
      const idx = target.closest(".remove-wishlist").dataset.index;
      const removed = wishlist[idx].name;
      wishlist.splice(idx, 1);
      saveWishlist();
      renderWishlist();
      if (typeof updateWishlistIcons === "function") updateWishlistIcons();
      showToast(`${removed} removed`);
    }

    if (target.closest(".add-cart")) {
      e.preventDefault();
      const idx = target.closest(".add-cart").dataset.index;
      addToCart(wishlist[idx]);
    }

    // PROCEED TO CHECKOUT
    if (target.closest(".checkout-btn")) {
      e.preventDefault();

      if (cart.length === 0) {
        showToast("Your cart is empty");
        return;
      }

      if (!currentUser) {
        showToast("Please sign in to continue");
        return;
      }

      // Recalculate totals
      const subtotal = cart.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
      const total = subtotal + deliveryFee;

      const pendingOrder = {
        items: cart,
        subtotal,
        deliveryFee,
        total,
        createdAt: Date.now(),
        status: "CHECKOUT",
      };

      localStorage.setItem("pendingOrder", JSON.stringify(pendingOrder));

      // Relative path redirect (works in same folder)
      window.location.href = "checkout.html";
    }
  });

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

  if (wrapper.style)
    wrapper.style.transform = `translateX(-${currentIndex * 100}%)`;

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
