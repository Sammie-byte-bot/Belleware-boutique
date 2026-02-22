// =======================
// FIREBASE SETUP
// =======================
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
  limit,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6UqMyedaoaXgqOeddQN47ADgP8joO364",
  authDomain: "bellewear-boutique.firebaseapp.com",
  projectId: "bellewear-boutique",
  storageBucket: "bellewear-boutique.firebasestorage.app",
  messagingSenderId: "795858464616",
  appId: "1:795858464616:web:0bbf307b3da145766ff0dd",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// =======================
// DOM ELEMENTS
// =======================
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

// =======================
// GET PRODUCT ID FROM URL
// =======================
const params = new URLSearchParams(window.location.search);
const productId = params.get("id");

if (!productId) {
  document.body.innerHTML = "<h2>Product not found</h2>";
  throw new Error("No product ID in URL");
}

// =======================
// SHOW LOADER
// =======================
function showProductLoader() {
  const loader = document.getElementById("productLoader");
  if (loader) {
    loader.style.display = "flex";
    document.body.classList.add("product-loading");
  }
}

function hideProductLoader() {
  const loader = document.getElementById("productLoader");
  if (loader) {
    loader.classList.add("fade-out");
    setTimeout(() => {
      loader.style.display = "none";
      document.body.classList.remove("product-loading");
    }, 500);
  }
}

// Show loader immediately
showProductLoader();

// =======================
// LOAD PRODUCT FROM FIRESTORE
// =======================
getDoc(doc(db, "products", productId))
  .then((docSnap) => {
    if (!docSnap.exists()) {
      document.body.innerHTML = "<h2>Product not found</h2>";
      hideProductLoader();
      return;
    }
    const product = docSnap.data();
    loadProduct(product);
    hideProductLoader();
  })
  .catch((err) => {
    console.error(err);
    alert("Failed to load product");
    hideProductLoader();
  });

