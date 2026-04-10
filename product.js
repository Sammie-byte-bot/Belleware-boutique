// =====================================================
// FIREBASE SETUP
// =====================================================
// Modular Firebase imports (tree-shaking friendly)

import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Timestamp used when creating reviews
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// =====================================================
// FIREBASE CONFIGURATION
// =====================================================

const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "bellewear-boutique.firebaseapp.com",
  projectId: "bellewear-boutique",
  storageBucket: "bellewear-boutique.firebasestorage.app",
  messagingSenderId: "795858464616",
  appId: "1:795858464616:web:0bbf307b3da145766ff0dd",
};

// Prevent multiple firebase initializations
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

const db = getFirestore(app);
const auth = getAuth(app);

// =====================================================
// DOM ELEMENTS
// =====================================================

const productImage = document.getElementById("productImage");
const productName = document.getElementById("productName");
const productBrand = document.getElementById("productBrand");
const productPrice = document.getElementById("productPrice");
const productOldPrice = document.getElementById("productOldPrice");
const productDiscount = document.getElementById("productDiscount");
const productDescription = document.getElementById("productDescription");
const productRating = document.getElementById("productRating");
const stockWarning = document.getElementById("stockWarning");

const thumbnails = document.querySelector(".thumbnails");

const sizeVariant = document.getElementById("sizeVariant");
const colorVariant = document.getElementById("colorVariant");

const increaseQty = document.getElementById("increaseQty");
const decreaseQty = document.getElementById("decreaseQty");
const quantityValue = document.getElementById("quantityValue");

const addToCartBtn = document.getElementById("addToCart");
const addToWishlistBtn = document.getElementById("addToWishlist");

const cartCountEl = document.querySelector(".cart-count");

const reviewsContainer = document.getElementById("reviewsContainer");

let currentProductData = null;
let currentQuantity = 1;

// =====================================================
// GET PRODUCT ID FROM URL
// =====================================================

const params = new URLSearchParams(window.location.search);
const productId = params.get("id");

if (!productId) {
  document.body.innerHTML = "<h2>Product not found</h2>";
  throw new Error("No product ID in URL");
}

// =====================================================
// LOADER CONTROLS
// =====================================================

function showProductLoader() {
  const loader = document.getElementById("productLoader");

  if (loader) {
    loader.style.display = "flex";
    document.body.classList.add("product-loading");
  }
}

function hideProductLoader() {
  const loader = document.getElementById("productLoader");

  if (!loader) return;

  loader.classList.add("fade-out");

  setTimeout(() => {
    loader.style.display = "none";
    document.body.classList.remove("product-loading");
  }, 500);
}

showProductLoader();

// =====================================================
// LOAD PRODUCT DATA
// =====================================================

async function loadProductFromFirestore() {
  try {
    const docSnap = await getDoc(doc(db, "products", productId));

    if (!docSnap.exists()) {
      document.body.innerHTML = "<h2>Product not found</h2>";
      return;
    }

    const product = docSnap.data();

    // Preload main product image for faster display
    if (Array.isArray(product.images) && product.images.length > 0) {
      const img = new Image();
      img.src = product.images[0];
    }

    loadProduct(product);

    // Load reviews asynchronously (non-blocking)
    setTimeout(() => {
      loadProductReviews(productId);
      updateRecentlyViewed(productId);
    }, 100);
  } catch (error) {
    console.error("Failed to load product:", error);
    alert("Failed to load product");
  } finally {
    hideProductLoader();
  }
}

loadProductFromFirestore();

// =====================================================
// RENDER PRODUCT DATA
// =====================================================

