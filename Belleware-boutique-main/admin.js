// ===============================
// FIREBASE IMPORTS
// ===============================
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signOut,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

// ===============================
// FIREBASE CONFIG
// ===============================
const firebaseConfig = {
  apiKey: "AIzaSyD6UqMyedaoaXgqOeddQN47ADgP8joO364",
  authDomain: "bellewear-boutique.firebaseapp.com",
  projectId: "bellewear-boutique",
  storageBucket: "bellewear-boutique.appspot.com",
  messagingSenderId: "795858464616",
  appId: "1:795858464616:web:0bbf307b3da145766ff0dd",
};

// ===============================
// INIT
// ===============================
const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Track the current authenticated admin uid globally for read tracking
let currentAdminUid = null;
let notificationsListenerStarted = false;
let listenersStarted = false;
let activeUnsubs = [];

// Verify that the signed-in user is an admin (reads users/{uid}.role)
async function checkIsAdmin(user) {
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    return snap.exists() && snap.data().role?.trim() === "admin";
  } catch (err) {
    console.error("checkIsAdmin error", err);
    return false;
  }
}

// Support admin-guard.js: respond to the 'admin:ready' event by starting listeners and initializing dashboard
let dashboardInitialized = false;
const handleAdminReady = async () => {
  try {
    if (window.adminUid) currentAdminUid = window.adminUid;

    // Hide any auth loader and initialize UI if not already done
    hideLoader();

    const user = auth && auth.currentUser ? auth.currentUser : null;
    if (user && !dashboardInitialized) {
      try {
        initDashboard(user);
        dashboardInitialized = true;
      } catch (uiErr) {
        console.warn("Failed to init dashboard on admin:ready:", uiErr);
      }
      try {
        showToast(`Welcome back, ${user.email}`, "success");
      } catch (tErr) {}
    }

    // Start listeners if not already started
    if (!listenersStarted) startRealtimeListeners();

    console.debug(
      "handleAdminReady: dashboardInitialized=",
      dashboardInitialized,
      "listenersStarted=",
      listenersStarted,
      "currentAdminUid=",
      currentAdminUid,
    );
  } catch (err) {
    console.warn("admin ready handler failed", err);
  }
};

window.addEventListener("admin:ready", handleAdminReady);

// If the admin guard already ran before this script loaded, run the handler immediately
if (window.isAdmin) {
  console.debug(
    "Detected existing admin session (window.isAdmin) — initializing dashboard",
  );
  handleAdminReady();
}

// ===============================
// UI ELEMENTS
// ===============================
const loader = document.getElementById("auth-loading");
const toast = document.getElementById("toast");

function showToast(message, type = "info") {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("opacity-0");
  toast.classList.add("opacity-100");
  toast.style.background =
    type === "success" ? "#16a34a" : type === "error" ? "#dc2626" : "#0f172a";
  setTimeout(() => {
    toast.classList.remove("opacity-100");
    toast.classList.add("opacity-0");
  }, 3000);
}

function hideLoader() {
  if (!loader) return;
  loader.classList.add("opacity-0");
  setTimeout(() => loader.remove(), 300);
}

// ===============================
// AUTH PERSISTENCE
// ===============================
await setPersistence(auth, browserLocalPersistence);

// ===============================
// AUTH GUARD
// ===============================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Clear global state and stop listeners
    currentAdminUid = null;
    stopAllListeners();
    showToast("Session expired. Please log in again.", "error");
    setTimeout(() => window.location.replace("login.html"), 1200);
    return;
  }

  // Verify admin privileges before starting any listeners
  const isAdmin = await checkIsAdmin(user);
  if (!isAdmin) {
    console.warn("Non-admin signed in, redirecting to login");
    showToast("Access denied. Admins only.", "error");
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Failed to sign out non-admin:", e);
    }
    setTimeout(() => window.location.replace("login.html"), 800);
    return;
  }

  // Save current admin UID globally and initialize admin UI/listeners
  currentAdminUid = user.uid;
  hideLoader();
  showToast(`Welcome back, ${user.email}`, "success");
  initDashboard(user);
  // Start all firestore listeners only once, after admin verification
  if (!listenersStarted) startRealtimeListeners();
});

// ===============================
// DASHBOARD
// ===============================

// Dashboard stats (moved to module scope so lifecycle helpers can start/stop them)
var salesChartInstance = null;
var categoryChartInstance = null;

// Client-side cache + search state for products list
let productsCache = [];
let productSearchTerm = "";
let productSearchDebounce = null;

// Search state for orders list
let orderSearchTerm = "";
let orderSearchDebounce = null;

function renderRevenueChart(orders) {
  // Aggregate orders by date (YYYY-MM-DD)
  const salesByDate = {};
  orders.forEach((order) => {
    if (!order.createdAt) return;
    const date = new Date(
      order.createdAt.seconds
        ? order.createdAt.seconds * 1000
        : order.createdAt,
    );
    const key = date.toISOString().slice(0, 10); // YYYY-MM-DD
    salesByDate[key] = (salesByDate[key] || 0) + (order.total || 0);
  });

  // Sort dates
  const labels = Object.keys(salesByDate).sort(
    (a, b) => new Date(a) - new Date(b),
  );
  const data = labels.map((label) => salesByDate[label]);

  const ctx = document.getElementById("salesChart").getContext("2d");
  if (salesChartInstance) salesChartInstance.destroy();

  try {
    salesChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Revenue ($)",
            data,
            fill: true,
            backgroundColor: "rgba(16,185,129,0.2)",
            borderColor: "rgba(16,185,129,1)",
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                return `$${context.parsed.y}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "time",
            time: { unit: "day", tooltipFormat: "MMM d, yyyy" },
            title: { display: true, text: "Date" },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Revenue ($)" },
            grid: { display: false },
          },
        },
      },
    });
  } catch (err) {
    console.error("Chart initialization failed (date adapter?):", err);
    // Fallback to simple bar chart if time scale isn't available
    try {
      salesChartInstance = new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Revenue ($)",
              data,
              backgroundColor: "rgba(99,102,241,0.6)",
            },
          ],
        },
        options: { responsive: true },
      });
    } catch (innerErr) {
      console.error("Fallback chart also failed:", innerErr);
      const parent = ctx.canvas.parentElement;
      if (parent)
        parent.innerHTML =
          '<div class="p-4 text-center text-sm text-red-500">Chart unavailable</div>';
    }
  }
}

const centerChartPlugin = {
  id: "centerChart",
  afterLayout(chart) {
    const { chartArea, canvas } = chart;
    const chartHeight = chartArea.bottom - chartArea.top;
    const extraSpace = canvas.height - chartHeight;

    if (extraSpace > 0) {
      chartArea.top += extraSpace / 2;
      chartArea.bottom += extraSpace / 2;
    }
  },
};

function renderCategoryChart(productsSnap) {
  const categoryCount = {};

  productsSnap.docs.forEach((doc) => {
    const category = doc.data().category || "Uncategorized";
    categoryCount[category] = (categoryCount[category] || 0) + 1;
  });

  const sortedEntries = Object.entries(categoryCount).sort(
    (a, b) => b[1] - a[1],
  );

  const labels = sortedEntries.map(([label]) => label);
  const data = sortedEntries.map(([, count]) => count);

  const canvas = document.getElementById("categoryChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  // Guard: empty data
  if (!labels.length) {
    canvas.parentElement.innerHTML =
      '<div class="text-sm text-gray-400 text-center">No category data</div>';
    return;
  }

  // Function to generate unique colors based on category name
  function generateUniqueColors(labels) {
    const colors = [];
    labels.forEach((label, index) => {
      // Use a hash of the label to generate consistent colors
      let hash = 0;
      for (let i = 0; i < label.length; i++) {
        hash = label.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      const saturation = 70 + ((index * 10) % 20); // Vary saturation slightly
      const lightness = 50 + ((index * 5) % 20); // Vary lightness slightly
      colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
    });
    return colors;
  }

  const uniqueColors = generateUniqueColors(labels);

  try {
    categoryChartInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: uniqueColors,
            hoverBackgroundColor: uniqueColors.map((color) =>
              color.replace("50%", "60%"),
            ), // Slightly lighter on hover
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              usePointStyle: true,
              maxWidth: 80,
              padding: 10,
            },
          },
        },
      },
    });

    // Stabilize layout after render
    setTimeout(() => {
      if (categoryChartInstance) categoryChartInstance.resize();
    }, 0);
  } catch (err) {
    console.error("Category chart initialization failed:", err);
    canvas.parentElement.innerHTML =
      '<div class="p-4 text-center text-sm text-red-500">Category chart unavailable</div>';
  }
}

async function renderTopProductsForOverview(orders) {
  try {
    if (!Array.isArray(orders) || orders.length === 0) {
      console.warn("No orders available to calculate top products");
      return;
    }

    // ================= AGGREGATE =================
    const productStats = {};

    orders.forEach((order) => {
      const items = Array.isArray(order.items) ? order.items : [];

      items.forEach((item) => {
        if (!item?.id) return;

        if (!productStats[item.id]) {
          productStats[item.id] = {
            id: item.id,
            name: item.name || "Unknown Product",
            image: item.img || "https://via.placeholder.com/50",
            sales: 0,
            revenue: 0,
          };
        }

        productStats[item.id].sales += Number(item.quantity) || 0;
        productStats[item.id].revenue +=
          (Number(item.price) || 0) * (Number(item.quantity) || 0);
      });
    });

    // ================= SORT =================
    const topProducts = Object.values(productStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    // ================= RENDER ADMIN TABLE =================
    const tbody = document.getElementById("overview-top-products");
    if (!tbody) {
      console.warn("overview-top-products tbody not found");
      return;
    }

    tbody.innerHTML = "";

    topProducts.forEach((product) => {
      const status = product.sales > 5 ? "In Stock" : "Low Stock";

      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="py-4">
          <div class="flex items-center gap-2">
            <img src="${product.image}" 
                 alt="${product.name}" 
                 class="w-10 h-10 object-cover rounded" />
            <span class="font-medium">${product.name}</span>
          </div>
        </td>
        <td class="py-4">${product.sales}</td>
        <td class="py-4">KSh ${product.revenue.toLocaleString()}</td>
        <td class="py-4">
          <span class="px-2 py-1 rounded text-white text-sm ${
            status === "In Stock" ? "bg-green-600" : "bg-orange-600"
          }">
            ${status}
          </span>
        </td>
      `;

      tbody.appendChild(row);
    });

    // ================= SYNC TO PUBLIC COLLECTION =================
    await Promise.all(
      topProducts.map((product) => {
        const ref = doc(db, "productStats", product.id);

        return setDoc(
          ref,
          {
            productId: product.id,
            name: product.name,
            image: product.image,
            sales: product.sales,
            revenue: product.revenue,
            lastUpdated: serverTimestamp(),
          },
          { merge: true },
        );
      }),
    );

    console.log("✅ productStats synced from admin dashboard");
  } catch (err) {
    console.error("🔥 Failed to render/sync top products:", err);
  }
}