// =======================
// LOAD PRODUCT FUNCTION
// =======================
function loadProduct(product) {
  // BASIC INFO
  productName.textContent = product.name || "No Name";
  productBrand.textContent = product.brand || "-";
  productPrice.textContent = `Ksh ${product.price || 0}`;
  productDescription.textContent = product.description || "";

  // OLD PRICE + DISCOUNT
  if (product.oldPrice && product.price) {
    productOldPrice.textContent = `Ksh ${product.oldPrice}`;
    productDiscount.textContent = `${Math.round(
      ((product.oldPrice - product.price) / product.oldPrice) * 100,
    )}% OFF`;
  } else {
    productOldPrice.textContent = "";
    productDiscount.textContent = "";
  }

  // STOCK WARNING
  if (product.stock !== undefined && product.stock <= 5) {
    stockWarning.textContent = `Only ${product.stock} left in stock`;
  } else {
    stockWarning.textContent = "";
  }

  // IMAGES
  const images =
    Array.isArray(product.images) && product.images.length
      ? product.images
      : ["img/products/default.jpg"];

  // Show skeleton loader
  const skeletonLoader = document.querySelector(".skeleton-loader");
  if (skeletonLoader) {
    skeletonLoader.style.display = "block";
  }

  productImage.onload = () => {
    // Hide skeleton loader when image loads
    if (skeletonLoader) {
      skeletonLoader.style.display = "none";
    }
  };

  productImage.src = images[0];
  thumbnails.innerHTML = "";
  images.forEach((img, i) => {
    const thumb = document.createElement("img");
    thumb.src = img;
    if (i === 0) thumb.classList.add("active");
    thumb.onclick = () => {
      // Show skeleton loader for thumbnail change
      if (skeletonLoader) {
        skeletonLoader.style.display = "block";
      }
      productImage.src = img;
      document
        .querySelectorAll(".thumbnails img")
        .forEach((t) => t.classList.remove("active"));
      thumb.classList.add("active");
    };
    thumbnails.appendChild(thumb);
  });

  // RATING
  productRating.innerHTML = "";
  const rating = product.rating || 0;
  for (let i = 0; i < rating; i++) {
    const star = document.createElement("i");
    star.className = "fas fa-star";
    productRating.appendChild(star);
  }

  // SIZES
  const sizeSelect = document.createElement("select");
  sizeSelect.innerHTML = `<option value="">Select size</option>`;
  (Array.isArray(product.sizes) ? product.sizes : []).forEach((size) => {
    sizeSelect.innerHTML += `<option value="${size}">${size}</option>`;
  });
  sizeVariant.innerHTML = "";
  sizeVariant.appendChild(sizeSelect);

  // COLORS
  const colorSelect = document.createElement("select");
  colorSelect.innerHTML = `<option value="">Select color</option>`;
  (Array.isArray(product.colors) ? product.colors : []).forEach((color) => {
    colorSelect.innerHTML += `<option value="${color}">${color}</option>`;
  });
  colorVariant.innerHTML = "";
  colorVariant.appendChild(colorSelect);

  // QUANTITY
  let qty = 1;
  quantityValue.textContent = qty;
  increaseQty.onclick = () => {
    qty++;
    quantityValue.textContent = qty;
  };
  decreaseQty.onclick = () => {
    if (qty > 1) qty--;
    quantityValue.textContent = qty;
  };

  // CART
  addToCartBtn.onclick = () => {
    if (!sizeSelect.value || !colorSelect.value) {
      alert("Select size & color");
      return;
    }
    const item = {
      id: productId,
      name: product.name,
      price: product.price,
      img: images[0],
      size: sizeSelect.value,
      color: colorSelect.value,
      quantity: qty,
    };
    // Use global addToCart from main.js
    if (typeof addToCart === "function") {
      addToCart(item);
    } else {
      // Fallback if main.js not loaded
      let cart = JSON.parse(localStorage.getItem(getCartKey())) || [];
      const existing = cart.find(
        (p) =>
          p.id === item.id && p.size === item.size && p.color === item.color,
      );
      if (existing) {
        existing.quantity += qty;
      } else {
        cart.push(item);
      }
      localStorage.setItem(getCartKey(), JSON.stringify(cart));
      if (cartCountEl) {
        const total = cart.reduce(
          (sum, item) => sum + (Number(item.quantity) || 0),
          0,
        );
        cartCountEl.textContent = total;
      }
      alert("Added to cart");
    }
  };

  // WISHLIST
  addToWishlistBtn.onclick = () => {
    // Use global addToWishlist from main.js
    if (typeof addToWishlist === "function") {
      addToWishlist(product);
    } else {
      // Fallback
      let wishlist = JSON.parse(localStorage.getItem(getWishlistKey())) || [];
      if (!wishlist.some((p) => p.id === productId)) {
        wishlist.push(product);
        localStorage.setItem(getWishlistKey(), JSON.stringify(wishlist));
        alert("Saved to wishlist");
      } else {
        alert("Already in wishlist");
      }
    }
  };

  // REVIEWS
  loadProductReviews(productId);
}