function loadProduct(product) {
  productName.textContent = product.name || "No Name";
  productBrand.textContent = product.brand || "-";
  productPrice.textContent = `Ksh ${product.price || 0}`;
  productDescription.textContent = product.description || "";

  // Store loaded product for cart/wishlist actions
  currentProductData = product;

  // =====================
  // DISCOUNT CALCULATION
  // =====================

  if (product.oldPrice && product.price) {
    productOldPrice.textContent = `Ksh ${product.oldPrice}`;

    productDiscount.textContent = `${Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100)}% OFF`;
  } else {
    productOldPrice.textContent = "";
    productDiscount.textContent = "";
  }

  // =====================
  // STOCK WARNING
  // =====================

  if (product.stock !== undefined && product.stock <= 5) {
    stockWarning.textContent = `Only ${product.stock} left in stock`;
  } else {
    stockWarning.textContent = "";
  }

  // =====================================================
  // PRODUCT IMAGES
  // =====================================================

  const images =
    Array.isArray(product.images) && product.images.length
      ? product.images
      : ["img/products/default.jpg"];

  // Set main image with optimization
  productImage.src = images[0];
  productImage.loading = "lazy";
  productImage.decoding = "async";

  thumbnails.innerHTML = "";

  images.forEach((img, i) => {
    const thumb = document.createElement("img");

    thumb.src = img;
    thumb.loading = "lazy";
    thumb.decoding = "async";

    if (i === 0) thumb.classList.add("active");

    thumb.onclick = () => {
      document
        .querySelectorAll(".thumbnails img")
        .forEach((t) => t.classList.remove("active"));

      productImage.src = img;
      thumb.classList.add("active");
    };

    thumbnails.appendChild(thumb);
  });

  // =====================================================
  // PRODUCT RATING
  // =====================================================

  productRating.innerHTML = "";

  const rating = product.rating || 0;

  for (let i = 0; i < rating; i++) {
    const star = document.createElement("i");
    star.className = "fas fa-star";

    productRating.appendChild(star);
  }

  // =====================================================
  // PRODUCT VARIANTS
  // =====================================================

  const sizeSelect = document.createElement("select");
  sizeSelect.innerHTML = `<option value="">Select size</option>`;

  (product.sizes || []).forEach((size) => {
    sizeSelect.innerHTML += `<option value="${size}">${size}</option>`;
  });

  sizeVariant.innerHTML = "";
  sizeVariant.appendChild(sizeSelect);

  const colorSelect = document.createElement("select");
  colorSelect.innerHTML = `<option value="">Select color</option>`;

  (product.colors || []).forEach((color) => {
    colorSelect.innerHTML += `<option value="${color}">${color}</option>`;
  });

  colorVariant.innerHTML = "";
  colorVariant.appendChild(colorSelect);

  // =====================================================
  // QUANTITY CONTROLLER
  // =====================================================

  let qty = 1;

  quantityValue.textContent = qty;

  increaseQty.onclick = () => {
    qty++;
    quantityValue.textContent = qty;
    currentQuantity = qty;
  };

  decreaseQty.onclick = () => {
    if (qty > 1) qty--;
    quantityValue.textContent = qty;
    currentQuantity = qty;
  };
}

// =====================================================
// LOAD PRODUCT REVIEWS (OPTIMIZED)
// =====================================================
// CRITICAL FIX:
// Previously each review fetched a user document.
// That caused N+1 Firestore queries.
// Now we use stored reviewer name inside the review document.

async function loadProductReviews(productId) {
  try {
    const reviewsQuery = query(
      collection(db, "reviews"),
      where("productId", "==", productId),
    );

    const reviewsSnap = await getDocs(reviewsQuery);

    reviewsContainer.innerHTML = "";

    if (reviewsSnap.empty) {
      // Render empty state
      renderEmptyRatings();
      reviewsContainer.innerHTML =
        "<p class='no-reviews'>No reviews yet. Be the first to review!</p>";
      return;
    }

    // Collect all reviews and calculate ratings
    const reviews = [];
    const ratingCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalRating = 0;

    reviewsSnap.forEach((doc) => {
      const review = doc.data();
      reviews.push(review);

      // Count ratings for distribution
      const rating = Math.round(review.rating || 0);
      if (rating >= 1 && rating <= 5) {
        ratingCounts[rating]++;
        totalRating += rating;
      }
    });

    // Calculate average rating
    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0 ? (totalRating / totalReviews).toFixed(1) : 0;

    // Render the professional ratings display
    renderRatingsSummary(averageRating, totalReviews, ratingCounts);

    // Render individual reviews
    for (const review of reviews) {
      const reviewEl = document.createElement("div");

      reviewEl.className = "review-item";

      const date =
        review.createdAt?.toDate?.().toLocaleDateString() || "Unknown";

      let userName = review.userName || "Verified Buyer";

      userName = userName || "Verified Buyer";

      // Generate star icons
      const stars = Array.from({ length: 5 }, (_, i) => {
        return i < review.rating
          ? '<i class="fas fa-star"></i>'
          : '<i class="far fa-star"></i>';
      }).join("");

      reviewEl.innerHTML = `
        <div class="review-header">
          <div class="review-top-right">
            <span class="review-date">${date}</span>
          </div>
          <div class="review-user-info">
            <strong class="customer-name">${userName}</strong>
          </div>
        </div>

        <div class="review-stars">
          ${stars}
        </div>

        <p class="review-comment">${review.comment || ""}</p>

        <div class="review-footer">
          <span class="verified-purchase"><i class="fas fa-check-circle"></i> Verified Purchase</span>
        </div>
      `;

      reviewsContainer.appendChild(reviewEl);
    }
  } catch (error) {
    console.error("Failed to load reviews:", error);
    renderEmptyRatings();
    reviewsContainer.innerHTML = "<p>Failed to load reviews.</p>";
  }
}