function loadDashboardStatsRealtime() {
  const unsubs = [];
  const DAY = 24 * 60 * 60 * 1000;
  function formatChange(curr, prev) {
    if (prev === 0) return curr === 0 ? "+0.00%" : "+100%";
    const change = ((curr - prev) / Math.abs(prev)) * 100;
    return (change > 0 ? "+" : "") + change.toFixed(2) + "%";
  }

  // --- Orders ---
  const ordersCol = collection(db, "orders");
  const unsubOrders = onSnapshot(ordersCol, (ordersSnap) => {
    const orders = ordersSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filter for new orders (PLACED and CONFIRMED)
    const newOrders = orders.filter((o) =>
      ["PLACED", "CONFIRMED"].includes(o.status?.toUpperCase()),
    );

    const ordersEl = document.getElementById("stat-orders");
    if (ordersEl) ordersEl.textContent = newOrders.length;

    const totalSales = orders.reduce(
      (acc, order) => acc + (order.total || 0),
      0,
    );
    const salesEl = document.getElementById("stat-sales");
    if (salesEl) salesEl.textContent = `$${totalSales}`;

    // 30-day comparisons for new orders
    const now = Date.now();
    const last30Start = now - 30 * DAY;
    const prev30Start = now - 60 * DAY;
    const getTime = (o) => {
      const t = o.createdAt;
      if (!t) return null;
      return t.seconds ? t.seconds * 1000 : t;
    };

    const last30Orders = newOrders.filter((o) => {
      const t = getTime(o);
      return t && t >= last30Start;
    });
    const prev30Orders = newOrders.filter((o) => {
      const t = getTime(o);
      return t && t >= prev30Start && t < last30Start;
    });

    const last30Sales = last30Orders.reduce(
      (acc, o) => acc + (o.total || 0),
      0,
    );
    const prev30Sales = prev30Orders.reduce(
      (acc, o) => acc + (o.total || 0),
      0,
    );

    const salesChangeEl = document.getElementById("stat-sales-change");
    if (salesChangeEl)
      salesChangeEl.textContent = formatChange(last30Sales, prev30Sales);

    const ordersChangeEl = document.getElementById("stat-orders-change");
    if (ordersChangeEl)
      ordersChangeEl.textContent = formatChange(
        last30Orders.length,
        prev30Orders.length,
      );

    // Expense (if orders carry an expense field)
    const totalExpense = orders.reduce((acc, o) => acc + (o.expense || 0), 0);
    const expenseEl = document.getElementById("stat-expense");
    if (expenseEl) expenseEl.textContent = `$${totalExpense}`;

    const last30Expense = last30Orders.reduce(
      (acc, o) => acc + (o.expense || 0),
      0,
    );
    const prev30Expense = prev30Orders.reduce(
      (acc, o) => acc + (o.expense || 0),
      0,
    );
    const expenseChangeEl = document.getElementById("stat-expense-change");
    if (expenseChangeEl)
      expenseChangeEl.textContent = formatChange(last30Expense, prev30Expense);

    renderRevenueChart(orders);

    // Render top products for overview
    renderTopProductsForOverview(orders);
  });
  unsubs.push(unsubOrders);

  async function updateOrderStatus(orderId, userId, newStatus) {
    const orderRef = doc(db, "orders", orderId);

    // update order status
    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: serverTimestamp(),
    });

    // create a message for the user
    await addDoc(collection(db, "messages"), {
      userId: userId,
      type: `ORDER_${newStatus}`,
      title: `Order ${newStatus}`,
      body: `Your order #${orderId.slice(0, 8).toUpperCase()} is now ${newStatus}.`,
      orderId: orderId,
      read: false,
      createdAt: serverTimestamp(),
    });
  }

  // --- Customers (Registered Users) ---
  const usersCol = collection(db, "users");
  const unsubUsers = onSnapshot(usersCol, (usersSnap) => {
    const el = document.getElementById("stat-customers");
    const users = usersSnap.docs.map((d) => d.data());
    if (el) el.textContent = usersSnap.size;

    const now = Date.now();
    const last30Start = now - 30 * DAY;
    const prev30Start = now - 60 * DAY;
    const getUserTime = (u) => {
      const t = u.createdAt;
      if (!t) return null;
      return t.seconds ? t.seconds * 1000 : t;
    };

    const last30Users = users.filter((u) => {
      const t = getUserTime(u);
      return t && t >= last30Start;
    });
    const prev30Users = users.filter((u) => {
      const t = getUserTime(u);
      return t && t >= prev30Start && t < last30Start;
    });

    const customersChangeEl = document.getElementById("stat-customers-change");
    if (customersChangeEl)
      customersChangeEl.textContent = formatChange(
        last30Users.length,
        prev30Users.length,
      );
  });
  unsubs.push(unsubUsers);

  // --- Products ---
  const productsCol = collection(db, "products");
  const unsubProducts = onSnapshot(productsCol, (productsSnap) => {
    const lowStockCount = productsSnap.docs.filter(
      (doc) => (doc.data().stock || 0) < 5,
    ).length;
    const lowEl = document.getElementById("stat-lowstock");
    if (lowEl) lowEl.textContent = lowStockCount;
    console.debug("lowStockCount updated:", lowStockCount);
    renderCategoryChart(productsSnap);
  });
  unsubs.push(unsubProducts);

  return unsubs;
}
try {
  window.loadDashboardStatsRealtime = loadDashboardStatsRealtime;
} catch (e) {}

