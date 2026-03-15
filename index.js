// Dynamic Firebase Hero Carousel
// Step 4: Fetch top products → populate slides with real data + animations

import {
  auth,
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
} from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

// Slide categories mapping (matches data-product-category)
const SLIDE_CATEGORIES = [
  "watches",
  "hoodies",
  "caps",
  "shoes",
  "sneakers",
  "slides",
  "shirts",
  "t-shirts",
];

// Static images for carousel slides by category
const CATEGORY_IMAGES = {
  watches: "img/watches.jpg",
  hoodies: "img/hoodies.jpg",
  caps: "img/caps.jpg",
  shoes: "img/shoes.jpg",
  sneakers: "img/shoes1.jpg",
  slides: "img/slides.jpg",
  shirts: "img/shirts.jpg",
  "t-shirts": "img/t-shirts.jpg",
};

// ================= HELPERS (copied exactly from shop.js for identical cards) =================
function renderStars(rating = 0) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating))));
  return Array.from(
    { length: 5 },
    (_, i) => `<i class="fas fa-star${i < r ? "" : "-o"}"></i>`,
  ).join("");
}

function renderPrice(product) {
  const price = Number(product.price);
  const oldPrice = Number(product.oldPrice);

  if (Number.isFinite(oldPrice) && oldPrice > price && price > 0) {
    const discount = Math.floor(((oldPrice - price) / oldPrice) * 100);
    if (discount >= 1) {
      return `
        <div class="price-section">
          <div class="old-price">Ksh ${oldPrice}</div>
          <div class="discount">${discount}% OFF</div>
          <div class="current-price">Ksh ${price}</div>
        </div>
      `;
    }
  }

  return `<div class="current-price">Ksh ${price}</div>`;
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", initDynamicCarousel);

async function initDynamicCarousel() {
  console.log("🚀 Initializing Dynamic Hero Carousel...");

  // Show skeletons immediately
  showCarouselSkeletons();

  try {
    // Fetch top 8 products (best sellers)
    const products = await fetchHeroProducts();

    if (products.length === 0) {
      console.warn("No products found, using static fallback");
      hideSkeletons(); // Hide skeletons for static
      return;
    }

    // DISABLED: Keep static HTML text (per user request)
    // await populateCarouselSlides(products);

    // Start/enhance carousel animations after load
    enhanceCarouselAnimations();

    console.log(`✅ Loaded ${products.length}/8 dynamic products`);
  } catch (error) {
    console.error("❌ Carousel load failed:", error);
    // Fallback: hide skeletons (static content visible)
    hideSkeletons();
  }
}

// ================= FETCH PRODUCTS =================
async function fetchHeroProducts() {
  try {
    // Query: top 8 active products (newest/best sellers)
    const q = query(
      collection(db, "products"),
      where("isActive", "==", true),
      orderBy("createdAt", "desc"),
      limit(8),
    );

    const snapshot = await getDocs(q);
    let products = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(validateProduct);

    // Fallback sort by revenue if createdAt missing
    products.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

    return products.slice(0, 8);
  } catch (error) {
    console.error("Firebase fetch failed:", error);
    return [];
  }
}

// ================= POPULATE SLIDES =================
async function populateCarouselSlides(products) {
  const slides = document.querySelectorAll(".carousel-slide");

  slides.forEach((slide, index) => {
    const category = slide.dataset.productCategory;

    // Find best matching product by category
    const product =
      products.find(
        (p) =>
          p.category?.toLowerCase() === category ||
          p.name?.toLowerCase().includes(category),
      ) || products[index % products.length]; // Fallback to index

    if (product) {
      populateSlide(slide, product, category);
    }
  });

  // Smooth reveal after population
  await new Promise((resolve) => setTimeout(resolve, 300));
  hideSkeletons();

  // Preload all new images
  preloadSlideImages();
}

function populateSlide(slide, product, category) {
  const img = slide.querySelector("img");
  const headline = slide.querySelector(".overlay-headline");
  const sub = slide.querySelector(".overlay-sub");
  const shopBtns = slide.querySelectorAll(".cta-btn");

  // Use static category image first, fallback to product/dynamic
  const staticImg = CATEGORY_IMAGES[category] || slide.dataset.fallbackImg;
  const newImg = staticImg; // Prioritize static image
  if (img && newImg !== img.src) {
    img.src = newImg;
    img.alt = product?.name || category.toUpperCase();
  }

  // Update headline/subtitle
  if (headline)
    headline.textContent =
      product.name?.toUpperCase() || category.toUpperCase();
  if (sub)
    sub.textContent =
      product.description?.substring(0, 60) + "..." ||
      `${category.toUpperCase()} collection`;

  // Update CTAs with product/category links
  shopBtns.forEach((btn) => {
    if (btn.classList.contains("cta-btn")) {
      btn.href = `shop.html?category=${encodeURIComponent(product.category || category)}`;
    }
  });

  // Add loaded class for animations
  slide.classList.add("product-loaded");
}

// ================= SKELETONS =================
function showCarouselSkeletons() {
  document.querySelectorAll(".carousel-slide").forEach((slide) => {
    const skeleton = slide.querySelector(".carousel-skeleton");
    if (skeleton) skeleton.style.display = "block";
    slide.classList.add("loading");
  });
}

function hideSkeletons() {
  document.querySelectorAll(".carousel-slide").forEach((slide) => {
    const skeleton = slide.querySelector(".carousel-skeleton");
    if (skeleton) skeleton.style.display = "none";
    slide.classList.remove("loading");
    slide.classList.add("loaded");
  });
}

// ================= PRELOAD IMAGES =================
function preloadSlideImages() {
  const images = Array.from(document.querySelectorAll(".carousel-slide img"))
    .map((img) => img.src)
    .filter(Boolean);

  images.forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

// ================= ANIMATIONS =================
function enhanceCarouselAnimations() {
  const carousel = document.querySelector(".jumia-carousel");
  if (!carousel) return;

  // Fade-in on load animations
  document
    .querySelectorAll(".carousel-slide.product-loaded")
    .forEach((slide) => {
      setTimeout(() => (slide.style.opacity = "1"), 100);
    });
}

// ================= UTILS =================
function validateProduct(p) {
  return (
    p.id &&
    p.name &&
    Number.isFinite(Number(p.price)) &&
    Number(p.price) > 0 &&
    Array.isArray(p.images) &&
    p.images.length > 0
  );
}

// Identical product card creator (now matches shop.js exactly)
function createProductCard(product) {
  const image = product.images?.[0] || "img/placeholder.png";
  return `
    <div class="pro" data-id="${product.id}">
      <div class="img-wrapper">
        <img src="${image}" alt="${product.name}" loading="lazy"/>
        <i class="far fa-heart wishlist" data-name="${product.name}" data-price="${product.price}" data-img="${image}"></i>
      </div>
      <div class="des">
        <h5>${product.name}</h5>
        <span>${product.brand || product.category || ""}</span>
        <div class="star">${renderStars(product.rating)}</div>
        ${renderPrice(product)}
        <div class="Cart"><i class="fas fa-shopping-cart"></i></div>
      </div>
    </div>
  `;
}

function displayProducts(products, containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container missing: ${containerId}`);
    return;
  }
  container.innerHTML = products.map(createProductCard).join("");
}

// ================= REVIEW FUNCTIONS =================
// Function to open review modal for an order
async function openReviewModal(orderId) {
  try {
    const orderDoc = await getDoc(doc(db, "orders", orderId));
    if (!orderDoc.exists()) {
      alert("Order not found");
      return;
    }

    const order = orderDoc.data();
    const modalHeader = document.querySelector("#reviewModal .modal-header");
    const modalBody = document.querySelector("#reviewModal .modal-body");

    // Set header
    modalHeader.innerHTML = `
      <h2>Rate Your Purchase</h2>
      <p style="margin: 5px 0 0 0; font-size: 14px; color: #666;">Help others by sharing your experience</p>
    `;

    // Set body content
    modalBody.innerHTML = "";

    order.items.forEach((item, index) => {
      const itemDiv = document.createElement("div");
      itemDiv.className = "review-item";
      itemDiv.innerHTML = `
        <div class="product-info">
          <img src="${item.img}" alt="${item.name}" class="product-image">
          <div class="product-details">
            <h4>${item.name}</h4>
            <p>Size: ${item.size || "N/A"} | Qty: ${item.quantity}</p>
          </div>
        </div>
        <div class="rating-section">
          <label>Rating:</label>
          <div class="star-rating" data-index="${index}">
            <span class="star" data-value="1">★</span>
            <span class="star" data-value="2">★</span>
            <span class="star" data-value="3">★</span>
            <span class="star" data-value="4">★</span>
            <span class="star" data-value="5">★</span>
          </div>
          <input type="hidden" id="rating-${index}" value="0">
        </div>
        <div class="review-section">
          <label>Review (optional):</label>
          <textarea id="review-${index}" class="review-textarea" placeholder="Write your review..."></textarea>
        </div>
      `;
      modalBody.appendChild(itemDiv);

      // Add star click functionality
      const stars = itemDiv.querySelectorAll(".star");
      const ratingInput = itemDiv.querySelector(`#rating-${index}`);
      stars.forEach((star) => {
        star.addEventListener("click", () => {
          const value = parseInt(star.dataset.value);
          ratingInput.value = value;
          stars.forEach((s, i) => {
            if (i < value) {
              s.classList.add("selected");
            } else {
              s.classList.remove("selected");
            }
          });
        });
      });
    });

    // Add submit button
    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Submit Reviews";
    submitBtn.className = "btn-submit";
    submitBtn.onclick = () => submitReviews(orderId, order.items);
    modalBody.appendChild(submitBtn);

    document.getElementById("reviewModal").classList.add("show");
  } catch (error) {
    console.error("Error opening review modal:", error);
    alert("Error loading review form");
  }
}

