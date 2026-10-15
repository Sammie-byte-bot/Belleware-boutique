import { initReviewPopup } from "./reviews.js";

import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  updateProfile,
  signOut,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   FIREBASE CONFIG
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyD6UqMyedaoaXgqOeddQN47ADgP8joO364",
  authDomain: "bellewear-boutique.firebaseapp.com",
  projectId: "bellewear-boutique",
  storageBucket: "bellewear-boutique.firebasestorage.app",
  messagingSenderId: "795858464616",
  appId: "1:795858464616:web:0bbf307b3da145766ff0dd",
};

/* =========================
   INIT
========================= */
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================
   DOM ELEMENTS
========================= */
const nameEl = document.querySelector(".profile-info h2");
const emailEl = document.querySelector(".profile-info p:nth-of-type(1)");
const phoneEl = document.querySelector(".profile-info p:nth-of-type(2)");
const editBtn = document.querySelector(".btn-blue");
const logoutBtn = document.querySelector("#logoutBtn");

const ordersCount = document.getElementById("ordersCount");

const addressesList = document.getElementById("addressesList");
const addressesCount = document.getElementById("addressesCount");

const wishlistList = document.getElementById("wishlistList");

let currentUser = null;

/* =========================
   AUTH GUARD
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  currentUser = user;

  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      throw new Error("User profile missing in Firestore");
    }

    const data = snap.data();

    nameEl.textContent = data.fullName || "User";
    emailEl.textContent = data.email || user.email;
    phoneEl.textContent = data.phone || "No phone added";

    // FETCH DATA AFTER AUTH SUCCESS
    fetchOrders(user.uid);
    fetchAddresses(user.uid);
    fetchWishlist(user.uid);

    // Check for pending reviews on delivered orders
    checkForPendingReviews(user.uid);
  } catch (err) {
    console.error(err);
    alert("Error loading account data");
  }
});

/* =========================
   FETCH ORDERS
========================= */
async function fetchOrders(uid) {
  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
  );

  const snap = await getDocs(q);

  ordersCount.textContent = snap.size;

  if (snap.empty) {
    ordersList.innerHTML = "<div>No recent orders found.</div>";
    return;
  }

  ordersList.innerHTML = "";

  snap.forEach((doc) => {
    const order = doc.data();
    ordersList.innerHTML += `
      <div>
        <strong>Order ID:</strong> ${doc.id}<br/>
        <strong>Status:</strong> ${order.status || "Pending"}<br/>
        <strong>Total:</strong> KES ${order.total || 0}
      </div>
      <hr/>
    `;
  });
}

/* =========================
   FETCH ADDRESSES
========================= */
async function fetchAddresses(uid) {
  const addrRef = collection(db, "users", uid, "addresses");
  const snap = await getDocs(addrRef);

  addressesCount.textContent = snap.size;

  if (snap.empty) {
    addressesList.innerHTML = "<div>No saved addresses found.</div>";
    return;
  }

  addressesList.innerHTML = "";

  snap.forEach((doc) => {
    const addr = doc.data();
    addressesList.innerHTML += `
      <div>
        <strong>${addr.label || "Address"}</strong><br/>
        ${addr.street || ""} ${addr.city || ""} ${addr.country || ""}
      </div>
      <hr/>
    `;
  });
}

/* =========================
   FETCH WISHLIST
========================= */
async function fetchWishlist(uid) {
  const wishRef = collection(db, "wishlists", uid, "items");
  const snap = await getDocs(wishRef);

  if (snap.empty) {
    wishlistList.innerHTML = "<div>No wishlist items found.</div>";
    return;
  }

  wishlistList.innerHTML = "";

  snap.forEach((doc) => {
    const item = doc.data();
    wishlistList.innerHTML += `
      <div>
        <strong>${item.name || "Item"}</strong> - KES ${item.price || 0}
      </div>
      <hr/>
    `;
  });
}

