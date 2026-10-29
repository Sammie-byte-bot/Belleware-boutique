// trust.js: standalone. WhatsApp button, size guide (product page) and footer policy links.
// Styled with Tailwind (compiled into trust.css, which this script loads by itself).
// Add to any page:  <script src="trust.js" defer></script>

// ---- EDIT THESE ----
const WA_NUMBER = "254117355310"; // international format, no "+" or spaces. Must be a WhatsApp number.
const WA_GREETING = "Hello Bellewear Boutique, I need help with";

// Approximate sizes. Fits vary by brand; edit to match your real stock/suppliers.
const CLOTHING = [
  ["XS", "82–87", "66–72"],
  ["S", "88–95", "73–80"],
  ["M", "96–103", "81–88"],
  ["L", "104–111", "89–96"],
  ["XL", "112–119", "97–104"],
];
const SHOE_EU = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46];

(function () {
  const SCRIPT = document.currentScript;

  // Load trust.css (next to this file) unless the page already links it
  if (!document.querySelector('link[href*="trust.css"]')) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/trust\.js(\?.*)?$/, "trust.css") : "trust.css";
    document.head.appendChild(l);
  }

  // ---- WhatsApp button ----
  function addWhatsApp() {
    const text = encodeURIComponent(
      `${WA_GREETING} ${document.title.split("|")[0].trim()} (${location.href})`
    );
    const a = document.createElement("a");
    a.className =
      "fixed bottom-4 right-4 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-white shadow-lg transition hover:scale-110";
    a.href = `https://wa.me/${WA_NUMBER}?text=${text}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.setAttribute("aria-label", "Chat with us on WhatsApp");
    a.innerHTML =
      '<svg width="28" height="32" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true"><path d="M380.9 97.1c-41.9-42-97.7-65.1-157-65.1-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480 117.7 449.1c32.4 17.7 68.9 27 106.1 27l.1 0c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3 18.6-68.1-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1s56.2 81.2 56.1 130.5c0 101.8-84.9 184.6-186.6 184.6zM325.1 300.5c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8s-14.3 18-17.6 21.8c-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7 .9-6.9-.5-9.7s-12.5-30.1-17.1-41.2c-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2s-9.7 1.4-14.8 6.9c-5.1 5.6-19.4 19-19.4 46.3s19.9 53.7 22.6 57.4c2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4s4.6-24.1 3.2-26.4c-1.3-2.5-5-3.9-10.5-6.6z"/></svg>';
    document.body.appendChild(a);
  }

  // ---- Size guide (only on pages with #sizeVariant, i.e. product.html) ----
  function addSizeGuide() {
    const sizeVariant = document.getElementById("sizeVariant");
    if (!sizeVariant) return;

    const link = document.createElement("button");
    link.type = "button";
    link.className = "my-2 inline-block cursor-pointer border-0 bg-transparent p-0 text-sm text-brand underline";
    link.textContent = "Size guide";
    sizeVariant.insertAdjacentElement("afterend", link); // sibling, so product.js re-renders don't remove it

    const th = "border border-gray-200 bg-gray-100 px-2 py-1.5 text-center";
    const td = "border border-gray-200 px-2 py-1.5 text-center";
    const clothesRows = CLOTHING.map(
      (r) => `<tr><td class="${td}">${r[0]}</td><td class="${td}">${r[1]}</td><td class="${td}">${r[2]}</td></tr>`
    ).join("");
    const shoeRows = SHOE_EU.map(
      (eu) => `<tr><td class="${td}">${eu}</td><td class="${td}">≈ ${(eu / 1.5 - 1.5).toFixed(1)}</td></tr>`
    ).join("");

    const tabBase = "mr-2 cursor-pointer rounded border px-3 py-1.5 text-sm";
    const tabOn = "border-ink bg-ink text-white";
    const tabOff = "border-gray-300 bg-white text-ink";

    const bg = document.createElement("div");
    bg.className = "fixed inset-0 z-[10000] hidden items-center justify-center bg-black/55 p-4";
    bg.innerHTML = `<div class="max-h-[85vh] w-full max-w-md overflow-auto rounded-xl bg-white p-5 text-ink" role="dialog" aria-label="Size guide">
      <button class="float-right cursor-pointer border-0 bg-transparent text-2xl leading-none" data-close aria-label="Close">×</button>
      <h3 class="mb-3 text-lg font-semibold">Size guide</h3>
      <div>
        <button type="button" class="${tabBase} ${tabOn}" data-t="c">Clothing</button>
        <button type="button" class="${tabBase} ${tabOff}" data-t="s">Shoes</button>
      </div>
      <div data-p="c"><table class="my-3 w-full border-collapse text-sm"><tr><th class="${th}">Size</th><th class="${th}">Chest (cm)</th><th class="${th}">Waist (cm)</th></tr>${clothesRows}</table></div>
      <div data-p="s" class="hidden"><table class="my-3 w-full border-collapse text-sm"><tr><th class="${th}">EU size</th><th class="${th}">Foot length (cm)</th></tr>${shoeRows}</table></div>
      <p class="text-xs text-gray-500">Measurements are approximate and fit varies by item. If you are between sizes, choose the larger one.
      Some imported items run small. Not sure? WhatsApp us before you order.</p></div>`;
    document.body.appendChild(bg);

    const open = () => { bg.classList.remove("hidden"); bg.classList.add("flex"); };
    const close = () => { bg.classList.add("hidden"); bg.classList.remove("flex"); };
    link.addEventListener("click", open);
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    bg.querySelector("[data-close]").addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    bg.querySelectorAll("[data-t]").forEach((b) =>
      b.addEventListener("click", () => {
        bg.querySelectorAll("[data-t]").forEach((x) => {
          x.className = `${tabBase} ${x === b ? tabOn : tabOff}`;
        });
        bg.querySelectorAll("[data-p]").forEach((p) => p.classList.toggle("hidden", p.dataset.p !== b.dataset.t));
      })
    );

    // Hide the link for products that have no sizes (re-checks whenever product.js re-renders the selector)
    const sync = () => {
      link.style.display = sizeVariant.querySelector("select option[value]:not([value=''])") ? "" : "none";
    };
    new MutationObserver(sync).observe(sizeVariant, { childList: true, subtree: true });
    sync();
  }

  // ---- Footer links: point dead "#" links at the policies page ----
  function fixFooterLinks() {
    const map = {
      "about us": ["about.html"],
      "privacy policy": ["policies.html#privacy"],
      "terms and condition": ["policies.html#terms"],
      "delivery information": ["policies.html#returns", "Returns & refunds"],
    };
    document.querySelectorAll('footer a[href="#"]').forEach((a) => {
      const hit = map[a.textContent.trim().toLowerCase()];
      if (!hit) return;
      a.setAttribute("href", hit[0]);
      if (hit[1]) a.textContent = hit[1];
    });
  }

  function init() { addWhatsApp(); addSizeGuide(); fixFooterLinks(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