function initDashboard(user) {
  // Set avatar initial from admin email/displayName
  try {
    const avatarLetter = ((user && (user.displayName || user.email)) || "A")
      .charAt(0)
      .toUpperCase();
    const userMenuBtnEl = document.getElementById("userMenuBtn");
    if (userMenuBtnEl) userMenuBtnEl.textContent = avatarLetter;
  } catch (err) {
    console.warn("Failed to set avatar initial", err);
  }

  // ===============================
  // NAVIGATION
  // ===============================
  window.showSection = function (section) {
    document
      .querySelectorAll("section[id^='section-']")
      .forEach((sec) => sec.classList.add("hidden"));
    document.getElementById(`section-${section}`)?.classList.remove("hidden");
    document
      .querySelectorAll("nav button")
      .forEach((btn) => btn.classList.remove("active-link"));

    const activeBtn = document.getElementById(`nav-${section}`);
    if (activeBtn) {
      activeBtn.classList.add("active-link");
      // brief pop animation to emphasize activation
      activeBtn.classList.add("active-anim");
      setTimeout(() => activeBtn.classList.remove("active-anim"), 420);
      // accessibility: mark the active link
      document
        .querySelectorAll("nav button")
        .forEach((b) => b.removeAttribute("aria-current"));
      activeBtn.setAttribute("aria-current", "page");
    }

    const title = document.getElementById("section-title");
    if (title)
      title.textContent = section.charAt(0).toUpperCase() + section.slice(1);

    // Auto-init pages when they are shown
    try {
      if (section === "analytics") initAnalytics();
      if (section === "customers") initCustomers();
      if (section === "settings") initSettings();
      if (section === "orders") {
        updateOrderFilterButtons();
      }
    } catch (e) {
      console.warn("Auto-init for section failed:", e);
    }
  };

  window.toggleModal = function (id) {
    document.getElementById(id)?.classList.toggle("hidden");
  };

  // NAV ROUTING: attach to sidebar buttons and wire page inits
  document.querySelectorAll("nav button[data-route]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const route = btn.dataset.route;
      try {
        showSection(route);
        if (route === "analytics") initAnalytics();
        if (route === "customers") initCustomers();
        if (route === "settings") initSettings();
      } catch (err) {
        console.warn("Navigation handler failed:", err);
      }
    });
  });

  // Init functions for Analytics / Customers / Settings
  let analyticsInitialized = false;
  let analyticsRevenueChartInstance = null;
  let analyticsOrdersChartInstance = null;

  document.addEventListener("DOMContentLoaded", () => {
    initAnalytics();
  });

  async function initAnalytics() {
    try {
      console.debug("initAnalytics: started");

      // -----------------------------
      // 1️⃣ Range selection
      // -----------------------------
      const rangeSelect = document.getElementById("analytics-range");
      const range = rangeSelect ? parseInt(rangeSelect.value || "12") : 12;

      // -----------------------------
      // 2️⃣ Fetch orders from Firestore
      // -----------------------------
      const ordersSnap = await getDocs(collection(db, "orders"));
      const orders = ordersSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      console.debug("Fetched orders:", orders);

      // -----------------------------
      // 3️⃣ Prepare monthly charts data
      // -----------------------------
      const now = new Date();
      const months = [];
      for (let i = range - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
        const label = d.toLocaleString(undefined, {
          month: "short",
          year: "numeric",
        });
        months.push({ start, end, label });
      }

      const revenueData = months.map((m) =>
        orders.reduce((acc, o) => {
          const t = o.createdAt?.seconds
            ? o.createdAt.seconds * 1000
            : o.createdAt || 0;
          return t >= m.start && t < m.end ? acc + (o.total || 0) : acc;
        }, 0),
      );

      const ordersData = months.map((m) =>
        orders.reduce((acc, o) => {
          const t = o.createdAt?.seconds
            ? o.createdAt.seconds * 1000
            : o.createdAt || 0;
          return t >= m.start && t < m.end ? acc + 1 : acc;
        }, 0),
      );

      // -----------------------------
      // 4️⃣ Render Revenue Chart
      // -----------------------------
      const revenueCtx = document
        .getElementById("analyticsRevenueChart")
        ?.getContext("2d");
      if (revenueCtx) {
        // Destroy any existing chart on this canvas
        const existingRevenue = Chart.getChart(revenueCtx.canvas);
        if (existingRevenue) existingRevenue.destroy();
        analyticsRevenueChartInstance = new Chart(revenueCtx, {
          type: "line",
          data: {
            labels: months.map((m) => m.label),
            datasets: [
              {
                label: "Revenue",
                data: revenueData,
                fill: true,
                backgroundColor: "rgba(99,102,241,0.25)",
                borderColor: "rgba(99,102,241,1)",
                tension: 0.3,
              },
            ],
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } },
          },
        });
      }

      // -----------------------------
      // 5️⃣ Render Orders Chart
      // -----------------------------
      const ordersCtx = document
        .getElementById("analyticsOrdersChart")
        ?.getContext("2d");
      if (ordersCtx) {
        // Destroy any existing chart on this canvas
        const existingOrders = Chart.getChart(ordersCtx.canvas);
        if (existingOrders) existingOrders.destroy();
        analyticsOrdersChartInstance = new Chart(ordersCtx, {
          type: "bar",
          data: {
            labels: months.map((m) => m.label),
            datasets: [
              {
                label: "Orders",
                data: ordersData,
                backgroundColor: "rgba(16,185,129,0.8)",
              },
            ],
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } },
          },
        });
      }

      // -----------------------------
      // 6️⃣ Render Top Products Table
      // -----------------------------
      function renderTopProducts(orders) {
        try {
          if (!Array.isArray(orders) || orders.length === 0) {
            console.warn("No orders available to display top products");
            return;
          }

          const productStats = {};
          orders.forEach((order) => {
            const items = Array.isArray(order.items) ? order.items : [];
            items.forEach((item) => {
              if (!item.id) return;

              if (!productStats[item.id]) {
                productStats[item.id] = {
                  id: item.id,
                  name: item.name || "Unknown Product",
                  image: item.img || "https://via.placeholder.com/50",
                  sales: 0,
                  revenue: 0,
                };
              }

              productStats[item.id].sales += item.quantity || 0;
              productStats[item.id].revenue +=
                (item.price || 0) * (item.quantity || 0);
            });
          });

          const topProducts = Object.values(productStats)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 6);
          console.debug("Top products:", topProducts);

          const tbody = document.getElementById("analytics-top-products");
          if (!tbody) {
            console.warn("Top products tbody element not found");
            return;
          }
          tbody.innerHTML = "";

          topProducts.forEach((product) => {
            const status = product.sales > 5 ? "In Stock" : "Low Stock";
            const row = document.createElement("tr");
            row.innerHTML = `
            <td class="py-4">
              <div class="product-cell flex items-center gap-2">
                <img src="${product.image}" alt="${
                  product.name
                }" class="w-10 h-10 object-cover rounded" />
                <span class="font-medium">${product.name}</span>
              </div>
            </td>
            <td class="py-4">${product.sales}</td>
            <td class="py-4">KSh ${product.revenue.toLocaleString()}</td>
            <td class="py-4">
              <span class="px-2 py-1 rounded text-white text-sm ${
                status === "In Stock" ? "bg-green-600" : "bg-orange-600"
              }">
                ${status}
              </span>
            </td>`;
            tbody.appendChild(row);
          });
        } catch (err) {
          console.error("Failed to render top products:", err);
        }
      }

      renderTopProducts(orders);

      // -----------------------------
      // 7️⃣ Wire range selector
      // -----------------------------
      if (rangeSelect) rangeSelect.onchange = () => initAnalytics();

      analyticsInitialized = true;
      console.debug("initAnalytics: completed successfully");
    } catch (err) {
      console.error("initAnalytics failed:", err);
      showToast("Failed to load analytics", "error");
    }
  }

  async function initCustomers() {
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const ordersSnap = await getDocs(collection(db, "orders"));
      const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const ordersByUser = {};
      orders.forEach((o) => {
        const uid =
          o.userId ||
          o.userUID ||
          o.customerId ||
          o.userEmail ||
          o.customerEmail ||
          "__guest__";
        ordersByUser[uid] = (ordersByUser[uid] || 0) + 1;
      });

      const tbody = document.getElementById("customers-table-body");
      if (!tbody) return;
      tbody.innerHTML = "";

      // Sort all users by createdAt date in descending order (recent dates at top)
      const sortedUsers = usersSnap.docs.sort((a, b) => {
        const aTime = a.data().createdAt?.seconds || 0;
        const bTime = b.data().createdAt?.seconds || 0;
        return bTime - aTime;
      });

      sortedUsers.forEach((d) => {
        const u = d.data();
        const created =
          u.createdAt && u.createdAt.toDate
            ? u.createdAt.toDate().toLocaleDateString()
            : "-";
        const uidKey = d.id || u.email || u.uid;
        const total = ordersByUser[uidKey] || ordersByUser[u.email] || 0;
        const phone = u.phone || u.phoneNumber || "-";
        const status = u.status || (u.disabled ? "Inactive" : "Active");

        const fullName = u.name || u.fullName || "-";
        const avatarHtml = u.photoURL
          ? `<img src="${u.photoURL}" alt="Avatar" class="w-9 h-9 rounded-full object-cover" />`
          : `<div class="avatar w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-semibold">${fullName
              .charAt(0)
              .toUpperCase()}</div>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="p-4">
            <div class="flex items-center gap-3">
              ${avatarHtml}
              <div>
                <div class="font-semibold">${fullName}</div>
              </div>
            </div>
          </td>
          <td class="p-4">${u.email || "-"}</td>
          <td class="p-4">${phone}</td>
          <td class="p-4"><span class="status-pill ${
            status.toLowerCase().includes("inactive")
              ? "status-inactive"
              : "status-published"
          }">${status}</span></td>
          <td class="p-4">${created}</td>
          <td class="p-4 text-right"><button class="action-btn" onclick="showToast('Open customer actions for ${
            d.id || u.uid || "-"
          }', 'info')">⋯</button></td>
        `;
        tbody.appendChild(tr);
      });

      const search = document.getElementById("customers-search");
      if (search) {
        search.oninput = () => {
          const q = search.value.toLowerCase();
          Array.from(tbody.children).forEach((tr) => {
            const txt = tr.textContent.toLowerCase();
            tr.style.display = txt.includes(q) ? "" : "none";
          });
        };
      }

      console.debug("initCustomers: completed");
    } catch (err) {
      console.error("initCustomers failed:", err);
      showToast("Failed to load customers", "error");
    }
  }

  async function initSettings() {
    try {
      const docRef = doc(db, "settings", "store");
      const snap = await getDoc(docRef);
      const nameEl = document.getElementById("settings-store-name");
      const emailEl = document.getElementById("settings-store-email");
      const curEl = document.getElementById("settings-currency");
      if (snap && snap.exists()) {
        const data = snap.data();
        if (nameEl) nameEl.value = data.name || "";
        if (emailEl) emailEl.value = data.email || "";
        if (curEl) curEl.value = data.currency || "USD";
      } else {
        if (nameEl) nameEl.value = "";
        if (emailEl) emailEl.value = "";
        if (curEl) curEl.value = "USD";
      }

      const form = document.getElementById("settings-form");
      if (form) {
        form.onsubmit = async (e) => {
          e.preventDefault();
          try {
            await setDoc(
              docRef,
              {
                name: nameEl.value || "",
                email: emailEl.value || "",
                currency: curEl.value || "USD",
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
            showToast("Settings saved", "success");
          } catch (err) {
            console.error("Failed to save settings:", err);
            showToast("Failed to save settings", "error");
          }
        };
      }

      const reload = document.getElementById("settings-reload");
      if (reload) reload.onclick = () => initSettings();

      console.debug("initSettings: completed");
    } catch (err) {
      console.error("initSettings failed:", err);
      showToast("Failed to load settings", "error");
    }
  }

  // expose in global scope for debugging
  try {
    window.initAnalytics = initAnalytics;
    window.initCustomers = initCustomers;
    window.initSettings = initSettings;
  } catch (e) {}

  // Dashboard stats helpers moved to module scope (see top of file)

  // ===============================
  // PRODUCTS
  // ===============================
  function loadProducts() {
    return loadProductsNew();
  }
  try {
    window.loadProducts = loadProductsNew;
  } catch (e) {}

  // New loadProductsNew (renders updated product table rows)
  function loadProductsNew() {
    console.debug("loadProductsNew: subscribing to products collection");
    const productsCol = collection(db, "products");
    const unsub = onSnapshot(
      productsCol,
      (snapshot) => {
        const tbody = document.getElementById("product-table-body");
        const productCountEl = document.getElementById("product-count");
        if (!tbody) {
          console.warn(
            "loadProductsNew: product table body (#product-table-body) not found",
          );
          return;
        }

        // Populate cache and render via renderer so search + scroll logic can operate
        productsCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (productsCache.length === 0) {
          if (productCountEl) productCountEl.textContent = "0";
          tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No products available</td></tr>`;
        } else {
          if (productCountEl) productCountEl.textContent = productsCache.length;
          renderProductsList();
        }
      },
      (err) => {
        console.error("loadProductsNew: realtime listener error:", err);
        const tbody = document.getElementById("product-table-body");
        if (tbody)
          tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Products unavailable: ${
            err && err.message ? err.message : "unknown error"
          }</td></tr>`;
      },
    );

    return unsub;
  }
  try {
    window.loadProductsNew = loadProductsNew;
  } catch (e) {}

  // Render products from the client-side cache with optional search filtering
  function renderProductsList() {
    const tbody = document.getElementById("product-table-body");
    if (!tbody) return;
    const q = (productSearchTerm || "").trim().toLowerCase();
    const filtered = productsCache.filter((p) => {
      if (!q) return true;
      return (
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.id && p.id.toLowerCase().includes(q))
      );
    });

    tbody.innerHTML = "";
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No products found</td></tr>`;
    } else {
      filtered.forEach((product) => {
        const images = product.images || [];
        const thumb = images.length
          ? images[0]
          : "https://via.placeholder.com/80";
        const stockVal = product.stock != null ? product.stock : 0;
        const created = (function () {
          const t = product.createdAt;
          if (!t) return "-";
          if (t.toDate) return t.toDate().toLocaleDateString();
          return new Date(
            t.seconds ? t.seconds * 1000 : t,
          ).toLocaleDateString();
        })();
        const status =
          product.status ||
          (product.stock && product.stock > 0 ? "Published" : "Inactive");
        const statusClass = status.toLowerCase().includes("inactive")
          ? "status-inactive"
          : status.toLowerCase().includes("draft")
            ? "status-draft"
            : "status-published";

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="p-4">
            <div class="flex items-center gap-4">
              <img src="${thumb}" alt="${product.name}" class="product-thumb" />
              <div>
                <div class="product-name">${product.name}</div>
                <div class="product-sub">Stock: ${stockVal}</div>
              </div>
            </div>
          </td>
          <td class="p-4">${product.category || "-"}</td>
          <td class="p-4">${product.id}</td>
          <td class="p-4">$${product.price || 0}</td>
          <td class="p-4">${created}</td>
          <td class="p-4"><span class="status-pill ${statusClass}">${status}</span></td>
          <td class="p-4 text-right"><button class="action-btn" onclick="editProduct('${
            product.id
          }')"><i class="fas fa-ellipsis-h"></i></button></td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Update count display
    const productCountEl = document.getElementById("product-count");
    if (productCountEl) productCountEl.textContent = filtered.length;
  }

  // Wire search input (idempotent)
  (function initProductsUi() {
    const searchInput = document.getElementById("search-product");
    const clearBtn = document.getElementById("clear-product-search");

    const updateClearVisibility = () => {
      if (!clearBtn || !searchInput) return;
      if (searchInput.value && searchInput.value.trim() !== "") {
        clearBtn.classList.remove("hidden");
      } else {
        clearBtn.classList.add("hidden");
      }
    };

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        productSearchTerm = (e.target && e.target.value) || "";
        updateClearVisibility();
        if (productSearchDebounce) clearTimeout(productSearchDebounce);
        productSearchDebounce = setTimeout(() => renderProductsList(), 180);
      });
      // Clear on Escape
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          searchInput.value = "";
          productSearchTerm = "";
          updateClearVisibility();
          renderProductsList();
        }
      });

      // Initialize visibility
      updateClearVisibility();
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (searchInput) {
          searchInput.value = "";
          productSearchTerm = "";
          updateClearVisibility();
          renderProductsList();
          searchInput.focus();
        }
      });
    }
  })();

  // Wire orders search input (idempotent)
  (function initOrdersUi() {
    const searchInput = document.getElementById("search-order");
    const clearBtn = document.getElementById("clear-order-search");

    const updateClearVisibility = () => {
      if (!clearBtn || !searchInput) return;
      if (searchInput.value && searchInput.value.trim() !== "") {
        clearBtn.classList.remove("hidden");
      } else {
        clearBtn.classList.add("hidden");
      }
    };

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        orderSearchTerm = (e.target && e.target.value) || "";
        updateClearVisibility();
        if (orderSearchDebounce) clearTimeout(orderSearchDebounce);
        orderSearchDebounce = setTimeout(() => renderOrders(), 180);
      });
      // Clear on Escape
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          searchInput.value = "";
          orderSearchTerm = "";
          updateClearVisibility();
          renderOrders();
        }
      });

      // Initialize visibility
      updateClearVisibility();
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (searchInput) {
          searchInput.value = "";
          orderSearchTerm = "";
          updateClearVisibility();
          renderOrders();
          searchInput.focus();
        }
      });
    }
  })();

  // ===============================
  // ORDERS
  // ===============================
  /* ===============================
   STATE
================================ */
  let ALL_ORDERS = [];
  let ACTIVE_FILTER = "ALL";

  /* ===============================
   LOAD ORDERS (REALTIME)
================================ */
  async function loadOrders() {
    const ordersCol = collection(db, "orders");

    // Load initial data synchronously
    try {
      const snapshot = await getDocs(ordersCol);
      ALL_ORDERS = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      updateOrderFilterButtons();
      renderOrders();

      // Attach filter button event listeners after initial load
      document.querySelectorAll(".filter-btn").forEach((btn) => {
        btn.onclick = () => {
          ACTIVE_FILTER = btn.dataset.filter.toUpperCase();

          document
            .querySelectorAll(".filter-btn")
            .forEach((b) => b.classList.remove("bg-blue-500", "text-white"));

          btn.classList.add("bg-blue-500", "text-white");
          renderOrders();
          updateOrderFilterButtons();
        };
      });
    } catch (err) {
      console.error("Failed to load initial orders:", err);
    }

    const unsub = onSnapshot(ordersCol, (snapshot) => {
      if (!currentAdminUid) return; // Prevent updates after logout

      ALL_ORDERS = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      updateOrderFilterButtons();
      renderOrders();
    });

    return unsub;
  }

  /* ===============================
   UPDATE ORDER FILTER BUTTONS
================================ */
  /* ===============================
   GLOBAL STATE
================================ */

  /* ===============================
   HELPERS
================================ */
  const normalizeStatus = (s) => (s || "").toUpperCase();

  /* ===============================
   UPDATE ORDER FILTER BUTTONS
================================ */
  function updateOrderFilterButtons() {
    const allCount = ALL_ORDERS.length;

    const completedCount = ALL_ORDERS.filter(
      (o) => normalizeStatus(o.status) === "DELIVERED",
    ).length;

    const pendingCount = ALL_ORDERS.filter((o) =>
      ["PLACED", "CONFIRMED"].includes(normalizeStatus(o.status)),
    ).length;

    const cancelledCount = ALL_ORDERS.filter(
      (o) => normalizeStatus(o.status) === "CANCELLED",
    ).length;

    const setBtn = (filter, label) => {
      const btn = document.querySelector(`[data-filter="${filter}"]`);
      if (btn) btn.textContent = label;
    };

    setBtn("ALL", `All (${allCount})`);
    setBtn("DELIVERED", `Completed (${completedCount})`);
    setBtn("PENDING", `Pending (${pendingCount})`);
    setBtn("CANCELLED", `Cancelled (${cancelledCount})`);

    const stat = document.getElementById("stat-orders");
    if (stat) stat.textContent = allCount;
  }

  /* ===============================
   STATUS COLOR HELPER
================================ */
  function getStatusColorClass(status, isLocked = false) {
    if (isLocked) {
      switch (status) {
        case "DELIVERED":
          return "bg-green-500 text-white rounded px-2 py-1";
        case "CANCELLED":
          return "bg-red-500 text-white rounded px-2 py-1";
        default:
          return "bg-gray-500 text-white rounded px-2 py-1";
      }
    } else {
      switch (status) {
        case "DELIVERED":
          return "bg-green-100 text-green-800 border-green-200";
        case "PLACED":
          return "bg-orange-500 text-white rounded px-2 py-1";
        case "CANCELLED":
          return "bg-red-100 text-red-800 border-red-200";
        case "CONFIRMED":
          return "bg-blue-500 text-white rounded px-2 py-1";
        default:
          return "bg-gray-100 text-gray-800 border-gray-200";
      }
    }
  }

  /* ===============================
   RENDER ORDERS TABLE
================================ */
  function renderOrders() {
    const tbody = document.getElementById("order-table-body");
    if (!tbody) return;

    let filteredOrders =
      ACTIVE_FILTER === "ALL"
        ? [...ALL_ORDERS] // CLONE to avoid mutation bugs
        : ACTIVE_FILTER === "PENDING"
          ? ALL_ORDERS.filter((o) =>
              ["PLACED", "CONFIRMED"].includes(normalizeStatus(o.status)),
            )
          : ALL_ORDERS.filter(
              (o) => normalizeStatus(o.status) === ACTIVE_FILTER,
            );

    // Apply search filter
    const q = (orderSearchTerm || "").trim().toLowerCase();
    if (q) {
      filteredOrders = filteredOrders.filter((order) => {
        const products = Array.isArray(order.items)
          ? order.items
              .map((i) => i.name || "")
              .join(" ")
              .toLowerCase()
          : "";
        const address = (order.address || "").toLowerCase();
        const status = normalizeStatus(order.status).toLowerCase();
        const id = (order.id || "").toLowerCase();
        const name = (order.userName || "").toLowerCase();
        const email = (order.userEmail || "").toLowerCase();
        const account = (order.userId || "").toLowerCase();
        const date = order.createdAt?.seconds
          ? new Date(order.createdAt.seconds * 1000)
              .toLocaleDateString()
              .toLowerCase()
          : "";

        return (
          products.includes(q) ||
          address.includes(q) ||
          status.includes(q) ||
          id.includes(q) ||
          name.includes(q) ||
          email.includes(q) ||
          account.includes(q) ||
          date.includes(q)
        );
      });
    }

    // Update filtered count display
    const filteredCountEl = document.getElementById("filtered-orders-count");
    if (filteredCountEl) {
      filteredCountEl.textContent = filteredOrders.length;
    }

    if (filteredOrders.length === 0) {
      if (ALL_ORDERS.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="7" class="p-4 text-center text-gray-500">Loading orders...</td></tr>';
      } else {
        tbody.innerHTML =
          '<tr><td colspan="7" class="p-4 text-center text-gray-500">No orders found.</td></tr>';
      }
      return;
    }

    tbody.innerHTML = "";

    // Define status order for sorting
    const statusOrder = { PLACED: 1, CONFIRMED: 2, DELIVERED: 3, CANCELLED: 4 };

    // Sort by status order first, then by latest date
    filteredOrders.sort((a, b) => {
      const aStatus = normalizeStatus(a.status);
      const bStatus = normalizeStatus(b.status);
      const aOrder = statusOrder[aStatus] || 99;
      const bOrder = statusOrder[bStatus] || 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const aTime = a.createdAt?.seconds || 0;
      const bTime = b.createdAt?.seconds || 0;
      return bTime - aTime;
    });

    filteredOrders.forEach((order, index) => {
      const tr = document.createElement("tr");
      tr.className = "border-b hover:bg-gray-50 cursor-pointer";

      const status = normalizeStatus(order.status);
      const locked = ["CANCELLED", "DELIVERED"].includes(status);

      const products = Array.isArray(order.items)
        ? order.items
            .map((i) => `${i.name || "Item"} x${i.quantity || 1}`)
            .join("<br>")
        : "—";

      const date = order.createdAt?.seconds
        ? new Date(order.createdAt.seconds * 1000).toLocaleDateString()
        : "—";

      const shortId = order.id.slice(0, 10).toUpperCase();

      const addressWithArea = order.address
        ? `${order.address}${order.customerInfo?.deliveryArea ? ` (${order.customerInfo.deliveryArea})` : ""}`
        : order.customerInfo?.deliveryArea || "—";

      tr.innerHTML = `
      <td class="p-4 text-xs">${index + 1}</td>
      <td class="p-4 text-xs">${products}</td>
      <td class="p-4 text-xs">${addressWithArea}</td>
      <td class="p-4 text-xs">${date}</td>
      <td class="p-4 text-xs text-right">KES ${order.total ?? 0}</td>

      <td class="p-4 text-xs text-center">
        <span class="status-badge ${getStatusColorClass(status, locked)}">${status}</span>
      </td>

      <td class="p-4 text-center text-xs">
        ${
          status === "DELIVERED"
            ? '<i class="fas fa-check text-green-500 text-lg"></i>'
            : status === "CANCELLED"
              ? '<i class="fas fa-times text-red-500 text-lg"></i>'
              : `<div class="relative">
                 <button class="update-btn px-3 py-1 rounded bg-blue-500 text-white text-xs">
                   Update
                 </button>
                 <div class="update-dropdown hidden absolute top-full mt-1 bg-white border border-gray-300 rounded shadow-lg p-2 z-10 min-w-32">
                   <div class="space-y-2">
                     <label class="flex items-center text-xs">
                       <input type="radio" name="status-${order.id}" value="PLACED" class="mr-2 status-radio" ${status === "PLACED" ? "checked" : ""}>
                       PLACED
                     </label>
                     <label class="flex items-center text-xs">
                       <input type="radio" name="status-${order.id}" value="CONFIRMED" class="mr-2 status-radio" ${status === "CONFIRMED" ? "checked" : ""}>
                       CONFIRMED
                     </label>
                     <label class="flex items-center text-xs">
                       <input type="radio" name="status-${order.id}" value="DELIVERED" class="mr-2 status-radio" ${status === "DELIVERED" ? "checked" : ""}>
                       DELIVERED
                     </label>
                     <label class="flex items-center text-xs">
                       <input type="radio" name="status-${order.id}" value="CANCELLED" class="mr-2 status-radio" ${status === "CANCELLED" ? "checked" : ""}>
                       CANCELLED
                     </label>
                   </div>
                 </div>
               </div>`
        }
      </td>
    `;

      tbody.appendChild(tr);

      /* ===============================
       ROW CLICK → REVIEW
    ================================ */
      tr.addEventListener("click", (e) => {
        if (e.target.tagName === "SELECT" || e.target.tagName === "BUTTON")
          return;
        openReview(order);
      });

      /* ===============================
       UPDATE STATUS
    ================================ */
      const updateBtn = tr.querySelector(".update-btn");
      const updateDropdown = tr.querySelector(".update-dropdown");
      const statusRadios = tr.querySelectorAll(".status-radio");

      if (updateBtn && updateDropdown) {
        updateBtn.addEventListener("click", () => {
          updateDropdown.classList.toggle("hidden");
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", (e) => {
          if (
            !updateBtn.contains(e.target) &&
            !updateDropdown.contains(e.target)
          ) {
            updateDropdown.classList.add("hidden");
          }
        });
      }

      // Handle radio button changes
      statusRadios.forEach((radio) => {
        radio.addEventListener("change", async (e) => {
          const newStatus = e.target.value;
          if (newStatus === status) return;

          try {
            const updateData = {
              status: newStatus,
              updatedAt: serverTimestamp(),
            };
            if (newStatus === "DELIVERED") {
              updateData.deliveredAt = serverTimestamp();
            }

            await updateDoc(doc(db, "orders", order.id), updateData);

            await addDoc(collection(db, "messages"), {
              userId: order.userId,
              type: `ORDER_${newStatus}`,
              title: `Order ${newStatus}`,
              body: `Your order #${shortId} is now ${newStatus}.`,
              orderId: order.id,
              read: false,
              createdAt: serverTimestamp(),
            });

            // If status changed to DELIVERED, send a review prompt message
            if (newStatus === "DELIVERED") {
              await addDoc(collection(db, "messages"), {
                userId: order.userId,
                type: "ORDER_DELIVERED",
                title: "Order Delivered - Please Review",
                body: `Your order #${shortId} has been delivered successfully. We'd love to hear your feedback!`,
                orderId: order.id,
                read: false,
                createdAt: serverTimestamp(),
              });
            }

            order.status = newStatus; // sync local state
            if (newStatus === "DELIVERED") {
              order.deliveredAt = new Date(); // approximate for local state
            }
            renderOrders();
            updateOrderFilterButtons();
            showToast(`Order status updated to ${newStatus}`, "success");
          } catch (err) {
            console.error(err);
            showToast("Failed to update order status", "error");
          }
        });
      });
    });
  }

  /* ===============================
   FILTER BUTTON HANDLERS
================================ */
  // Handlers attached in showSection for "orders"

  /* ===============================
   REVIEW PANEL (TELEGRAM STYLE)
================================ */
  async function openReview(order) {
    const panel = document.getElementById("order-review");
    const content = document.getElementById("order-review-content");
    const message = document.getElementById("no-order-message");

    if (!panel || !content) return;

    if (message) message.classList.add("hidden");
    panel.classList.remove("hidden");

    // Fetch user data from Firestore
    let userData = null;
    const possibleUserIds = [
      order.userId,
      order.userUID,
      order.customerId,
      order.userEmail,
      order.customerEmail,
    ].filter(Boolean);

    // First try to find user by ID
    for (const uid of possibleUserIds) {
      try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
          userData = userDoc.data();
          break; // Found the user data, stop searching
        }
      } catch (err) {
        console.warn("Failed to fetch user data for", uid, err);
      }
    }

    // If no user found by ID, try to find by email
    if (!userData && (order.userEmail || order.customerEmail)) {
      try {
        const usersSnap = await getDocs(collection(db, "users"));
        const emailToFind = order.userEmail || order.customerEmail;
        const userDoc = usersSnap.docs.find(
          (doc) => doc.data().email === emailToFind,
        );
        if (userDoc) {
          userData = userDoc.data();
        }
      } catch (err) {
        console.warn("Failed to fetch user data by email", err);
      }
    }

    // Fallback to order data if user data not found
    const avatar =
      userData?.photoURL ||
      userData?.photo ||
      order.userPhoto ||
      "https://ui-avatars.com/api/?name=" +
        encodeURIComponent(
          userData?.name ||
            userData?.displayName ||
            order.userName ||
            order.customerInfo?.fullName ||
            "User",
        );

    const userName =
      userData?.name ||
      userData?.displayName ||
      order.userName ||
      order.customerInfo?.fullName ||
      "Unknown Customer";
    const userEmail =
      userData?.email ||
      order.userEmail ||
      order.customerInfo?.email ||
      "No email";
    const userPhone =
      userData?.phone || order.customerInfo?.phone || "No phone";
    const paymentMethod = order.paymentMethod || "Not specified";
    const deliveryArea = order.customerInfo?.deliveryArea || "Not specified";

    const initial = userName.charAt(0).toUpperCase();
    const isLetterAvatar = avatar.includes("ui-avatars.com");

    content.innerHTML = `
    <!-- CUSTOMER -->
    <div class="text-center">
      ${
        isLetterAvatar
          ? `<div class="w-14 h-14 rounded-full mx-auto flex items-center justify-center text-white font-bold text-lg" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)">${initial}</div>`
          : `<img src="${avatar}" class="w-14 h-14 rounded-full object-cover border mx-auto" />`
      }
      <div class="mt-2">
        <div class="font-semibold text-gray-900">
          ${userName}
        </div>
      </div>
      <div class="mt-1">
        <div class="text-sm text-gray-500">
          ${userEmail}
        </div>
      </div>
    </div>

    <hr>

    <!-- ORDER META -->
    <div class="grid grid-cols-2 gap-3 text-sm">
      <div>
        <div class="text-gray-500">Order ID</div>
        <div class="font-medium">#${order.id.slice(0, 10).toUpperCase()}</div>
      </div>

      <div>
        <div class="text-gray-500">Status</div>
        <div class="font-medium">${order.status}</div>
      </div>

      <div>
        <div class="text-gray-500">Total</div>
        <div class="font-medium">KES ${order.total ?? 0}</div>
      </div>

      <div>
        <div class="text-gray-500">Date</div>
        <div class="font-medium">
          ${
            order.createdAt?.seconds
              ? new Date(order.createdAt.seconds * 1000).toLocaleString()
              : "—"
          }
        </div>
      </div>

      <div>
        <div class="text-gray-500">Phone</div>
        <div class="font-medium">${userPhone}</div>
      </div>

      <div>
        <div class="text-gray-500">Payment Method</div>
        <div class="font-medium">${paymentMethod}</div>
      </div>

      <div>
        <div class="text-gray-500">Delivery Area</div>
        <div class="font-medium">${deliveryArea}</div>
      </div>

      <div>
        <div class="text-gray-500">Delivery Fee</div>
        <div class="font-medium">KES ${order.deliveryFee || 0}</div>
      </div>

      ${
        order.deliveredAt
          ? `<div>
        <div class="text-gray-500">Delivery Date</div>
        <div class="font-medium">${
          order.deliveredAt?.seconds
            ? new Date(order.deliveredAt.seconds * 1000).toLocaleString()
            : order.deliveredAt instanceof Date
              ? order.deliveredAt.toLocaleString()
              : "—"
        }</div>
      </div>`
          : ""
      }
    </div>

    <hr>

    <!-- ADDRESS -->
    <div>
      <div class="text-gray-500 text-sm mb-1">Delivery Address</div>
      <div class="text-sm p-3 rounded-lg" style="background: linear-gradient(135deg, var(--glass), rgba(255,255,255,0.02))">
        ${order.customerInfo?.address || "—"}
      </div>
    </div>

    <!-- ITEMS -->
    <div>
      <div class="text-gray-500 text-sm mb-2">Items</div>
      <div class="space-y-2">
        ${
          order.items
            ?.map((i) => {
              // Get product image - check multiple possible sources
              const productImg =
                i.img ||
                i.image ||
                i.productImage ||
                "https://via.placeholder.com/60?text=No+Image";
              return `
          <div class="flex items-center justify-between p-3 rounded-lg text-sm" style="background: linear-gradient(135deg, var(--glass), rgba(255,255,255,0.02))">
            <div class="flex items-center gap-3">
              <img src="${productImg}" alt="${i.name}" class="w-14 h-14 rounded-lg object-cover border border-gray-200 shadow-sm" />
              <div class="flex-1">
                <div class="font-medium">${i.name}</div>
                <div class="text-gray-500">Size: ${i.size || "-"}</div>
                <div class="text-gray-500">Color: ${i.color || "-"}</div>
              </div>
            </div>
            <div class="font-medium">x${i.quantity}</div>
          </div>
        `;
            })
            .join("") || "—"
        }
      </div>
    </div>

    ${
      order.cancelReason
        ? `
      <hr>
      <div class="bg-red-50 border border-red-200 p-3 rounded-lg">
        <div class="text-sm font-semibold text-red-600">
          Cancel Reason
        </div>
        <div class="text-sm text-red-700 mt-1">
          ${order.cancelReason}
        </div>
      </div>
    `
        : ""
    }
  `;
  }

  /* ===============================
   CLOSE REVIEW
================================ */
  function closeReview() {
    const panel = document.getElementById("order-review");
    const message = document.getElementById("no-order-message");

    if (panel) panel.classList.add("hidden");
    if (message) message.classList.remove("hidden");
  }

  /* ===============================
   FILTER BUTTONS
================================ */
  // Event listeners attached in showSection for "orders"

  try {
    window.loadOrders = loadOrders;
  } catch (e) {}

  // ===============================
  // PRODUCT FORM
  // ===============================

  // ======= PRODUCT MODAL JS =======

  // ======= ELEMENT REFERENCES =======
  const productForm = document.getElementById("product-form");
  const imageInput = document.getElementById("p-image");
  const previewContainer = document.getElementById("p-image-preview-container");

  // ======= CATEGORY-BASED SIZE SWITCHING =======
  const categoryInput = document.getElementById("p-category");
  const sizesLetter = document.getElementById("sizes-letter");
  const sizesNumeric = document.getElementById("sizes-numeric");

  if (categoryInput && sizesLetter && sizesNumeric) {
    categoryInput.addEventListener("input", function () {
      const categoryValue = this.value.toLowerCase();
      // Show numeric sizes for shoes, letter sizes for everything else
      if (categoryValue.includes("shoe")) {
        sizesLetter.classList.add("hidden");
        sizesNumeric.classList.remove("hidden");
      } else {
        sizesLetter.classList.remove("hidden");
        sizesNumeric.classList.add("hidden");
      }
    });
  }

  // Reset sizes visibility when modal opens (for new products)
  const originalToggleModal = window.toggleModal;
  window.toggleModal = function (id) {
    originalToggleModal(id);
    if (
      id === "product-modal" &&
      categoryInput &&
      sizesLetter &&
      sizesNumeric
    ) {
      // Reset category input and sizes when opening for new product
      if (!document.getElementById("p-id").value) {
        categoryInput.value = "";
        sizesLetter.classList.remove("hidden");
        sizesNumeric.classList.add("hidden");
        // Uncheck all size checkboxes
        document
          .querySelectorAll(".p-size, .p-size-numeric")
          .forEach((cb) => (cb.checked = false));
      }
    }
  };

  // ======= IMAGE PREVIEW SETUP =======
  if (imageInput && previewContainer) {
    imageInput.addEventListener("change", () => {
      previewContainer.innerHTML = ""; // clear old previews
      const files = Array.from(imageInput.files).slice(0, 3); // max 3 files
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.createElement("img");
          img.src = e.target.result;
          img.className = "w-20 h-20 object-cover rounded border mr-2 mb-2";
          previewContainer.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // ======= PRODUCT FORM SUBMISSION =======
  if (productForm) {
    productForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Gather values
      const id = document.getElementById("p-id").value;
      const name = document.getElementById("p-name").value;
      const category = document.getElementById("p-category").value || "-";
      const price = parseFloat(document.getElementById("p-price").value);
      const oldPrice =
        parseFloat(document.getElementById("p-oldPrice").value) || null;
      const stock = parseInt(document.getElementById("p-stock").value);
      const brand = document.getElementById("p-brand").value || "-";
      const description = document.getElementById("p-description").value || "";
      // Get sizes from either letter or numeric checkboxes depending on what's visible
      const sizes =
        Array.from(
          document.querySelectorAll(".p-size:checked, .p-size-numeric:checked"),
        ).map((el) => el.value) || [];
      const files = imageInput ? Array.from(imageInput.files).slice(0, 3) : [];

      if (!name || isNaN(price) || isNaN(stock))
        return showToast("Please fill all fields correctly", "error");

      try {
        // Upload images to Firebase Storage
        let imageUrls = [];
        for (const file of files) {
          const imgRef = storageRef(
            storage,
            `products/${Date.now()}_${file.name}`,
          );
          const snapshot = await uploadBytes(imgRef, file);
          const url = await getDownloadURL(snapshot.ref);
          imageUrls.push(url);
        }

        if (id) {
          // UPDATE EXISTING PRODUCT
          const updateData = {
            name,
            category,
            price,
            oldPrice,
            stock,
            brand,
            description,
            sizes,
          };
          if (imageUrls.length) updateData.images = imageUrls;

          await updateDoc(doc(db, "products", id), updateData);
          showToast("Product updated successfully", "success");
        } else {
          // ADD NEW PRODUCT
          await addDoc(collection(db, "products"), {
            name,
            category,
            brand,
            price,
            oldPrice,
            stock,
            images: imageUrls.length ? imageUrls : ["img/shoes/shoe1.jpg"],
            sizes,
            description,
            colors: [],
            rating: 0,
            reviews: [],
            isActive: true,
            createdAt: serverTimestamp(),
          });
          showToast("Product added successfully", "success");
        }

        // Reset form & modal
        toggleModal("product-modal");
        productForm.reset();
        if (previewContainer) previewContainer.innerHTML = "";
        document.getElementById("p-id").value = "";
        document.getElementById("modal-title").textContent = "Add Product";
      } catch (err) {
        console.error(err);
        showToast("Error saving product", "error");
      }
    });
  }

  window.editProduct = async (id) => {
    const docSnap = await getDocs(collection(db, "products"));
    const product = docSnap.docs.find((d) => d.id === id)?.data();
    if (!product) return showToast("Product not found", "error");

    document.getElementById("p-id").value = id;
    document.getElementById("p-name").value = product.name;
    document.getElementById("p-category").value = product.category;
    document.getElementById("p-price").value = product.price;
    document.getElementById("p-stock").value = product.stock;

    previewContainer.innerHTML = "";
    (product.images || []).slice(0, 3).forEach((url) => {
      const img = document.createElement("img");
      img.src = url;
      img.className = "w-20 h-20 object-cover rounded";
      previewContainer.appendChild(img);
    });

    document.getElementById("modal-title").textContent = "Edit Product";
    toggleModal("product-modal");
  };

  window.deleteProduct = async (id) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    try {
      await deleteDoc(doc(db, "products", id));
      showToast("Product deleted successfully", "success");
    } catch (err) {
      console.error(err);
      showToast("Error deleting product", "error");
    }
  };

  // ===============================
  // INITIAL SECTION
  // ===============================
  showSection("orders");
}

// ===============================
// LOGOUT
// ===============================
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  dashboardInitialized = false;
  stopAllListeners();
  signOut(auth).then(() => window.location.replace("login.html"));
});

// ===============================
// LUCIDE ICONS (robust initializer)
// ===============================
// Initialize Lucide icons, supporting both UMD (window.lucide) and ESM (dynamic import)
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // If the UMD global is present, use it
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
      return;
    }

    // Otherwise attempt a runtime import of the ESM build
    const mod =
      await import("https://unpkg.com/lucide@0.562.0/dist/lucide.esm.js");
    const api =
      mod && (mod.createIcons || mod.default?.createIcons)
        ? mod
        : mod.default || mod;

    if (api && typeof api.createIcons === "function") {
      api.createIcons();
    } else if (api && typeof api.replace === "function") {
      // older API fallback
      api.replace();
    } else {
      console.warn(
        "Lucide loaded but no compatible initializer method found.",
        api,
      );
    }
  } catch (err) {
    console.warn("Lucide icons could not be initialized:", err);
  }
});

// ===============================
// THEME TOGGLE (light / dark) — UI only, persisted in localStorage
// ===============================
function applyTheme(theme) {
  const isLight = theme === "light";
  document.body.classList.toggle("light-theme", isLight);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.dataset.theme = isLight ? "light" : "dark";
  const icon = document.getElementById("themeIcon");
  if (icon) icon.className = isLight ? "fas fa-sun" : "fas fa-moon";
}

function initTheme() {
  const btn = document.getElementById("themeToggle");
  const stored = localStorage.getItem("adminTheme");
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored ? stored : prefersDark ? "dark" : "light";
  applyTheme(theme);
  if (btn) {
    btn.dataset.theme = document.body.classList.contains("light-theme")
      ? "light"
      : "dark";
    btn.addEventListener("click", () => {
      const next = document.body.classList.contains("light-theme")
        ? "dark"
        : "light";
      try {
        localStorage.setItem("adminTheme", next);
      } catch (e) {}
      // Animate first, then swap theme for a smoother visual transition
      btn.classList.add("theme-anim");
      setTimeout(() => {
        applyTheme(next);
        setTimeout(() => btn.classList.remove("theme-anim"), 420);
      }, 90);
    });
  }
}

function initSidebar() {
  const aside = document.querySelector("aside.sidebar");
  const btn = document.getElementById("sidebarCollapse");
  if (!aside) return;
  // Apply persisted collapsed state
  const collapsed = localStorage.getItem("adminSidebarCollapsed") === "1";
  aside.classList.toggle("collapsed", collapsed);
  // Update chevron
  if (btn && btn.querySelector("i")) {
    const icon = btn.querySelector("i");
    icon.classList.toggle("fa-chevron-right", collapsed);
    icon.classList.toggle("fa-chevron-left", !collapsed);
    btn.classList.remove("hidden");
  }

  if (btn) {
    btn.addEventListener("click", () => {
      const isCollapsed = aside.classList.toggle("collapsed");
      localStorage.setItem("adminSidebarCollapsed", isCollapsed ? "1" : "0");
      const icon = btn.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-chevron-right", isCollapsed);
        icon.classList.toggle("fa-chevron-left", !isCollapsed);
      }
    });
  }

  // Hover-to-expand when collapsed
  aside.addEventListener("mouseenter", () => {
    if (aside.classList.contains("collapsed"))
      aside.classList.add("hover-expanded");
  });
  aside.addEventListener("mouseleave", () => {
    aside.classList.remove("hover-expanded");
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth < 768) {
      btn?.classList.add("hidden");
      aside.classList.remove("hover-expanded");
    } else {
      btn?.classList.remove("hidden");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initSidebar();
  });
} else {
  initTheme();
  initSidebar();
}

// ===============================
// DROPDOWNS & NOTIFICATIONS
// ===============================
// ========================================================
// INTEGRATED NOTIFICATION & AUTOMATION MODULE
// ========================================================

const notifBtn = document.getElementById("notifBtn");
const notifDropdown = document.getElementById("notifDropdown");
const notifCount = document.getElementById("notifCount");
const notifList = document.getElementById("notifList");
// Use a known public notification sound; preload it for faster playback
const notificationSound = new Audio("img/ring.wav");

// Preload the audio to start loading immediately
notificationSound.preload = "auto";
// Assuming 'db' is defined and initialized elsewhere in your application
// const db = getFirestore(app);

// --- NEW: LOCALSTORAGE UTILITY ---
// This keeps track of IDs that the user has already clicked/removed
let seenNotifications = JSON.parse(localStorage.getItem("seenNotifs")) || [];

function markAsSeen(id) {
  if (!seenNotifications.includes(id)) {
    seenNotifications.push(id);
    localStorage.setItem("seenNotifs", JSON.stringify(seenNotifications));
  }
}

// 2. CREATE SHARED INFO PANEL
let userInfoPanel =
  document.getElementById("userInfoPanel") ||
  (() => {
    const panel = document.createElement("div");
    panel.id = "userInfoPanel";
    panel.className =
      "hidden fixed bottom-10 right-6 w-80 bg-white border-t-4 border-orange-500 rounded-lg shadow-2xl p-5 z-50 transition-all duration-300";
    document.body.appendChild(panel);
    return panel;
  })();

// 3. DROPDOWN & UI HANDLERS
const toggleDropdown = (e) => {
  if (e) e.stopPropagation();
  const isHidden = notifDropdown.classList.toggle("hidden");
  // reflect open state on button for styling
  notifBtn.classList.toggle("open", !isHidden);
  if (!isHidden) {
    userInfoPanel.classList.add("hidden");
    notifBtn.classList.remove("animate-pulse");
  }
};

notifBtn.addEventListener("click", toggleDropdown);

document.addEventListener("click", (e) => {
  if (!notifDropdown.contains(e.target) && e.target !== notifBtn) {
    notifDropdown.classList.add("hidden");
    notifBtn.classList.remove("open");
  }
});

// 4. CORE LOGIC (Persisted notifications + UI update)
async function createJumiaNotification(id, title, msg, type, data) {
  try {
    // Ensure we have an authenticated user before attempting to write
    if (!auth || !auth.currentUser) {
      console.warn(
        "createJumiaNotification: no authenticated user, falling back to local notification",
      );
      appendLocalNotification(id, title, msg, type, data);
      return;
    }

    const safeMsg =
      typeof msg === "string" ? msg : msg ? JSON.stringify(msg) : "";

    const noteRef = doc(db, "notifications", id);
    const snap = await getDoc(noteRef);

    const isLowStock = id && id.startsWith && id.startsWith("lowstock_");

    // Build payload; include lowStock flag for special handling
    const payload = {
      title: title || "Notification",
      msg: safeMsg,
      type,
      lowStock: isLowStock,
      data: data || {},
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      // New notification
      await setDoc(noteRef, {
        ...payload,
        createdAt: serverTimestamp(),
        readBy: {}, // per-user read tracking
        resolved: false,
      });
    } else {
      // If previously resolved and we are re-triggering (e.g., stock fell again), reopen it for all users
      if (snap.data().resolved) {
        await setDoc(
          noteRef,
          {
            ...payload,
            resolved: false,
            readBy: {},
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        // Merge updates into existing notification without wiping readBy/resolved unless explicitly reopening
        await setDoc(noteRef, payload, { merge: true });
      }
    }
  } catch (err) {
    console.warn("Failed to persist notification:", err);
    if (err && err.code === "permission-denied") {
      showToast(
        "Cannot persist notification: insufficient permissions.",
        "error",
      );
    }
    // Fallback: show a transient in-memory notification so admin sees immediate feedback
    try {
      appendLocalNotification(id, title, msg, type, data);
    } catch (innerErr) {
      console.error("Failed to render local fallback notification:", innerErr);
    }
  }

  // We rely on the realtime listener (notifications snapshot) to render the UI
  notificationSound.play().catch(() => {});
}

// Fallback renderer when Firestore is not available or write fails (no trimming; dropdown will scroll internally)

function appendLocalNotification(id, title, msg, type, data) {
  if (!document.getElementById("notifList")) return;
  const ts = new Date().toLocaleString();
  const li = document.createElement("li");
  li.className = `notif-item ${type || "alert"} unread`;
  li.dataset.id = id;
  li.dataset.payload = JSON.stringify(data || {});
  li.dataset.lowstock =
    id && id.startsWith && id.startsWith("lowstock_") ? "1" : "0";

  li.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="notif-icon-wrapper"><span class="notif-icon ${
        type || "alert"
      }"></span></div>
      <div class="flex-1">
        <div class="flex justify-between items-start">
          <span class="notif-title">${title}</span>
          <span class="notif-ts small-muted">${ts}</span>
        </div>
        <p class="notif-msg">${msg}</p>
      </div>
    </div>
  `;

  const ul = document.getElementById("notifList");
  ul.prepend(li);
  // subtle entry animation
  try {
    li.animate(
      [
        { transform: "translateY(-6px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      { duration: 320, easing: "cubic-bezier(.2,.9,.3,1)" },
    );
  } catch (e) {}

  updateGlobalBadge();
}

// updateGlobalBadge is implemented later with Firestore-aware counting (unread & unresolved).

// 5. EVENT DELEGATION (Mark notifications as read but keep them persistent)
notifList.addEventListener("click", async (e) => {
  const li = e.target.closest("li");
  if (!li || !li.dataset.id) return;
  const id = li.dataset.id;

  try {
    // Use the global currentAdminUid to ensure the UID matches the auth token used for Firestore rules
    if (!currentAdminUid) {
      showToast("You must be signed in to mark notifications as read", "error");
      return;
    }

    await updateDoc(doc(db, "notifications", id), {
      [`readBy.${currentAdminUid}`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("Failed to mark notification read:", err);
    if (err && err.code === "permission-denied") {
      showToast("Permission denied: cannot update notifications", "error");
    } else {
      showToast("Failed to mark notification as read", "error");
    }
  }

  const details = JSON.parse(li.dataset.payload || "{}");
  userInfoPanel.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <h5 class="text-xs font-bold text-gray-400 uppercase">System Alert</h5>
            <button onclick="this.closest('#userInfoPanel').classList.add('hidden')" class="text-gray-300 hover:text-red-500">&times;</button>
        </div>
        <div class="space-y-2">
            ${Object.entries(details)
              .map(
                ([key, val]) => `
                <div>
                    <span class="block text-[9px] text-gray-400 uppercase">${key}</span>
                    <span class="text-xs font-semibold text-gray-800">${val}</span>
                </div>
            `,
              )
              .join("")}
        </div>
    `;
  userInfoPanel.classList.remove("hidden");

  // Visual hint: mark item as read in place
  li.classList.add("read");
  li.classList.remove("unread");
  updateGlobalBadge();
});

// --- NEW FUNCTION: LOW STOCK CHECKER ---
async function checkLowStock(productsArray) {
  const LOW_STOCK_THRESHOLD = 5;

  for (const product of productsArray) {
    const stock = parseInt(product.stock || 0, 10);
    const notificationId = `lowstock_${product.id}`;

    if (stock < LOW_STOCK_THRESHOLD) {
      // Show low stock notification (persisted) unless already resolved
      createJumiaNotification(
        notificationId,
        "Low Stock Alert 📦",
        `"${product.name}" is running low. Stock: ${stock}`,
        "alert",
        {
          "Product ID": product.id,
          "Product Name": product.name,
          "Current Stock": stock,
          "Action Needed": "Reorder Now",
        },
      );
    } else {
      // If product is restocked, mark notification as resolved in Firestore
      try {
        const noteRef = doc(db, "notifications", notificationId);
        const snap = await getDoc(noteRef);
        if (snap.exists()) {
          if (!currentAdminUid) {
            console.warn(
              "Skipping resolve for",
              notificationId,
              "— no authenticated user yet",
            );
          } else {
            await updateDoc(noteRef, {
              resolved: true,
              resolvedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            // Remove from dropdown immediately so UI reflects the resolved state without reload
            const existing = document.querySelector(
              `#notifList li[data-id="${notificationId}"]`,
            );
            if (existing) {
              existing.remove();
            }
          }

          updateGlobalBadge();
        }
      } catch (err) {
        console.warn("Failed to resolve low-stock notification:", err);
      }

      // Remove from seen notifications so future low-stock events will re-notify
      const idx = seenNotifications.indexOf(notificationId);
      if (idx !== -1) {
        seenNotifications.splice(idx, 1);
        localStorage.setItem("seenNotifs", JSON.stringify(seenNotifications));
      }
    }
  }
}