/* =========================
   EDIT PROFILE
========================= */
editBtn.addEventListener("click", async () => {
  const newName = prompt("Enter full name:", nameEl.textContent);
  const newPhone = prompt("Enter phone number:", phoneEl.textContent);

  if (!newName) return;

  const user = auth.currentUser;
  if (!user) return;

  try {
    await updateProfile(user, { displayName: newName });

    await updateDoc(doc(db, "users", user.uid), {
      fullName: newName,
      phone: newPhone || "",
    });

    nameEl.textContent = newName;
    phoneEl.textContent = newPhone || "No phone added";

    alert("Profile updated successfully");
  } catch (err) {
    console.error(err);
    alert("Failed to update profile");
  }
});

/* =========================
   LOGOUT
========================= */
logoutBtn.addEventListener("click", logoutUser);

function logoutUser() {
  signOut(auth)
    .then(() => {
      localStorage.clear();
      window.location.href = "auth.html";
    })
    .catch((err) => {
      console.error(err);
      alert("Logout failed");
    });
}

// ORDERS FETCH & DISPLAY
const ordersList = document.getElementById("orders-list");

let selectedOrderId = null;
const cancelModal = document.getElementById("cancelModal");
const cancelReason = document.getElementById("cancelReason");
const closeModal = document.getElementById("closeModal");
const submitCancel = document.getElementById("submitCancel");

closeModal.onclick = () => {
  cancelModal.style.display = "none";
  cancelReason.value = "";
};

submitCancel.onclick = async () => {
  const reason = cancelReason.value.trim();
  if (!reason) return alert("Please enter a reason.");

  await updateDoc(doc(db, "orders", selectedOrderId), {
    status: "CANCELLED",
    cancelReason: reason,
    canceledAt: serverTimestamp(),
  });

  cancelModal.style.display = "none";
  cancelReason.value = "";
  showSection("section-orders"); // no reload
};

async function fetchOrders(uid) {
  const q = query(
    collection(db, "orders"),
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
  );

  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    ordersList.innerHTML = "<p>No orders yet.</p>";
    return;
  }

  ordersList.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const order = docSnap.data();
    const orderId = docSnap.id;

    const orderDate =
      order.createdAt?.toDate?.()?.toDateString() || "Unknown date";

    const deliveryDate = order.deliveryDate
      ? order.deliveryDate.toDate().toDateString()
      : "Not set";

    const card = document.createElement("div");
    card.className = "order-card";

    const shortId = orderId.slice(-5).toUpperCase();

    card.innerHTML = `
      <div class="order-header">
        <div>
          <div class="order-ref">#${shortId}</div>
          <div class="order-date">Order Placed: ${orderDate}</div>
        </div>
        <button class="track-btn">TRACK ORDER</button>
      </div>

      <div class="order-items">
        ${order.items
          .map(
            (item) => `
              <div class="item-row">
                <img src="${item.img}" />
                <div class="item-details">
                  ${item.name}
                  <small>By: ${item.brand || "Unknown"}</small>
                  <small>Size: ${item.size || "N/A"} | Qty: ${item.quantity}</small>
                </div>
                <div>
                  <span class="status-badge status-${order.status}">
                    ${order.status}
                  </span>
                </div>
                <div class="delivery">
                  Delivery Expected by:
                  <small>${deliveryDate}</small>
                </div>
              </div>
            `,
          )
          .join("")}

        <div class="order-footer">
          <button class="cancel-btn" ${order.status === "DELIVERED" || order.status === "CANCELLED" ? "disabled" : ""}>
            × Cancel Order
          </button>
          <div class="total">KES ${order.total}</div>
        </div>
      </div>
    `;

    const cancelBtn = card.querySelector(".cancel-btn");
    cancelBtn.onclick = () => {
      selectedOrderId = orderId;
      cancelModal.style.display = "flex";
    };

    ordersList.appendChild(card);
  });
}

const links = document.querySelectorAll(".sidebar-link");
const sections = document.querySelectorAll(".content-section");