// =======================
// LOAD PRODUCT REVIEWS FUNCTION
// =======================
async function loadProductReviews(productId) {
  try {
    const reviewsQuery = query(
      collection(db, "reviews"),
      where("productId", "==", productId),
    );
    const reviewsSnap = await getDocs(reviewsQuery);

    const reviews = [];
    let totalRating = 0;
    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    reviewsSnap.forEach((doc) => {
      const review = doc.data();
      reviews.push(review);
      totalRating += review.rating || 0;
      ratingCounts[review.rating] = (ratingCounts[review.rating] || 0) + 1;
    });

    const avgRating =
      reviews.length > 0 ? (totalRating / reviews.length).toFixed(1) : 0;

    // Update overall rating
    document.getElementById("avgRating").textContent = avgRating;
    document.getElementById("totalRatings").textContent =
      `${reviews.length} verified ratings`;

    // Update reviews section header with count
    const reviewsHeader = document.querySelector(".reviews h3");
    if (reviewsHeader) {
      reviewsHeader.textContent = `Product Review (${reviews.length})`;
    }

    const avgStarsEl = document.getElementById("avgStars");
    avgStarsEl.innerHTML = "";
    const fullStars = Math.floor(avgRating);
    const hasHalf = avgRating % 1 >= 0.5;
    for (let i = 0; i < fullStars; i++) {
      const star = document.createElement("i");
      star.className = "fas fa-star";
      avgStarsEl.appendChild(star);
    }
    if (hasHalf) {
      const star = document.createElement("i");
      star.className = "fas fa-star-half-alt";
      avgStarsEl.appendChild(star);
    }
    for (let i = fullStars + (hasHalf ? 1 : 0); i < 5; i++) {
      const star = document.createElement("i");
      star.className = "far fa-star";
      avgStarsEl.appendChild(star);
    }

    // Rating distribution
    const distributionEl = document.getElementById("ratingDistribution");
    distributionEl.innerHTML = "";
    for (let star = 5; star >= 1; star--) {
      const count = ratingCounts[star];
      const percentage =
        reviews.length > 0 ? ((count / reviews.length) * 100).toFixed(0) : 0;
      const bar = document.createElement("div");
      bar.className = "rating-bar";
      const barWidth = count === 0 ? `${star * 20}%` : "100%";
      const fillWidth = count === 0 ? "0%" : `${percentage}%`;
      bar.innerHTML = `
        <span>${star} ★</span>
        <div class="bar" style="width: ${barWidth};">
          <div class="fill" style="width: ${fillWidth};"></div>
        </div>
        <span>${count}</span>
      `;
      distributionEl.appendChild(bar);
    }

    // Individual reviews
    reviewsContainer.innerHTML = "";
    if (reviews.length === 0) {
      reviewsContainer.innerHTML =
        "<p>No reviews yet. Be the first to review!</p>";
      return;
    }

    reviews.forEach(async (review) => {
      const reviewEl = document.createElement("div");
      reviewEl.className = "review-item";

      const date =
        review.createdAt?.toDate?.().toLocaleDateString() || "Unknown";

      // Fetch user name from auth or users collection
      let userName = "Verified Buyer";
      try {
        const userDoc = await getDoc(doc(db, "users", review.userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          userName = userData.displayName || userData.email || "Verified Buyer";
        }
      } catch (err) {
        console.error("Failed to fetch user name:", err);
      }

      reviewEl.innerHTML = `
    <p class="review-user">
      <strong>${userName}</strong>
      <span class="verified-badge">✔ Verified Buyer</span>
    </p>

    <div class="review-stars">
      ${Array.from({ length: 5 }, (_, i) =>
        i < review.rating ? "★" : "☆",
      ).join("")}
    </div>

    <p class="review-comment">${review.comment || ""}</p>

    <span class="review-date">${date}</span>
  `;

      reviewsContainer.appendChild(reviewEl);
    });
  } catch (error) {
    console.error("Failed to load reviews:", error);
    reviewsContainer.innerHTML = "<p>Failed to load reviews.</p>";
  }
}
// ================= REVIEW FUNCTIONS =================;
// Function to open review modal for an order

// Function to check for pending reviews on delivered orders
async function checkForPendingReviews(uid) {
  try {
    const ordersQuery = query(
      collection(db, "orders"),
      where("userId", "==", uid),
      where("status", "==", "DELIVERED"),
    );

    const ordersSnap = await getDocs(ordersQuery);
    if (ordersSnap.empty) return;

    for (const orderDoc of ordersSnap.docs) {
      const orderId = orderDoc.id;

      // Check if reviews already exist for this order
      const reviewsQuery = query(
        collection(db, "reviews"),
        where("userId", "==", uid),
        where("orderId", "==", orderId),
      );

      const reviewsSnap = await getDocs(reviewsQuery);

      if (reviewsSnap.empty) {
        openReviewModal(orderId);
        break;
      }
    }
  } catch (error) {
    console.error("Error checking for pending reviews:", error);
  }
}

// Function to submit reviews
async function submitReviews(orderId, items) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    for (let i = 0; i < items.length; i++) {
      const rating = document.getElementById(`rating-${i}`).value;
      const review = document.getElementById(`review-${i}`).value.trim();

      if (!rating) {
        alert(`Please select a rating for ${items[i].name}`);
        return;
      }

      await addDoc(collection(db, "reviews"), {
        productId: items[i].productId || items[i].id,
        userId: user.uid,
        fullName: user.displayName || user.email || "Anonymous",
        orderId: orderId,
        rating: parseInt(rating),
        comment: review,
        createdAt: serverTimestamp(),
      });
    }

    document.getElementById("reviewModal").classList.remove("show");
    alert("Reviews submitted successfully!");
  } catch (error) {
    console.error("Error submitting reviews:", error);
    alert("Error submitting reviews");
  }
}

// ================= AUTH CHECK =================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    setTimeout(() => checkForPendingReviews(user.uid), 1000);
  }
});