// Controlled listener lifecycle helpers
function startRealtimeListeners() {
  if (listenersStarted) return;
  listenersStarted = true;
  console.debug("startRealtimeListeners: function availability:", {
    loadDashboardStatsRealtime: typeof loadDashboardStatsRealtime,
    loadProducts: typeof loadProducts,
    loadOrders: typeof loadOrders,
    initNotificationsRealtime: typeof initNotificationsRealtime,
  });

  // Dashboard stats (returns an array of unsubs)
  const statsFn =
    typeof loadDashboardStatsRealtime === "function"
      ? loadDashboardStatsRealtime
      : window && typeof window.loadDashboardStatsRealtime === "function"
        ? window.loadDashboardStatsRealtime
        : null;
  if (statsFn) {
    try {
      const statsUnsubs = statsFn();
      if (Array.isArray(statsUnsubs)) activeUnsubs.push(...statsUnsubs);
    } catch (err) {
      console.warn("loadDashboardStatsRealtime failed:", err);
    }
  } else {
    console.warn(
      "startRealtimeListeners: loadDashboardStatsRealtime not available",
    );
  }

  // Products & Orders (return single unsubs)
  const prodFn =
    typeof loadProducts === "function"
      ? loadProducts
      : window && typeof window.loadProducts === "function"
        ? window.loadProducts
        : null;
  if (prodFn) {
    try {
      const prodUnsub = prodFn();
      if (typeof prodUnsub === "function") activeUnsubs.push(prodUnsub);
    } catch (err) {
      console.warn("loadProducts failed:", err);
    }
  } else {
    console.warn("startRealtimeListeners: loadProducts not available");
  }

  const ordersFn =
    typeof loadOrders === "function"
      ? loadOrders
      : window && typeof window.loadOrders === "function"
        ? window.loadOrders
        : null;
  if (ordersFn) {
    try {
      const ordersUnsub = ordersFn();
      if (typeof ordersUnsub === "function") activeUnsubs.push(ordersUnsub);
    } catch (err) {
      console.warn("loadOrders failed:", err);
    }
  } else {
    console.warn("startRealtimeListeners: loadOrders not available");
  }

  // Domain watchers
  const usersWatcherFn =
    typeof watchUsersForNotifications === "function"
      ? watchUsersForNotifications
      : window && typeof window.watchUsersForNotifications === "function"
        ? window.watchUsersForNotifications
        : null;
  if (usersWatcherFn) {
    try {
      activeUnsubs.push(usersWatcherFn());
    } catch (err) {
      console.warn("watchUsersForNotifications failed:", err);
    }
  } else console.warn("watchUsersForNotifications not available");

  const ordersWatcherFn =
    typeof watchOrdersForNotifications === "function"
      ? watchOrdersForNotifications
      : window && typeof window.watchOrdersForNotifications === "function"
        ? window.watchOrdersForNotifications
        : null;
  if (ordersWatcherFn) {
    try {
      activeUnsubs.push(ordersWatcherFn());
    } catch (err) {
      console.warn("watchOrdersForNotifications failed:", err);
    }
  } else console.warn("watchOrdersForNotifications not available");

  const productsWatcherFn =
    typeof watchProductsForLowStock === "function"
      ? watchProductsForLowStock
      : window && typeof window.watchProductsForLowStock === "function"
        ? window.watchProductsForLowStock
        : null;
  if (productsWatcherFn) {
    try {
      activeUnsubs.push(productsWatcherFn());
    } catch (err) {
      console.warn("watchProductsForLowStock failed:", err);
    }
  } else console.warn("watchProductsForLowStock not available");

  // Notifications realtime UI
  const notifFn =
    typeof initNotificationsRealtime === "function"
      ? initNotificationsRealtime
      : window && typeof window.initNotificationsRealtime === "function"
        ? window.initNotificationsRealtime
        : null;
  if (notifFn) {
    try {
      const notifUnsub = notifFn();
      if (typeof notifUnsub === "function") activeUnsubs.push(notifUnsub);
    } catch (err) {
      console.warn("initNotificationsRealtime failed:", err);
    }
  } else {
    console.warn(
      "startRealtimeListeners: initNotificationsRealtime not available",
    );
  }

  console.debug("startRealtimeListeners: started", activeUnsubs.length);
}

