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
  startAfter,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// ================= VALIDATION =================
function validateProduct(p) {
  const errors = [];

  if (!p.id) errors.push("Missing ID");
  if (!p.name) errors.push("Missing name");

  const price = Number(p.price);
  if (!Number.isFinite(price) || price <= 0) errors.push("Invalid price");

  if (!Array.isArray(p.images) || !p.images.length) errors.push("No images");

  if (p.stock !== undefined && Number(p.stock) <= 0)
    errors.push("Out of stock");

  if (errors.length) {
    console.warn("❌ Invalid product skipped:", p.id, errors);
    return false;
  }

  return true;
}

// ================= HELPERS =================
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

// ================= CARD =================
function createProductCard(product) {
  const image =
    Array.isArray(product.images) && product.images.length
      ? product.images[0]
      : "img/placeholder.png";

  return `
    <div class="pro" data-id="${product.id}">
      <div class="img-wrapper">
        <img src="${image}" alt="${product.name}" loading="lazy" decoding="async"/>
        <i class="far fa-heart wishlist"
           data-name="${product.name}"
           data-price="${product.price}"
           data-img="${image}"></i>
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
document.addEventListener("click", (e) => {
  if (e.target.closest(".wishlist")) return;

  const card = e.target.closest(".pro");
  if (!card) return;

  const productId = card.dataset.id;
  if (productId) {
    window.location.href = `product.html?id=${productId}`;
  }
});

// ================= STATE =================
let allProducts = [];
let filteredProducts = [];
let currentSearchQuery = "";

let lastVisibleDoc = null;
let isLoading = false;
let hasMoreProducts = true;

// ================= FETCH WITH PAGINATION =================
async function loadProducts(initial = true) {
  if (isLoading || !hasMoreProducts) return;
  isLoading = true;

  const grid = document.getElementById("productsGrid");
  const empty = document.getElementById("emptyProducts");
  const error = document.getElementById("errorProducts");

  try {
    empty.hidden = true;
    error.hidden = true;

    const constraints = [
      where("isActive", "==", true),
      orderBy("createdAt", "desc"),
      limit(12),
    ];

    if (!initial && lastVisibleDoc) {
      constraints.push(startAfter(lastVisibleDoc));
    }

    const q = query(collection(db, "products"), ...constraints);
    const snap = await getDocs(q);

    if (snap.empty) {
      hasMoreProducts = false;
      document.getElementById("loadMoreBtn")?.remove();
      return;
    }

    lastVisibleDoc = snap.docs[snap.docs.length - 1];

    const newProducts = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(validateProduct);

    if (initial) {
      allProducts = newProducts;
      grid.innerHTML = newProducts.map(createProductCard).join("");
      // Populate filters with product data
      populateFilters(allProducts);
    } else {
      allProducts = [...allProducts, ...newProducts];
      grid.insertAdjacentHTML(
        "beforeend",
        newProducts.map(createProductCard).join(""),
      );
    }

    if (!allProducts.length) {
      empty.hidden = false;
    }
  } catch (err) {
    console.error("🔥 SHOP LOAD ERROR:", err);
    error.hidden = false;
  }

  isLoading = false;
}

// ================= DISPLAY =================
function displayProducts(products) {
  const grid = document.getElementById("productsGrid");
  const empty = document.getElementById("emptyProducts");

  if (!products.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  grid.innerHTML = products.map(createProductCard).join("");
}

// ================= APPLY FILTERS =================
function applyFilters() {
  const selectedCategories = [
    ...document.querySelectorAll("#filter-category input:checked"),
  ].map((i) => i.value);

  const selectedBrands = [
    ...document.querySelectorAll("#filter-brand input:checked"),
  ].map((i) => i.value);

  const selectedSizes = [
    ...document.querySelectorAll("#filter-sizes input:checked"),
  ].map((i) => i.value);

  const priceMin = Number(document.getElementById("price-min").value) || 0;
  const priceMax =
    Number(document.getElementById("price-max").value) || Infinity;

  filteredProducts = allProducts.filter((p) => {
    const price = Number(p.price);
    if (!Number.isFinite(price)) return false;
    if (price < priceMin || price > priceMax) return false;

    if (selectedCategories.length && !selectedCategories.includes(p.category))
      return false;

    if (selectedBrands.length && !selectedBrands.includes(p.brand))
      return false;

    if (
      selectedSizes.length &&
      (!Array.isArray(p.sizes) ||
        !p.sizes.some((s) => selectedSizes.includes(s)))
    )
      return false;

    return true;
  });

  displayProducts(filteredProducts);
}

// ================= POPULATE FILTERS =================
function populateFilters(products) {
  // Extract unique categories
  const categories = [
    ...new Set(products.map((p) => p.category).filter(Boolean)),
  ];

  // Extract unique brands
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))];

  // Populate Category filter
  const categoryContainer = document.getElementById("filter-category");
  if (categoryContainer) {
    categoryContainer.innerHTML = categories
      .map(
        (category) => `
      <label class="flex items-center gap-2 cursor-pointer py-1.5 hover:text-[#088178]">
        <input type="checkbox" value="${category}" class="w-4 h-4 text-[#088178] rounded border-gray-300 focus:ring-[#088178]" />
        <span class="text-sm text-gray-700">${category}</span>
      </label>
    `,
      )
      .join("");
  }

  // Populate Brand filter
  const brandContainer = document.getElementById("filter-brand");
  if (brandContainer) {
    brandContainer.innerHTML = brands
      .map(
        (brand) => `
      <label class="flex items-center gap-2 cursor-pointer py-1.5 hover:text-[#088178]">
        <input type="checkbox" value="${brand}" class="w-4 h-4 text-[#088178] rounded border-gray-300 focus:ring-[#088178]" />
        <span class="text-sm text-gray-700">${brand}</span>
      </label>
    `,
      )
      .join("");
  }
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
  loadProducts();

  document
    .getElementById("loadMoreBtn")
    ?.addEventListener("click", () => loadProducts(false));

  document
    .getElementById("apply-price-filter")
    ?.addEventListener("click", applyFilters);

  document.addEventListener("change", (e) => {
    if (
      e.target.closest("#filter-category") ||
      e.target.closest("#filter-brand") ||
      e.target.closest("#filter-sizes")
    ) {
      applyFilters();
    }
  });

  const clearBtn = document.getElementById("clear-all-filters");

  clearBtn.addEventListener("click", () => {
    // 1️⃣ Uncheck all checkboxes
    document
      .querySelectorAll(
        "#filter-category input, #filter-brand input, #filter-sizes input",
      )
      .forEach((input) => {
        input.checked = false;
      });

    // 2️⃣ Reset price inputs
    const priceMinInput = document.getElementById("price-min");
    const priceMaxInput = document.getElementById("price-max");

    if (priceMinInput) priceMinInput.value = "";
    if (priceMaxInput) priceMaxInput.value = "";

    // 3️⃣ Reset filtered products
    filteredProducts = [...allProducts];

    // 4️⃣ Re-display products
    displayProducts(filteredProducts);

    // 5️⃣ Restore pagination button
    const loadMoreBtn = document.getElementById("loadMoreBtn");
    if (loadMoreBtn) loadMoreBtn.classList.remove("hidden");
  });
});

// Hide pagination when filters are active
const loadBtn = document.getElementById("loadMoreBtn");

if (
  selectedCategories.length ||
  selectedBrands.length ||
  selectedSizes.length ||
  priceMin > 0 ||
  priceMax < Infinity
) {
  loadBtn?.classList.add("hidden");
} else {
  loadBtn?.classList.remove("hidden");
}