// ================= MODAL CLOSE =================
document.addEventListener("DOMContentLoaded", () => {
  const closeModal = document.getElementById("closeReviewModal");
  if (closeModal) {
    closeModal.onclick = () => {
      document.getElementById("reviewModal").classList.remove("show");
    };
  }

  window.onclick = (event) => {
    const modal = document.getElementById("reviewModal");
    if (event.target === modal) {
      modal.classList.remove("show");
    }
  };
});

// ================= INIT =================
// No init needed for product page

// =======================
// CART & WISHLIST KEYS
// =======================
function getCartKey() {
  return window.currentUser ? `cart_${window.currentUser.uid}` : "cart_guest";
}
function getWishlistKey() {
  return window.currentUser
    ? `wishlist_${window.currentUser.uid}`
    : "wishlist_guest";
}

/**
 * Load and render orders
 */
async function loadOrders() {
  const ordersContainer = document.getElementById("ordersContainer");

  try {
    ordersContainer.innerHTML = "<p>Loading orders...</p>";

    const ordersQuery = query(
      collection(db, "orders"),
      orderBy("createdAt", "desc"),
    );

    const ordersSnap = await getDocs(ordersQuery);

    ordersContainer.innerHTML = "";

    if (ordersSnap.empty) {
      ordersContainer.innerHTML = `
        <div class="no-orders">
          <p>No orders found.</p>
        </div>
      `;
      return;
    }

    ordersSnap.forEach((doc) => {
      const order = doc.data();
      const orderId = doc.id;

      const orderDate = order.createdAt?.toDate?.().toLocaleDateString() || "—";

      const isVerified = order.status === "DELIVERED";

      const orderDiv = document.createElement("div");
      orderDiv.className = "order-card";

      orderDiv.innerHTML = `
        <div class="order-header">
          <div class="order-customer">
            <span class="customer-name">
              ${order.fullName || "Customer"}
            </span>
            ${
              isVerified
                ? `<span class="verified-badge">✔ Verified Buyer</span>`
                : ""
            }
          </div>

          <span class="order-date">${orderDate}</span>
        </div>

        <div class="order-body">
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><strong>Status:</strong> ${order.status || "PENDING"}</p>
          <p><strong>Total:</strong> Ksh ${order.totalAmount || 0}</p>
        </div>
      `;

      ordersContainer.appendChild(orderDiv);
    });
  } catch (error) {
    console.error("Failed to load orders:", error);
    ordersContainer.innerHTML = `
      <div class="error-message">
        <p>Failed to load orders. Please try again.</p>
      </div>
    `;
  }
}

// =======================
// RECENTLY VIEWED PRODUCTS
// =======================
function updateRecentlyViewed(currentProductId) {
  let viewed = JSON.parse(localStorage.getItem("recentlyViewed")) || [];

  // Remove current product if already exists
  viewed = viewed.filter((id) => id !== currentProductId);
  // Add current product to the front
  viewed.unshift(currentProductId);
  // Limit to 5 products
  if (viewed.length > 5) viewed = viewed.slice(0, 5);

  localStorage.setItem("recentlyViewed", JSON.stringify(viewed));
  renderRecentlyViewed(currentProductId, viewed);
}

function renderRecentlyViewed(currentProductId, viewedIds) {
  const container = document.getElementById("recentlyViewedContainer");
  container.innerHTML = "";

  // Fetch all viewed product docs from Firestore
  viewedIds.forEach(async (id) => {
    if (id === currentProductId) return; // skip current product

    try {
      const docSnap = await getDoc(doc(db, "products", id));
      if (!docSnap.exists()) return;

      const p = docSnap.data();

      // Create card element
      const card = document.createElement("div");
      card.className =
        "recent-card flex-shrink-0 w-40 border rounded-lg p-2 hover:shadow-md cursor-pointer";

      card.innerHTML = `
        <img src="${
          p.images?.[0] || "img/products/default.jpg"
        }" class="w-full h-40 object-cover rounded"/>
        <h4 class="text-sm font-semibold mt-2 truncate">${p.name}</h4>
        <p class="text-xs text-gray-500">${p.brand || ""}</p>
        <p class="text-sm font-bold mt-1">Ksh ${p.price}</p>
      `;

      card.onclick = () => {
        window.location.href = `product.html?id=${id}`;
      };

      container.appendChild(card);
    } catch (err) {
      console.error("Failed to fetch recently viewed product:", err);
    }
  });
}

// Call it at the end of loadProduct
updateRecentlyViewed(productId);