// =====================================================
// RENDER RATINGS SUMMARY (Professional E-commerce Style)
// =====================================================

function renderRatingsSummary(averageRating, totalReviews, ratingCounts) {
  const avgRatingEl = document.getElementById("avgRating");
  const avgStarsEl = document.getElementById("avgStars");
  const totalRatingsEl = document.getElementById("totalRatings");
  const ratingDistEl = document.getElementById("ratingDistribution");

  // Update average rating number
  avgRatingEl.textContent = averageRating;

  // Generate star visualization
  const fullStars = Math.floor(averageRating);
  const hasHalfStar = averageRating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  let starsHtml = "";
  for (let i = 0; i < fullStars; i++) {
    starsHtml += '<i class="fas fa-star"></i>';
  }
  if (hasHalfStar) {
    starsHtml += '<i class="fas fa-star-half-alt"></i>';
  }
  for (let i = 0; i < emptyStars; i++) {
    starsHtml += '<i class="far fa-star"></i>';
  }
  avgStarsEl.innerHTML = starsHtml;

  // Update total ratings text
  totalRatingsEl.textContent = `${totalReviews} verified rating${totalReviews !== 1 ? "s" : ""}`;

  // Generate rating distribution bars
  let distributionHtml = "";
  for (let stars = 5; stars >= 1; stars--) {
    const count = ratingCounts[stars] || 0;
    const percentage =
      totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;

    distributionHtml += `
      <div class="rating-bar">
        <span>${stars} star${stars !== 1 ? "s" : ""}</span>
        <div class="bar">
          <div class="fill" style="width: ${percentage}%"></div>
        </div>
        <span>${percentage}%</span>
      </div>
    `;
  }
  ratingDistEl.innerHTML = distributionHtml;
}

// =====================================================
// RENDER EMPTY RATINGS STATE
// =====================================================

function renderEmptyRatings() {
  const avgRatingEl = document.getElementById("avgRating");
  const avgStarsEl = document.getElementById("avgStars");
  const totalRatingsEl = document.getElementById("totalRatings");
  const ratingDistEl = document.getElementById("ratingDistribution");

  avgRatingEl.textContent = "0";
  avgStarsEl.innerHTML =
    '<i class="far fa-star"></i><i class="far fa-star"></i><i class="far fa-star"></i><i class="far fa-star"></i><i class="far fa-star"></i>';
  totalRatingsEl.textContent = "No verified ratings yet";
  ratingDistEl.innerHTML = "";
}

// =====================================================
// RECENTLY VIEWED PRODUCTS (OPTIMIZED)
// =====================================================
// Previous version fetched products one by one.
// Now we fetch them in ONE Firestore query.

function updateRecentlyViewed(currentProductId) {
  let viewed = JSON.parse(localStorage.getItem("recentlyViewed")) || [];

  viewed = viewed.filter((id) => id !== currentProductId);

  viewed.unshift(currentProductId);

  if (viewed.length > 5) viewed = viewed.slice(0, 5);

  localStorage.setItem("recentlyViewed", JSON.stringify(viewed));

  renderRecentlyViewed(currentProductId, viewed);
}