function stopAllListeners() {
  if (!listenersStarted && activeUnsubs.length === 0) return;
  activeUnsubs.forEach((u) => {
    try {
      u();
    } catch (err) {
      console.warn("unsubscribe failed", err);
    }
  });
  activeUnsubs = [];
  listenersStarted = false;
  console.debug("stopAllListeners: stopped all listeners");
}

// 6. FIRESTORE LISTENERS (moved behind an explicit admin guard)
function watchUsersForNotifications() {
  return onSnapshot(collection(db, "users"), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added" && !snap.metadata.hasPendingWrites) {
        const user = change.doc.data();
        createJumiaNotification(
          change.doc.id,
          "User Joined",
          user.name || user.fullName || "A new user has joined.",
          "user",
          {
            Name: user.name || user.fullName || "Unknown",
            Email: user.email || "No email",
            Status: "Verified",
            photoURL: user.photoURL || null,
          },
        );
      }
    });
  });
}

function watchOrdersForNotifications() {
  return onSnapshot(collection(db, "orders"), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added" && !snap.metadata.hasPendingWrites) {
        const order = change.doc.data();
        createJumiaNotification(
          change.doc.id,
          "New Order 🛒",
          `Amount: KES ${order.total}`,
          "order",
          {
            "Order ID": `#${change.doc.id.slice(0, 9).toUpperCase()}`,
            Total: `KES ${order.total}`,
            Customer: order.customerInfo?.fullName || "Guest",
          },
        );
      }
    });
  });
}

