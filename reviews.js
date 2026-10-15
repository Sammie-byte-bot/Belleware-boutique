// reviews.js
import { auth, db } from "./firebase.js";

import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/**
 * Check if user can review a product
 * Returns orderId if allowed, otherwise null
 */
async function getReviewEligibility(userId, productId) {
  const ordersRef = collection(db, "orders");

  const q = query(
    ordersRef,
    where("userId", "==", userId),
    where("status", "==", "DELIVERED"),
  );

  const ordersSnap = await getDocs(q);

  for (const orderDoc of ordersSnap.docs) {
    const orderData = orderDoc.data();
    const items = orderData.items || [];

    const bought = items.some((item) => item.productId === productId);

    if (!bought) continue;

    // Check if already reviewed
    const reviewsRef = collection(db, "reviews");
    const reviewQ = query(
      reviewsRef,
      where("orderId", "==", orderDoc.id),
      where("productId", "==", productId),
    );

    const reviewSnap = await getDocs(reviewQ);
    if (reviewSnap.empty) {
      return orderDoc.id;
    }
  }

  return null;
}

/**
 * Initialize reviews on product page
 */
export function initReviews(productId) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const orderId = await getReviewEligibility(user.uid, productId);
    if (!orderId) return;

    renderReviewButton(orderId, productId);
  });
}

/**
 * Render review button
 */
function renderReviewButton(orderId, productId) {
  if (document.getElementById("review-btn")) return;

  const btn = document.createElement("button");
  btn.id = "review-btn";
  btn.textContent = "⭐ Leave a Review";
  btn.className = "review-btn";

  btn.addEventListener("click", () => {
    openReviewModal(orderId, productId);
  });

  document.body.appendChild(btn);
}

/**
 * Review modal UI (Jumia style)
 */
function openReviewModal(orderId, productId) {
  // create blur overlay
  const overlay = document.createElement("div");
  overlay.id = "review-overlay";
  overlay.className = "review-overlay";

  overlay.innerHTML = `
    <div class="review-modal">
      <div class="review-header">
        <h3>Write a review</h3>
        <button id="close-review" class="close-btn">×</button>
      </div>

      <div class="review-stars">
        <span class="star" data-value="1">★</span>
        <span class="star" data-value="2">★</span>
        <span class="star" data-value="3">★</span>
        <span class="star" data-value="4">★</span>
        <span class="star" data-value="5">★</span>
      </div>

      <textarea id="review-comment" placeholder="Write your review..."></textarea>

      <button id="submit-review" class="submit-btn">Submit review</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // close
  document.getElementById("close-review").onclick = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // star rating
  const stars = overlay.querySelectorAll(".star");
  stars.forEach((star) => {
    star.addEventListener("click", () => {
      const value = Number(star.dataset.value);
      stars.forEach((s) => s.classList.remove("active"));
      for (let i = 0; i < value; i++) {
        stars[i].classList.add("active");
      }
      overlay.dataset.rating = value;
    });
  });

  document.getElementById("submit-review").onclick = () =>
    submitReview(orderId, productId, overlay);
}

/**
 * Submit review to Firestore
 */
async function submitReview(orderId, productId, overlay) {
  try {
    const rating = Number(overlay.dataset.rating);
    const comment = overlay.querySelector("#review-comment").value.trim();

    if (!rating || rating < 1 || rating > 5) {
      alert("Please select a rating");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert("Please sign in to submit a review");
      return;
    }

    // Get user's name or email for the review
    const userName = user.email
      ? user.email.split("@")[0].trim()
      : "Verified Buyer";

    const reviewData = {
      productId: productId,
      userId: user.uid,
      userName: userName,
      orderId: orderId,
      rating: rating,
      comment: comment,
      createdAt: serverTimestamp(),
    };

    await addDoc(collection(db, "reviews"), reviewData);

    overlay.remove();
    document.getElementById("review-btn")?.remove();

    alert("Review submitted successfully!");

    // Reload the page to show the new review
    location.reload();
  } catch (error) {
    console.error("Error submitting review:", error);
    alert("Failed to submit review: " + error.message);
  }
}