function showSection(id) {
  sections.forEach((sec) => sec.classList.remove("active"));
  links.forEach((link) => link.classList.remove("active"));

  document.getElementById(id).classList.add("active");
  document.querySelector(`a[href="#${id}"]`).classList.add("active");
}

links.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const id = link.getAttribute("href").replace("#", "");
    showSection(id);
  });
});

window.addEventListener("load", () => {
  const hash = window.location.hash.replace("#", "") || "account";
  showSection(hash);
});

import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const messagesRef = collection(db, "messages");

onAuthStateChanged(auth, (user) => {
  if (!user) return;

  const q = query(
    messagesRef,
    where("userId", "==", user.uid),
    orderBy("createdAt", "desc"),
  );

  onSnapshot(q, (snapshot) => {
    const container = document.getElementById("messagesContainer");
    container.innerHTML = "";

    snapshot.forEach((doc) => {
      const msg = doc.data();
      const messageDiv = document.createElement("div");
      messageDiv.className = "message";
      messageDiv.innerHTML = `
        <h3>${msg.title}</h3>
        <p>${msg.body}</p>
        <small>${new Date(msg.createdAt.seconds * 1000).toLocaleString()}</small>
      `;

      // If it's a delivery message, add a review button
      if (msg.type === "ORDER_DELIVERED") {
        const reviewBtn = document.createElement("button");
        reviewBtn.textContent = "Leave a Review";
        reviewBtn.className = "btn-blue";
        reviewBtn.style.marginTop = "10px";
        reviewBtn.onclick = () => openReviewModal(msg.orderId);
        messageDiv.appendChild(reviewBtn);
      }

      container.appendChild(messageDiv);
    });
  });
});

// Function to open review modal for an order
async function openReviewModal(orderId) {
  try {
    const orderDoc = await getDoc(doc(db, "orders", orderId));
    if (!orderDoc.exists()) {
      alert("Order not found");
      return;
    }

    const order = orderDoc.data();
    const reviewItems = document.getElementById("reviewItems");
    reviewItems.innerHTML = "";

    order.items.forEach((item, index) => {
      const itemDiv = document.createElement("div");
      itemDiv.className = "review-item";
      itemDiv.style.marginBottom = "20px";
      itemDiv.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 10px;">
          <img src="${item.img}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px; margin-right: 10px;">
          <div>
            <h4 style="margin: 0; font-size: 16px;">${item.name}</h4>
            <p style="margin: 0; color: #666; font-size: 14px;">Size: ${item.size || "N/A"} | Qty: ${item.quantity}</p>
          </div>
        </div>
        <div style="margin-bottom: 10px;">
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Rating:</label>
          <select id="rating-${index}" style="padding: 5px; border: 1px solid #ddd; border-radius: 4px;">
            <option value="">Select rating</option>
            <option value="5">★★★★★ (5)</option>
            <option value="4">★★★★☆ (4)</option>
            <option value="3">★★★☆☆ (3)</option>
            <option value="2">★★☆☆☆ (2)</option>
            <option value="1">★☆☆☆☆ (1)</option>
          </select>
        </div>
        <div>
          <label style="display: block; margin-bottom: 5px; font-weight: bold;">Review (optional):</label>
          <textarea id="review-${index}" placeholder="Write your review..." style="width: 100%; height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
        </div>
      `;
      reviewItems.appendChild(itemDiv);
    });

    // Add submit button
    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Submit Reviews";
    submitBtn.className = "btn-submit";
    submitBtn.style.marginTop = "20px";
    submitBtn.onclick = () => submitReviews(orderId, order.items);
    reviewItems.appendChild(submitBtn);

    document.getElementById("reviewModal").style.display = "flex";
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
        orderId: orderId,
        rating: parseInt(rating),
        comment: review,
        createdAt: serverTimestamp(),
      });
    }

    document.getElementById("reviewModal").style.display = "none";
    alert("Reviews submitted successfully!");
  } catch (error) {
    console.error("Error submitting reviews:", error);
    alert("Error submitting reviews");
  }
}

initReviewPopup();