function watchProductsForLowStock() {
  return onSnapshot(collection(db, "products"), (snap) => {
    const products = [];
    snap.forEach((doc) => products.push({ id: doc.id, ...doc.data() }));
    checkLowStock(products);
  });
}
try {
  window.watchUsersForNotifications = watchUsersForNotifications;
  window.watchOrdersForNotifications = watchOrdersForNotifications;
  window.watchProductsForLowStock = watchProductsForLowStock;
} catch (e) {}

// --- NEW: FIRESTORE LISTENER FOR NOTIFICATIONS (realtime UI + badge)
function initNotificationsRealtime() {
  const notesCol = collection(db, "notifications");
  console.debug("initNotificationsRealtime: listening to notifications");
  const unsub = onSnapshot(
    notesCol,
    (snap) => {
      const ul = document.getElementById("notifList");
      console.debug("notifList element present:", !!ul);
      const archive = document.getElementById("allNotificationsList");
      if (!ul) return;

      if (snap.empty) {
        ul.innerHTML =
          '<li class="p-3 text-slate-500 text-center">No notifications</li>';
        if (archive)
          archive.innerHTML =
            '<div class="p-3 text-center text-gray-400">No notifications</div>';
        updateGlobalBadge(snap.docs);
        return;
      }

      // Sort by unread first, then by createdAt desc
      const docs = snap.docs.slice().sort((a, b) => {
        const aData = a.data();
        const bData = b.data();
        const aRead = currentAdminUid
          ? !!(aData.readBy && aData.readBy[currentAdminUid])
          : false;
        const bRead = currentAdminUid
          ? !!(bData.readBy && bData.readBy[currentAdminUid])
          : false;
        if (aRead !== bRead) return aRead ? 1 : -1; // unread first
        const aT = aData.createdAt?.toMillis?.() || 0;
        const bT = bData.createdAt?.toMillis?.() || 0;
        return bT - aT;
      });

      // Update title to "ALL NOTIFICATIONS"
      const titleDiv = document.querySelector(
        "#notifDropdown > div:first-child",
      );
      if (titleDiv) {
        titleDiv.textContent = "ALL NOTIFICATIONS";
      }

      ul.innerHTML = "";
      if (archive) archive.innerHTML = "";

      docs.forEach((d) => {
        const n = d.data();
        const titleColorClass =
          n.type === "order"
            ? "text-green-500"
            : n.type === "user"
              ? "text-blue-500"
              : "text-red-500";

        // Determine whether this user has read the notification (use global currentAdminUid)
        const isReadForUser = currentAdminUid
          ? !!(n.readBy && n.readBy[currentAdminUid])
          : false;

        const li = document.createElement("li");
        li.className = `notif-item ${n.type || "alert"} ${
          isReadForUser ? "read" : "unread"
        }`;
        li.dataset.id = d.id;
        li.dataset.payload = JSON.stringify(n.data || {});
        li.dataset.lowstock = n.lowStock ? "1" : "0";

        const ts =
          n.createdAt && n.createdAt.toDate
            ? n.createdAt.toDate().toLocaleString()
            : "";
        li.innerHTML = `
          <div class="flex items-start gap-3">
            <div class="notif-icon-wrapper">
              ${n.type === "user" ? (n.data.photoURL ? `<img src="${n.data.photoURL}" class="w-6 h-6 rounded-full object-cover" />` : `<div class="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center text-white text-xs font-bold">${(n.data.Name || "U").charAt(0).toUpperCase()}</div>`) : `<span class="notif-icon ${n.type || "alert"}"></span>`}
            </div>
            <div class="flex-1">
              <div class="flex justify-between items-start">
                <span class="notif-title text-[10px] font-bold uppercase tracking-tighter ${titleColorClass}">${
                  n.title
                }</span>
                <span class="notif-ts small-muted">${ts}</span>
              </div>
              <p class="notif-msg text-sm truncate mt-1">${n.msg}</p>
            </div>
          </div>
      `;

        // Show non-resolved notifications in the dropdown
        if (!n.resolved) ul.appendChild(li);

        // Always include notifications in the archive view (if present)

        // Always include notifications in the archive view (if present)
        if (archive) {
          const aItem = li.cloneNode(true);
          const isRead = isReadForUser;
          const meta = document.createElement("div");
          meta.className = "text-xs text-gray-400 mt-2";
          meta.innerHTML =
            (isRead ? "Read" : "Unread") +
            " • " +
            (n.resolved ? "Resolved" : "Active");
          aItem.appendChild(meta);
          archive.appendChild(aItem);
        }
      });

      // Update badge count based on the full snapshot
      try {
        updateGlobalBadge(snap.docs);
      } catch (e) {
        console.warn("updateGlobalBadge failed", e);
      }
    },
    (err) => {
      console.error("Notifications realtime listener error:", err);
      const ul = document.getElementById("notifList");
      if (ul)
        ul.innerHTML =
          '<li class="p-3 text-red-500 text-center">Notifications unavailable</li>';
    },
  );
  return unsub;
}
try {
  window.initNotificationsRealtime = initNotificationsRealtime;
} catch (e) {}