async function renderRecentlyViewed(currentProductId, viewedIds) {
  const container = document.getElementById("recentlyViewedContainer");

  if (!container) return;

  container.innerHTML = "";

  const ids = viewedIds.filter((id) => id !== currentProductId);

  if (!ids.length) return;

  try {
    const productsQuery = query(
      collection(db, "products"),
      where("__name__", "in", ids),
    );

    const snap = await getDocs(productsQuery);

    snap.forEach((doc) => {
      const p = doc.data();
      const id = doc.id;

      const card = document.createElement("div");

      card.className =
        "recent-card flex-shrink-0 w-40 border rounded-lg p-2 hover:shadow-md cursor-pointer";

      card.innerHTML = `
        <img src="${p.images?.[0] || "img/products/default.jpg"}"
             class="w-full h-40 object-cover rounded"
             loading="lazy"/>

        <h4 class="text-sm font-semibold mt-2 truncate">${p.name}</h4>

        <p class="text-xs text-gray-500">${p.brand || ""}</p>

        <p class="text-sm font-bold mt-1">Ksh ${p.price}</p>
      `;

      card.onclick = () => {
        window.location.href = `product.html?id=${id}`;
      };

      container.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to fetch recently viewed:", err);
  }
}

// =====================================================
// AUTH STATE LISTENER
// =====================================================

onAuthStateChanged(auth, (user) => {
  window.currentUser = user || null;
  if (user) {
    console.log("User logged in:", user.uid);
  }
});

// =====================================================
// CART & WISHLIST KEYS
// =====================================================

function getCartKey() {
  return window.currentUser ? `cart_${window.currentUser.uid}` : "cart_guest";
}

function getWishlistKey() {
  return window.currentUser
    ? `wishlist_${window.currentUser.uid}`
    : "wishlist_guest";
}

// =====================================================
// TOAST NOTIFICATION
// =====================================================

function showToast(message) {
  // Remove existing toast if any
  const existingToast = document.querySelector(".toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add("show"), 150);

  // Remove after animation
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 2300);
  }, 2500);
}

// =====================================================
// ADD TO CART HANDLER
// =====================================================

function handleAddToCart() {
  if (!currentProductData) {
    showToast("Product not loaded yet. Please wait.");
    return;
  }

  // Get selected size
  const sizeSelect = sizeVariant.querySelector("select");
  const selectedSize = sizeSelect ? sizeSelect.value : "";

  // Get selected color
  const colorSelect = colorVariant.querySelector("select");
  const selectedColor = colorSelect ? colorSelect.value : "";

  // Check if size is required (if product has sizes)
  const hasSizes =
    currentProductData.sizes && currentProductData.sizes.length > 0;
  if (hasSizes && !selectedSize) {
    showToast("Please select a size");
    sizeSelect.focus();
    return;
  }

  // Check if color is required (if product has colors)
  const hasColors =
    currentProductData.colors && currentProductData.colors.length > 0;
  if (hasColors && !selectedColor) {
    showToast("Please select a color");
    colorSelect.focus();
    return;
  }

  // Get the first image
  const images = currentProductData.images || [];
  const productImageSrc =
    images.length > 0 ? images[0] : "img/products/default.jpg";

  // Create cart item
  const cartItem = {
    id: productId,
    name: currentProductData.name || "Unnamed Product",
    price: Number(currentProductData.price) || 0,
    img: productImageSrc,
    size: selectedSize,
    color: selectedColor,
    quantity: currentQuantity,
  };

  // Add to cart using localStorage directly
  const cartKey = getCartKey();
  let cart = JSON.parse(localStorage.getItem(cartKey)) || [];

  const existingIndex = cart.findIndex(
    (item) =>
      item.id === cartItem.id &&
      item.size === cartItem.size &&
      item.color === cartItem.color,
  );

  if (existingIndex >= 0) {
    cart[existingIndex].quantity += currentQuantity;
  } else {
    cart.push(cartItem);
  }

  localStorage.setItem(cartKey, JSON.stringify(cart));
  showToast(`${currentProductData.name} added to cart!`);

  // Update cart count in header
  const cartCountEl = document.querySelector(".cart-count");
  if (cartCountEl) {
    const total = cart.reduce((sum, item) => sum + item.quantity, 0);
    cartCountEl.textContent = total;
  }
}

// =====================================================
// BUY NOW HANDLER
// =====================================================