// Function to check for pending reviews on delivered orders
async function checkForPendingReviews(uid) {
  try {
    console.log("Checking for pending reviews for user:", uid);

    // Get all delivered orders for the user
    const ordersQuery = query(
      collection(db, "orders"),
      where("userId", "==", uid),
      where("status", "==", "DELIVERED"),
    );
    const ordersSnap = await getDocs(ordersQuery);

    console.log("Found delivered orders:", ordersSnap.size);

    if (ordersSnap.empty) {
      console.log("No delivered orders found");
      return;
    }

    // Check if any of these orders have unreviewed items
    for (const orderDoc of ordersSnap.docs) {
      const order = orderDoc.data();
      const orderId = orderDoc.id;

      console.log("Checking order:", orderId, "status:", order.status);

      // Check if reviews already exist for this order
      const reviewsQuery = query(
        collection(db, "reviews"),
        where("userId", "==", uid),
        where("orderId", "==", orderId),
      );
      const reviewsSnap = await getDocs(reviewsQuery);

      console.log("Reviews for order", orderId, ":", reviewsSnap.size);

      // If no reviews exist for this order, show the review modal
      if (reviewsSnap.empty) {
        console.log("Opening review modal for order:", orderId);
        openReviewModal(orderId);
        break; // Only show one at a time
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

    // 🔥 Fetch user's full name from Firestore
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userName = userSnap.exists()
      ? userSnap.data().fullName || userSnap.data().name || "Verified Buyer"
      : "Verified Buyer";

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
        userName: userName, // ✅ SAFE + ALLOWED
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
    // User is logged in, check for pending reviews immediately
    setTimeout(() => checkForPendingReviews(user.uid), 1000); // Small delay to ensure page loads
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

  // Close modal when clicking outside
  window.onclick = (event) => {
    const modal = document.getElementById("reviewModal");
    if (event.target === modal) {
      modal.classList.remove("show");
    }
  };
});

// ================= MAIN PRODUCT LOAD =================
async function loadIndexProducts() {
  try {
    console.log("🏆 Loading index products...");

    const q = query(
      collection(db, "products"),
      where("isActive", "==", true),
      orderBy("createdAt", "desc"),
      limit(20),
    );

    const snapshot = await getDocs(q);
    let allProducts = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((p) => Number.isFinite(Number(p.price)) && p.price > 0);

    // Best selling (sort by revenue fallback to newest)
    const bestSelling = [...allProducts]
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0))
      .slice(0, 10);

    // New arrivals (newest)
    const newArrivals = allProducts.slice(0, 10);

    console.log(`🆕 Best: ${bestSelling.length}, New: ${newArrivals.length}`);

    // Preload images
    const allImages = [...bestSelling, ...newArrivals]
      .flatMap((p) => p.images || [])
      .filter(Boolean);
    allImages.forEach((src) => {
      new Image().src = src;
    });

    // Show content
    document.body.classList.remove("loading");

    // Display
    displayProducts(bestSelling, "bestSellingContainer");
    displayProducts(newArrivals, "newArrivalsContainer");
  } catch (err) {
    console.error("🔥 INDEX LOAD FAILED:", err);
    document.body.classList.remove("loading");
  }
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
  initDynamicCarousel();
  loadIndexProducts();
});
