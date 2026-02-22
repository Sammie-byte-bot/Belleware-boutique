// ================= FIREBASE =================
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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

// ================= VALIDATION =================
function validateProduct(p) {
  if (!p?.id) return false;
  if (!p.name) return false;

  const price = Number(p.price);
  if (!Number.isFinite(price) || price <= 0) return false;

  if (!Array.isArray(p.images) || !p.images.length) return false;

  return true;
}

// ================= UI HELPERS =================
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

  if (Number.isFinite(oldPrice) && oldPrice > price) {
    const discount = Math.floor(((oldPrice - price) / oldPrice) * 100);
    if (discount >= 1) {
      return `
        <div class="price-row">
          <div class="old-price">Ksh ${oldPrice}</div>
          <div class="discount-badge"><i class="fas fa-tag"></i><span class="discount-percent">${discount}%</span></div>
          <div class="current-price">Ksh ${price}</div>
        </div>
      `;
    }
  }

  return `<h4>Ksh ${price}</h4>`;
}

// ================= PRODUCT CARD =================
function createProductCard(product) {
  const image =
    Array.isArray(product.images) && product.images.length
      ? product.images[0]
      : "img/placeholder.png";

  return `
    <div class="pro" data-id="${product.id}">
      <div class="img-wrapper">
        <img src="${image}" alt="${product.name}" />
        <i class="far fa-heart wishlist" data-name="${product.name}" data-price="${product.price}" data-img="${product.images ? product.images[0] : "img/placeholder.png"}"></i>
      </div>

      <div class="des">
        <h5>${product.name}</h5>
        <span>${product.brand || ""}</span>

        <div class="star">
          ${renderStars(product.rating)}
        </div>

        ${renderPrice(product)}
      </div>
    </div>
  `;
}

// ================= NAVIGATION =================
// Only handle click if not clicking on an anchor tag (let native anchor navigation work)
document.addEventListener("click", (e) => {
  // If clicking on an anchor tag, let the browser handle it natively
  if (e.target.closest("a")) return;

  const card = e.target.closest(".pro");
  if (!card) return;

  e.preventDefault(); // Prevent default navigation

  const productId = card.dataset.id;
  window.location.href = `product.html?id=${productId}`;
});

// ================= PRELOAD IMAGES =================
function preloadImages(images) {
  return Promise.allSettled(
    images.map((src) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(src);
        img.onerror = () => reject(src);
        img.src = src;
      });
    }),
  );
}

// ================= LOAD PRODUCTS =================
async function loadProducts() {
  try {
    console.log("🚀 Starting product load...");

    // ---------- 1️⃣ LOAD ALL ACTIVE PRODUCTS ----------
    console.log("📦 Loading products from Firestore...");
    const productsSnap = await getDocs(
      query(collection(db, "products"), where("isActive", "==", true)),
    );

    console.log("📦 Found", productsSnap.size, "product documents");

    const productsMap = new Map();

    productsSnap.forEach((doc) => {
      const product = { id: doc.id, ...doc.data() };
      if (validateProduct(product)) {
        productsMap.set(product.id, product);
      }
    });

    console.log("✅ Valid products:", productsMap.size);

    // ---------- 2️⃣ LOAD BEST SELLING (FROM ADMIN SYNC) ----------
    console.log("🏆 Loading best selling stats...");
    const statsSnap = await getDocs(
      query(
        collection(db, "productStats"),
        orderBy("revenue", "desc"),
        limit(8),
      ),
    );

    console.log("🏆 Found", statsSnap.size, "stats documents");

    const bestSelling = [];

    statsSnap.forEach((statDoc) => {
      const product = productsMap.get(statDoc.id);
      if (product) bestSelling.push(product);
    });

    // ---------- 3️⃣ NEW ARRIVALS ----------
    const newArrivals = [...productsMap.values()]
      .sort(
        (a, b) =>
          (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0),
      )
      .slice(0, 10);

    console.log(
      "🆕 Best selling:",
      bestSelling.length,
      "New arrivals:",
      newArrivals.length,
    );

    // ---------- 4️⃣ PRELOAD ALL IMAGES ----------
    const allImages = [...bestSelling, ...newArrivals]
      .flatMap((p) => p.images || [])
      .filter(Boolean);

    console.log("🖼️ Preloading", allImages.length, "images...");

    if (allImages.length > 0) {
      await preloadImages(allImages);
      console.log("✅ Images preloaded");
    }

    // ---------- 5️⃣ SHOW CONTENT ----------
    console.log("🎭 Showing content...");
    document.body.classList.remove("loading");
    console.log("✅ Content visible");

    // ---------- 6️⃣ RENDER PRODUCTS ----------
    displayProducts(bestSelling, "bestSellingContainer");
    displayProducts(newArrivals, "newArrivalsContainer");

    console.log("✅ Products rendered successfully");
  } catch (err) {
    console.error("🔥 INDEX LOAD FAILED:", err);
    // Show content even on error
    document.body.classList.remove("loading");
  }
}

// ================= DISPLAY =================
function displayProducts(products, containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Missing container: ${containerId}`);
    return;
  }

  container.innerHTML = "";

  products.forEach((p) => {
    container.insertAdjacentHTML("beforeend", createProductCard(p));
  });
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

// ================= INIT =================
document.addEventListener("DOMContentLoaded", loadProducts);