function handleBuyNow() {
  if (!currentProductData) {
    showToast("Product not loaded yet. Please wait.");
    return;
  }

  // Get selected size
  const sizeSelect = sizeVariant.querySelector("select");
  const selectedSize = sizeSelect ? sizeSelect.value : "";

  // Get selected color
  const colorSelect = colorVariant.querySelector("select");
  const selectedColor = colorSelect ? colorSelect.value : "";

  // Check if size is required
  const hasSizes =
    currentProductData.sizes && currentProductData.sizes.length > 0;
  if (hasSizes && !selectedSize) {
    showToast("Please select a size");
    sizeSelect.focus();
    return;
  }

  // Check if color is required
  const hasColors =
    currentProductData.colors && currentProductData.colors.length > 0;
  if (hasColors && !selectedColor) {
    showToast("Please select a color");
    colorSelect.focus();
    return;
  }

  // Get the first image
  const images = currentProductData.images || [];
  const productImageSrc =
    images.length > 0 ? images[0] : "img/products/default.jpg";

  // Create cart item
  const cartItem = {
    id: productId,
    name: currentProductData.name || "Unnamed Product",
    price: Number(currentProductData.price) || 0,
    img: productImageSrc,
    size: selectedSize,
    color: selectedColor,
    quantity: currentQuantity,
  };

  // Add to cart and redirect to checkout
  const cartKey = getCartKey();
  let cart = JSON.parse(localStorage.getItem(cartKey)) || [];

  const existingIndex = cart.findIndex(
    (item) =>
      item.id === cartItem.id &&
      item.size === cartItem.size &&
      item.color === cartItem.color,
  );

  if (existingIndex >= 0) {
    cart[existingIndex].quantity += currentQuantity;
  } else {
    cart.push(cartItem);
  }

  localStorage.setItem(cartKey, JSON.stringify(cart));

  // Calculate totals
  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const deliveryFee = 150;
  const total = subtotal + deliveryFee;

  // Store pending order
  const pendingOrder = {
    items: cart,
    subtotal,
    deliveryFee,
    total,
    createdAt: Date.now(),
    status: "CHECKOUT",
  };

  localStorage.setItem("pendingOrder", JSON.stringify(pendingOrder));

  // Redirect to checkout
  window.location.href = "checkout.html";
}

// =====================================================
// EVENT LISTENERS FOR CART BUTTONS
// =====================================================

// Add to Cart button
if (addToCartBtn) {
  addToCartBtn.addEventListener("click", handleAddToCart);
}

// Buy Now button
const buyNowBtn = document.querySelector(".buy-now");
if (buyNowBtn) {
  buyNowBtn.addEventListener("click", handleBuyNow);
}

// Wishlist button
if (addToWishlistBtn) {
  addToWishlistBtn.addEventListener("click", () => {
    if (!currentProductData) {
      showToast("Product not loaded yet. Please wait.");
      return;
    }

    const images = currentProductData.images || [];
    const productImageSrc =
      images.length > 0 ? images[0] : "img/products/default.jpg";
    const currentPrice = Number(currentProductData.price) || 0;
    const oldPriceValue = Number(currentProductData.oldPrice) || 0;
    const discountValue =
      oldPriceValue > currentPrice
        ? Math.floor(((oldPriceValue - currentPrice) / oldPriceValue) * 100)
        : 0;

    const wishlistItem = {
      id: productId,
      name: currentProductData.name || "Unnamed Product",
      price: currentPrice,
      oldPrice: oldPriceValue || null,
      discount: discountValue,
      img: productImageSrc,
    };

    // Get wishlist
    const wishlistKey = getWishlistKey();
    let wishlist = JSON.parse(localStorage.getItem(wishlistKey)) || [];

    const exists = wishlist.some((item) => item.id === wishlistItem.id);

    if (exists) {
      showToast(`${currentProductData.name} is already in your wishlist!`);
    } else {
      wishlist.push(wishlistItem);
      localStorage.setItem(wishlistKey, JSON.stringify(wishlist));
      showToast(`${currentProductData.name} added to wishlist!`);
    }
  });
}

// =====================================================
// UPDATE LOADPRODUCT TO STORE DATA
// =====================================================

// Store product data when loaded for use in cart functions
const originalLoadProduct = loadProduct;
loadProduct = function (product) {
  currentProductData = product;
  window.currentProductData = product;
  originalLoadProduct(product);
};
