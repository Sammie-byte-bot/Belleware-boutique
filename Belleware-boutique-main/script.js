alert("TOP PRODUCTS JS LOADED");

import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Firestore references
const productsCollection = collection(db, "products");
const ordersCollection = collection(db, "orders");

// DOM Elements
const productForm = document.getElementById("productForm");
const productTableBody = document.querySelector("#productTable tbody");
const orderTableBody = document.querySelector("#orderTable tbody");
const totalSalesEl = document.getElementById("totalSales");
const totalRevenueEl = document.getElementById("totalRevenue");
const totalOrdersEl = document.getElementById("totalOrders");
const totalCustomersEl = document.getElementById("totalCustomers");
const searchInput = document.getElementById("searchInput");

// Add Product
productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const product = {
    name: document.getElementById("productName").value,
    price: Number(document.getElementById("productPrice").value),
    category: document.getElementById("productCategory").value,
    stock: Number(document.getElementById("productStock").value),
    image: document.getElementById("productImage").value,
    createdAt: serverTimestamp(),
  };
  await addDoc(productsCollection, product);
  loadProducts();
  renderCharts();
  productForm.reset();
});

// Load Products
async function loadProducts(filter = "") {
  const snapshot = await getDocs(productsCollection);
  productTableBody.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const p = docSnap.data();
    const id = docSnap.id;
    if (
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      p.category.toLowerCase().includes(filter.toLowerCase())
    ) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>$${p.price}</td>
        <td>${p.category}</td>
        <td>${p.stock}</td>
        <td>
          <button onclick="deleteProduct('${id}')">Delete</button>
        </td>
      `;
      productTableBody.appendChild(tr);
    }
  });
}

// Delete Product
window.deleteProduct = async (id) => {
  await deleteDoc(doc(db, "products", id));
  loadProducts();
  renderCharts();
};

// Load Orders
async function loadOrders(filter = "") {
  const snapshot = await getDocs(ordersCollection);
  orderTableBody.innerHTML = "";
  const customers = new Set();
  let totalRevenue = 0;
  snapshot.forEach((docSnap) => {
    const o = docSnap.data();
    const id = docSnap.id;
    customers.add(o.customer);
    totalRevenue += o.total;
    if (o.customer.toLowerCase().includes(filter.toLowerCase())) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${id}</td>
        <td>${o.customer}</td>
        <td>${o.products.join(", ")}</td>
        <td>$${o.total}</td>
        <td>${o.status}</td>
        <td>
          <button onclick="updateOrderStatus('${id}','Pending')">Pending</button>
          <button onclick="updateOrderStatus('${id}','Shipped')">Shipped</button>
          <button onclick="updateOrderStatus('${id}','Delivered')">Delivered</button>
          <button onclick="updateOrderStatus('${id}','Canceled')">Canceled</button>
        </td>
      `;
      orderTableBody.appendChild(tr);
    }
  });
  totalSalesEl.textContent = `$${totalRevenue}`;
  totalRevenueEl.textContent = `$${totalRevenue}`;
  totalOrdersEl.textContent = snapshot.size;
  totalCustomersEl.textContent = customers.size;
}

// Update Order Status
window.updateOrderStatus = async (id, status) => {
  await updateDoc(doc(db, "orders", id), { status });
  loadOrders(searchInput.value);
  renderCharts();
};

import { getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import { ordersCollection } from "./firebase.js";

/* ===============================
   TOP PRODUCTS TABLE
================================ */

export async function renderTopProducts() {
  try {
    const ordersSnap = await getDocs(ordersCollection);

    const stats = {};

    ordersSnap.forEach((doc) => {
      const order = doc.data();
      if (!Array.isArray(order.items)) return;

      order.items.forEach((item) => {
        if (!stats[item.id]) {
          stats[item.id] = {
            id: item.id,
            name: item.name,
            image: item.img,
            sales: 0,
            revenue: 0,
          };
        }

        stats[item.id].sales += item.quantity;
        stats[item.id].revenue += item.price * item.quantity;
      });
    });

    const topProducts = Object.values(stats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const tbody = document.getElementById("analytics-top-products");
    if (!tbody) return;

    tbody.innerHTML = "";

    topProducts.forEach((p) => {
      const status = p.sales > 5 ? "In Stock" : "Low Stock";
      const badgeClass = status === "In Stock" ? "badge-green" : "badge-orange";

      const row = document.createElement("tr");

      row.innerHTML = `
        <td class="py-4">
          <div class="product-cell">
            <img
              src="${p.image}"
              alt="${p.name}"
              class="product-image"
            />
            <span class="font-medium">
              ${p.name}
            </span>
          </div>
        </td>

        <td>${p.sales}</td>

        <td>KSh ${p.revenue.toLocaleString()}</td>

        <td>
          <span class="badge ${badgeClass}">
            ${status}
          </span>
        </td>
      `;

      tbody.appendChild(row);
    });
  } catch (err) {
    console.error("Top Products error:", err);
  }
}

renderTopProducts();

// Search
searchInput.addEventListener("input", () => {
  loadProducts(searchInput.value);
  loadOrders(searchInput.value);
});

// Initial Load
loadProducts();
loadOrders();
renderCharts();