// Update badge to count unread & unresolved notifications
function updateGlobalBadge(docs) {
  let count = 0;
  const currentUid = currentAdminUid;
  if (Array.isArray(docs)) {
    count = docs.filter((d) => {
      const data = d.data ? d.data() : d;
      if (!data) return false;
      if (data.resolved) return false;
      // Low-stock alerts count until resolved even if the user has read them
      if (data.lowStock) return true;
      // Otherwise count only if current user hasn't read it
      const hasRead = currentUid
        ? data.readBy && !!data.readBy[currentUid]
        : false;
      return !hasRead;
    }).length;
  } else {
    // Fallback DOM-based counting (best-effort when snapshot isn't available yet)
    const lis = Array.from(document.querySelectorAll("#notifList li"));
    count = lis.filter((li) => {
      const isLow = !!li.dataset.lowstock && li.dataset.lowstock !== "0";
      const isRead = li.classList.contains("read");
      if (isLow) return true;
      return !isRead;
    }).length;
  }

  const notifCountEl = document.getElementById("notifCount");
  if (notifCountEl) {
    notifCountEl.textContent = count;
    notifCountEl.classList.toggle("hidden", count === 0);
    if (count > 0) {
      notifBtn.classList.add("animate-pulse");
      // small pop to draw attention when badge updates
      notifCountEl.classList.add("pop");
      setTimeout(() => notifCountEl.classList.remove("pop"), 450);
    } else notifBtn.classList.remove("animate-pulse");
  }
}

// Helper for debugging (call from browser console):
// window.debugCreateNotif('id','title','message','type',{...})
window.debugCreateNotif = (id, title, msg, type, data) => {
  try {
    createJumiaNotification(
      id || `debug_${Date.now()}`,
      title || "Test Notification",
      msg || "This is a test notification",
      type || "alert",
      data || {},
    );
    console.debug("debugCreateNotif: attempted create");
  } catch (err) {
    console.error("debugCreateNotif failed:", err);
  }
};

// MARK ALL READ feature removed — handler deleted per request

// Users count is handled by loadDashboardStatsRealtime() and started/stopped via the listener lifecycle helpers.

const userMenuBtn = document.getElementById("userMenuBtn");
const userDropdown = document.getElementById("userDropdown");

if (!userMenuBtn || !userDropdown) {
  console.error("User dropdown elements not found");
} else {
  // Toggle dropdown
  userMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent document click
    userDropdown.classList.toggle("hidden");
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!userDropdown.contains(e.target) && !userMenuBtn.contains(e.target)) {
      userDropdown.classList.add("hidden");
    }
  });

  // Close on ESC key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      userDropdown.classList.add("hidden");
    }
  });
}
