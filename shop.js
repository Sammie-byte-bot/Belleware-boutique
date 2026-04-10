// ================= FIREBASE =================
import {
  db,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
} from "./firebase.js";

console.log("shop.js loaded", document.readyState);

// ================= VALIDATION =================
function validateProduct(p) {
  const errors = [];

  if (!p.id) errors.push("Missing ID");
  if (!p.name) errors.push("Missing name");

  const price = Number(p.price);
  if (!Number.isFinite(price) || price <= 0) errors.push("Invalid price");

  // Allow missing images because we can render a placeholder instead
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
    (Array.isArray(product.images) &&
      product.images.length &&
      product.images[0]) ||
    product.images ||
    product.image ||
    "img/placeholder.png";

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

// Pagination state
let currentPage = 1;
let totalProducts = 0;
const productsPerPage = 12;
let lastVisibleDoc = null;
let isLoading = false;
let hasMoreProducts = true;

// Store all documents for offset-based pagination
let allDocs = [];

console.log("shop.js loaded", document.readyState);

// ================= FETCH WITH PAGINATION =================
async function loadProducts(page = 1, isInitialLoad = false) {
  if (isLoading) return;
  isLoading = true;

  console.log(`loadProducts(page=${page}, isInitialLoad=${isInitialLoad})`);

  const grid = document.getElementById("productsGrid");
  const empty = document.getElementById("emptyProducts");
  const error = document.getElementById("errorProducts");

  try {
    empty.hidden = true;
    error.hidden = true;

    // Show skeleton loading
    if (isInitialLoad) {
      grid.innerHTML = `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
      `;
    }

    // Fetch products using offset emulation (skip)
    let products = [];

    if (isInitialLoad || allDocs.length === 0) {
      // First load - fetch active products and cache them
      const activeProductsQuery = query(
        collection(db, "products"),
        where("isActive", "==", true),
        orderBy("createdAt", "desc"),
      );

      let snap;
      try {
        snap = await getDocs(activeProductsQuery);
        allDocs = snap.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter(validateProduct);
      } catch (error) {
        console.warn(
          "Active products fetch failed, falling back to all products:",
          error,
        );
        const fallbackQuery = query(
          collection(db, "products"),
          orderBy("createdAt", "desc"),
        );
        snap = await getDocs(fallbackQuery);
        allDocs = snap.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter(validateProduct);
      }

      if (allDocs.length === 0) {
        // Fallback: show any products if none are explicitly active
        const fallbackQuery = query(
          collection(db, "products"),
          orderBy("createdAt", "desc"),
        );
        snap = await getDocs(fallbackQuery);
        allDocs = snap.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter(validateProduct);
      }

      totalProducts = allDocs.length;
    }

    // Get products for current page from cached docs
    const startIndex = (page - 1) * productsPerPage;
    const endIndex = startIndex + productsPerPage;
    products = allDocs.slice(startIndex, endIndex);

    if (products.length === 0) {
      hasMoreProducts = false;
      empty.hidden = false;
      grid.innerHTML = "";
      renderPagination();
      return;
    }

    currentPage = page;
    hasMoreProducts = endIndex < totalProducts;

    // Display products
    grid.innerHTML = products.map(createProductCard).join("");

    // Populate filters on initial load
    if (isInitialLoad || allProducts.length === 0) {
      allProducts = [...allDocs];
      populateFilters(allProducts);
    }

    // Update pagination UI
    renderPagination();
  } catch (err) {
    console.error("🔥 SHOP LOAD ERROR:", err);
    error.hidden = false;
    grid.innerHTML = "";
  } finally {
    isLoading = false;
  }
}

// ================= DISPLAY =================
function displayProducts(products) {
  const grid = document.getElementById("productsGrid");
  const empty = document.getElementById("emptyProducts");

  // Remove any existing search results info
  const existingInfo = grid.querySelector(".search-results-info");
  if (existingInfo) {
    existingInfo.remove();
  }

  if (!products.length) {
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  grid.innerHTML = products.map(createProductCard).join("");
}

// ================= PAGINATION RENDERER (EBAY-STYLE) =================
function renderPagination() {
  const container = document.getElementById("paginationContainer");
  const infoContainer = document.getElementById("paginationInfo");

  if (!container || !infoContainer) return;

  const totalPages = Math.ceil(totalProducts / productsPerPage);

  // Don't show pagination if only one page
  if (totalPages <= 1) {
    container.innerHTML = "";
    infoContainer.innerHTML = "";
    return;
  }

  // Update info: "Showing X-Y of Z products"
  const startItem = (currentPage - 1) * productsPerPage + 1;
  const endItem = Math.min(currentPage * productsPerPage, totalProducts);
  infoContainer.innerHTML = `
    <span class="pagination-text">Showing ${startItem}-${endItem} of ${totalProducts} products</span>
  `;

  // Generate eBay-style pagination
  let paginationHTML = "";

  // First and Previous buttons
  paginationHTML += `
    <button class="pagination-btn pagination-first ${currentPage === 1 ? "disabled" : ""}" 
            data-page="1" ${currentPage === 1 ? "disabled" : ""}>
      <i class="fas fa-angle-double-left"></i>
    </button>
    <button class="pagination-btn pagination-prev ${currentPage === 1 ? "disabled" : ""}" 
            data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>
      <i class="fas fa-angle-left"></i>
    </button>
  `;

  // Page numbers with ellipsis
  const pages = getPageNumbers(currentPage, totalPages);

  pages.forEach((page) => {
    if (page === "...") {
      paginationHTML += `<span class="pagination-ellipsis">...</span>`;
    } else {
      paginationHTML += `
        <button class="pagination-btn pagination-page ${page === currentPage ? "active" : ""}" 
                data-page="${page}">
          ${page}
        </button>
      `;
    }
  });

  // Next and Last buttons
  paginationHTML += `
    <button class="pagination-btn pagination-next ${currentPage === totalPages ? "disabled" : ""}" 
            data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>
      <i class="fas fa-angle-right"></i>
    </button>
    <button class="pagination-btn pagination-last ${currentPage === totalPages ? "disabled" : ""}" 
            data-page="${totalPages}" ${currentPage === totalPages ? "disabled" : ""}>
      <i class="fas fa-angle-double-right"></i>
    </button>
  `;

  container.innerHTML = paginationHTML;

  // Add click handlers
  container.querySelectorAll("button[data-page]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const page = parseInt(e.currentTarget.dataset.page);
      if (page && page !== currentPage && page >= 1 && page <= totalPages) {
        loadProducts(page);
        // Scroll to top of products
        document
          .getElementById("product1")
          ?.scrollIntoView({ behavior: "smooth" });
      }
    });
  });
}

