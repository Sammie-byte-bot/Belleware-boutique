// pagination.js

document.addEventListener("DOMContentLoaded", () => {
  const productsGrid = document.getElementById("productsGrid");
  const paginationContainer = document.getElementById("pagination-container");

  const productsPerPage = 12; // Adjust per page
  const products = Array.from(productsGrid.children); // All product divs
  const totalPages = Math.ceil(products.length / productsPerPage);
  let currentPage = 1;

  function showPage(page) {
    // Ensure page number is valid
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    currentPage = page;

    // Hide all products first
    products.forEach((product) => (product.style.display = "none"));

    // Show only products for the current page
    const start = (page - 1) * productsPerPage;
    const end = start + productsPerPage;
    products
      .slice(start, end)
      .forEach((product) => (product.style.display = "block"));

    renderPagination();
  }

  function renderPagination() {
    paginationContainer.innerHTML = "";

    // Previous button
    const prev = document.createElement("button");
    prev.innerHTML = "&laquo;";
    prev.disabled = currentPage === 1;
    prev.addEventListener("click", () => showPage(currentPage - 1));
    paginationContainer.appendChild(prev);

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      const pageBtn = document.createElement("button");
      pageBtn.textContent = i;
      pageBtn.classList.toggle("active", i === currentPage);
      pageBtn.addEventListener("click", () => showPage(i));
      paginationContainer.appendChild(pageBtn);
    }

    // Next button
    const next = document.createElement("button");
    next.innerHTML = "&raquo;";
    next.disabled = currentPage === totalPages;
    next.addEventListener("click", () => showPage(currentPage + 1));
    paginationContainer.appendChild(next);
  }

  // Initialize
  showPage(1);
});
