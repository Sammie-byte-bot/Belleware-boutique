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
document.addEventListener("click", (e) => {
  if (e.target.closest(".wishlist")) return; // allow wishlist click without navigation

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

// ================= FETCH =================
async function loadProducts() {
  const grid = document.getElementById("productsGrid");
  const empty = document.getElementById("emptyProducts");
  const error = document.getElementById("errorProducts");

  try {
    empty.hidden = true;
    error.hidden = true;

    const q = query(
      collection(db, "products"),
      where("isActive", "==", true),
      orderBy("createdAt", "desc"),
    );

    const snap = await getDocs(q);
    allProducts = [];

    snap.forEach((doc) => {
      const product = { id: doc.id, ...doc.data() };
      if (validateProduct(product)) {
        allProducts.push(product);
      }
    });

    window.allProducts = allProducts;

    // Handle category filter from URL
    const urlParams = new URLSearchParams(window.location.search);
    const categoryFilter = urlParams.get("category");
    const searchQuery = urlParams.get("q");

    // Apply search filter if present
    if (searchQuery) {
      currentSearchQuery = searchQuery;
      const searchTerm = searchQuery.toLowerCase();
      allProducts = allProducts.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const brand = (p.brand || "").toLowerCase();
        const description = (p.description || "").toLowerCase();
        const category = (p.category || "").toLowerCase();
        return (
          name.includes(searchTerm) ||
          brand.includes(searchTerm) ||
          description.includes(searchTerm) ||
          category.includes(searchTerm)
        );
      });
      displaySearchInfo(allProducts, searchQuery);
    }

    if (categoryFilter) {
      allProducts = allProducts.filter((p) => p.category === categoryFilter);
    }

    populateFilters(allProducts);
    displayProducts(allProducts);
  } catch (err) {
    console.error("🔥 SHOP LOAD ERROR:", err);
    error.hidden = false;
  }
}

// ================= DISPLAY SEARCH INFO =================
function displaySearchInfo(products, searchQuery) {
  // Remove existing search info if present
  const existingInfo = document.querySelector(".search-results-info");
  if (existingInfo) {
    existingInfo.remove();
  }

  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  const info = document.createElement("div");
  info.className = "search-results-info";
  const resultText = products.length !== 1 ? "results" : "result";
  info.innerHTML = `
    <div>
      <h3>Search Results for Your Query</h3>
      <p>Showing items matching "<strong>${escapeHtml(searchQuery)}</strong>"</p>
    </div>
    <div class="results-count">
      <span>${products.length}</span>
      <span>${products.length} ${resultText} found</span>
    </div>
  `;

  // Insert into the main-content wrapper before the grid so it appears above products
  const main = document.querySelector(".main-content");
  if (main) {
    // ensure any existing header is removed then insert
    main.insertBefore(info, grid);
  } else {
    grid.parentElement.insertBefore(info, grid);
  }
}

// ================= ESCAPE HTML =================
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ================= DISPLAY =================
function displayProducts(products) {
  const grid = document.getElementById("productsGrid");
  const empty = document.getElementById("emptyProducts");

  grid.innerHTML = "";

  if (!products.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  products.forEach((p) =>
    grid.insertAdjacentHTML("beforeend", createProductCard(p)),
  );
}

// ================= FILTER UI =================
function populateFilters(products) {
  const categories = [
    ...new Set(products.map((p) => p.category).filter(Boolean)),
  ];
  const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))];

  const catBox = document.getElementById("filter-category");
  const brandBox = document.getElementById("filter-brand");

  catBox.innerHTML = "";
  brandBox.innerHTML = "";

  categories.forEach((cat) => {
    catBox.insertAdjacentHTML(
      "beforeend",
      `<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" value="${cat}" class="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500"> <span class="text-sm text-gray-700">${cat}</span></label>`,
    );
  });

  brands.forEach((brand) => {
    brandBox.insertAdjacentHTML(
      "beforeend",
      `<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" value="${brand}" class="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500"> <span class="text-sm text-gray-700">${brand}</span></label>`,
    );
  });
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

// ================= COLLAPSIBLE FILTERS =================
function toggleFilterSection(section) {
  const sectionElement = document.querySelector(`[data-section="${section}"]`);
  const body = sectionElement.querySelector(".filter-body");
  const icon = sectionElement.querySelector(".toggle-icon");
  const sidebar = document.querySelector(".filters");

  if (body.classList.contains("open")) {
    body.classList.remove("open");
    icon.className =
      "fas fa-chevron-down toggle-icon transition-transform duration-200";
    // Check if any filter is still open
    const anyOpen = [...document.querySelectorAll(".filter-body")].some((b) =>
      b.classList.contains("open"),
    );
    if (!anyOpen) {
      sidebar.classList.remove("expanded");
    }
  } else {
    body.classList.add("open");
    icon.className =
      "fas fa-chevron-up toggle-icon transition-transform duration-200";
    sidebar.classList.add("expanded");
  }
}

// ================= CLEAR ALL FILTERS =================
function clearAllFilters() {
  // Uncheck all category checkboxes
  document
    .querySelectorAll("#filter-category input[type='checkbox']")
    .forEach((cb) => (cb.checked = false));
  // Uncheck all brand checkboxes
  document
    .querySelectorAll("#filter-brand input[type='checkbox']")
    .forEach((cb) => (cb.checked = false));
  // Uncheck all size checkboxes
  document
    .querySelectorAll("#filter-sizes input[type='checkbox']")
    .forEach((cb) => (cb.checked = false));
  // Clear price inputs
  document.getElementById("price-min").value = "";
  document.getElementById("price-max").value = "";
  // Apply filters to reset display
  applyFilters();
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", () => {
  loadProducts();

  document
    .getElementById("apply-price-filter")
    ?.addEventListener("click", applyFilters);

  document
    .getElementById("clear-all-filters")
    ?.addEventListener("click", clearAllFilters);

  document.addEventListener("change", (e) => {
    if (
      e.target.closest("#filter-category") ||
      e.target.closest("#filter-brand") ||
      e.target.closest("#filter-sizes")
    ) {
      applyFilters();
    }
  });

  // Initialize collapsible sections as collapsed
  document.querySelectorAll(".filter-body").forEach((body) => {
    body.style.maxHeight = "0px";
  });

  // Add event listeners for collapsible sections
  document.querySelectorAll(".filter-header").forEach((header) => {
    header.addEventListener("click", function () {
      const section = this.parentElement.dataset.section;
      toggleFilterSection(section);
    });
  });

  // Listen for search events from header (triggered by main.js)
  window.addEventListener("shop:search", (event) => {
    const { q } = event.detail;
    if (q) {
      currentSearchQuery = q;
      const searchTerm = q.toLowerCase();
      filteredProducts = allProducts.filter((p) => {
        const name = (p.name || "").toLowerCase();
        const brand = (p.brand || "").toLowerCase();
        const description = (p.description || "").toLowerCase();
        const category = (p.category || "").toLowerCase();
        return (
          name.includes(searchTerm) ||
          brand.includes(searchTerm) ||
          description.includes(searchTerm) ||
          category.includes(searchTerm)
        );
      });
      displaySearchInfo(filteredProducts, q);
      displayProducts(filteredProducts);
    }
  });
});