// Helper function to generate page numbers with ellipsis (eBay-style)
function getPageNumbers(current, total) {
  const delta = 1;
  const range = [];
  const rangeWithDots = [];

  for (let i = 1; i <= total; i++) {
    if (
      i === 1 ||
      i === total ||
      (i >= current - delta && i <= current + delta)
    ) {
      range.push(i);
    }
  }

  let prev;
  for (const i of range) {
    if (prev) {
      if (i - prev === 2) {
        rangeWithDots.push(prev + 1);
      } else if (i - prev !== 1) {
        rangeWithDots.push("...");
      }
    }
    rangeWithDots.push(i);
    prev = i;
  }

  return rangeWithDots;
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

  // Get current search query
  const searchQuery = (currentSearchQuery || "").toLowerCase().trim();

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

    // Search filter - match against name, brand, and category
    if (searchQuery) {
      const name = (p.name || "").toLowerCase();
      const brand = (p.brand || "").toLowerCase();
      const category = (p.category || "").toLowerCase();

      if (
        !name.includes(searchQuery) &&
        !brand.includes(searchQuery) &&
        !category.includes(searchQuery)
      ) {
        return false;
      }
    }

    return true;
  });

  // Reset to page 1 when filters change
  currentPage = 1;
  totalProducts = filteredProducts.length;

  displayProducts(filteredProducts);
  renderPagination();

  // Update search summary if there's a search query
  if (searchQuery) {
    updateSearchSummary(currentSearchQuery, filteredProducts.length);
  }
}

// ================= APPLY SEARCH =================
function applySearch(query) {
  currentSearchQuery = query;
  applyFilters();
}

// ================= UPDATE SEARCH SUMMARY =================
function updateSearchSummary(query, count) {
  // Remove any existing summary first
  const existingSummary = document.querySelector(".search-results-info");
  if (existingSummary) {
    existingSummary.remove();
  }

  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  const qText = (query || "").trim();
  if (!qText) return;

  // Create search results info element
  const summary = document.createElement("div");
  summary.className = "search-results-info";

  if (count === 0) {
    summary.innerHTML = `
      <div>
        <h3>Search Results</h3>
        <p>No results for "${qText}"</p>
      </div>
      <div class="results-count">
        <span>0</span>
      </div>
    `;
  } else {
    summary.innerHTML = `
      <div>
        <h3>Search Results</h3>
        <p><strong>${count}</strong> ${qText} found</p>
      </div>
      <div class="results-count">
        <span>${count}</span>
      </div>
    `;
  }

  // Insert before the product grid
  grid.insertBefore(summary, grid.firstChild);
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
function initShopPage() {
  console.log("shop.js initShopPage()", document.readyState);
  loadProducts(1, true);

  // Check URL for search query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const searchQuery = urlParams.get("q");
  if (searchQuery) {
    currentSearchQuery = searchQuery;
    // Apply search after a short delay to ensure products are loaded
    setTimeout(() => {
      applyFilters();
      updateSearchSummary(searchQuery, filteredProducts.length);
    }, 500);
  }

  // Listen for search events from header (main.js)
  window.addEventListener("shop:search", (e) => {
    const q = (e.detail?.q || "").trim();
    currentSearchQuery = q;
    applyFilters();
    updateSearchSummary(q, filteredProducts.length);
  });

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

  clearBtn?.addEventListener("click", () => {
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

    // 3️⃣ Reset search query
    currentSearchQuery = "";

    // 4️⃣ Update URL to remove query param
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    history.replaceState({}, "", url);

    // 5️⃣ Reset to page 1 and reload all products
    currentPage = 1;
    loadProducts(1, true);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initShopPage);
} else {
  initShopPage();
}
