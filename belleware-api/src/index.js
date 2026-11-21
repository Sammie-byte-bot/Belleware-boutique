/**
 * Bellewear Boutique - M-Pesa (Safaricom Daraja STK Push) on Cloudflare Workers.
 *
 * Routes
 *   POST /api/pay/start     (Firebase login required)  send the STK push
 *   POST /api/pay/status    (Firebase login required)  ask Safaricom if a payment finished
 *   POST /api/pay/callback  (called by Safaricom)      payment result
 *
 * The Worker talks to Firestore through its REST API using a service account,
 * so no Firebase Cloud Functions / Blaze plan is needed. Orders are created
 * here, on the server, only after Safaricom confirms payment.
 */

const enc = new TextEncoder();
const FINAL_STATUSES = ["PAID", "FAILED", "CANCELLED", "REVIEW"];
const MAX_CART_LINES = 50;
const MAX_QUANTITY_PER_LINE = 99;
const PENDING_GUARD_MS = 90 * 1000; // one STK prompt at a time per customer

// ─── Errors / responses ───────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
class FirestoreError extends Error {
  constructor(status, body) {
    super(`Firestore ${status}: ${JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const h = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  // Always echo the request origin so CORS never blocks the fetch.
  // In production, restrict ALLOWED_ORIGINS in wrangler.toml to your real site(s).
  h["Access-Control-Allow-Origin"] = origin || "*";
  return h;
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

function pemToBytes(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function newDocId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return [...crypto.getRandomValues(new Uint8Array(20))]
    .map((b) => chars[b % chars.length])
    .join("");
}

function constantTimeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ─── Firestore value encoding (REST format) ───────────────────────────────────
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toValue(v);
  }
  return fields;
}

function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}

// ─── Google auth for Firestore (service account -> access token) ──────────────
let googleToken = { value: null, expires: 0 };

async function getGoogleAccessToken(env) {
  if (googleToken.value && Date.now() < googleToken.expires - 60_000) {
    return googleToken.value;
  }
  let sa;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing or is not valid JSON.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(
    enc.encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    enc.encode(`${header}.${claim}`),
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${b64url(sig)}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token request failed: ${res.status} ${JSON.stringify(body)}`);
  }
  googleToken = {
    value: body.access_token,
    expires: Date.now() + (body.expires_in || 3600) * 1000,
  };
  return googleToken.value;
}

// ─── Firestore REST client ────────────────────────────────────────────────────
class Firestore {
  constructor(env) {
    this.env = env;
    this.root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  }

  name(path) {
    return `${this.root}/${path}`;
  }

  async post(suffix, body) {
    const token = await getGoogleAccessToken(this.env);
    const res = await fetch(`https://firestore.googleapis.com/v1/${this.root}${suffix}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new FirestoreError(res.status, data);
    return data;
  }

  // Returns an array (same order as `paths`) of data objects, or null if missing.
  async getAll(paths, transaction) {
    const names = paths.map((p) => this.name(p));
    const body = { documents: names };
    if (transaction) body.transaction = transaction;
    const results = await this.post(":batchGet", body);
    const byName = new Map();
    for (const r of results) {
      if (r.found) byName.set(r.found.name, fromFields(r.found.fields));
    }
    return names.map((n) => byName.get(n) ?? null);
  }

  async get(path) {
    return (await this.getAll([path]))[0];
  }

  writeCreate(path, data) {
    return {
      update: { name: this.name(path), fields: toFields(data) },
      currentDocument: { exists: false },
    };
  }

  writeUpdate(path, data) {
    return {
      update: { name: this.name(path), fields: toFields(data) },
      updateMask: { fieldPaths: Object.keys(data).filter((k) => data[k] !== undefined) },
      currentDocument: { exists: true },
    };
  }

  async create(path, data) {
    await this.post(":commit", { writes: [this.writeCreate(path, data)] });
  }

  async update(path, data) {
    await this.post(":commit", { writes: [this.writeUpdate(path, data)] });
  }

  async queryEquals(collectionId, filters, limit = 20) {
    const clauses = Object.entries(filters).map(([field, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: toValue(value) },
    }));
    const results = await this.post(":runQuery", {
      structuredQuery: {
        from: [{ collectionId }],
        where: { compositeFilter: { op: "AND", filters: clauses } },
        limit,
      },
    });
    return results.filter((r) => r.document).map((r) => fromFields(r.document.fields));
  }

  // Reads happen first, writes are queued and committed together (atomic).
  async runTransaction(fn, attempts = 5) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      const { transaction } = await this.post(":beginTransaction", {
        options: { readWrite: {} },
      });
      const writes = [];
      const tx = {
        get: async (path) => (await this.getAll([path], transaction))[0],
        getAll: (paths) => this.getAll(paths, transaction),
        create: (path, data) => writes.push(this.writeCreate(path, data)),
        update: (path, data) => writes.push(this.writeUpdate(path, data)),
      };
      try {
        const result = await fn(tx);
        await this.post(":commit", { writes, transaction });
        return result;
      } catch (err) {
        lastError = err;
        if (err instanceof FirestoreError && err.status === 409) continue; // contention, retry
        await this.post(":rollback", { transaction }).catch(() => {});
        throw err;
      }
    }
    throw lastError;
  }
}

// ─── Verify the customer's Firebase login token ───────────────────────────────
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = { keys: [], expires: 0 };
const importedKeys = new Map();

async function loadJwks(force = false) {
  if (!force && jwksCache.keys.length && Date.now() < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Could not load Firebase public keys (${res.status}).`);
  const body = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  jwksCache = {
    keys: body.keys || [],
    expires: Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000,
  };
  return jwksCache.keys;
}

async function authenticate(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
  if (!m) throw new ApiError(401, "unauthenticated", "Please sign in before paying.");
  const token = m[1];
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError(401, "unauthenticated", "Invalid sign-in token.");

  let header;
  let payload;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch {
    throw new ApiError(401, "unauthenticated", "Invalid sign-in token.");
  }
  if (header.alg !== "RS256" || !header.kid) {
    throw new ApiError(401, "unauthenticated", "Invalid sign-in token.");
  }

  let jwk = (await loadJwks()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await loadJwks(true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new ApiError(401, "unauthenticated", "Invalid sign-in token.");

  let key = importedKeys.get(jwk.kid);
  if (!key) {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    importedKeys.set(jwk.kid, key);
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`),
  );

  const now = Math.floor(Date.now() / 1000);
  const project = env.FIREBASE_PROJECT_ID;
  if (
    !valid ||
    payload.aud !== project ||
    payload.iss !== `https://securetoken.google.com/${project}` ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.exp <= now ||
    payload.iat > now + 300
  ) {
    throw new ApiError(401, "unauthenticated", "Your session has expired. Please sign in again.");
  }
  return payload.sub;
}

// ─── Input validation ─────────────────────────────────────────────────────────
function requireText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new ApiError(400, "invalid-argument", `A valid ${field} is required.`);
  }
  return value.trim();
}

function normalizeKenyanPhone(input) {
  let s = String(input || "").replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (/^0[17]\d{8}$/.test(s)) s = `254${s.slice(1)}`;
  else if (/^[17]\d{8}$/.test(s)) s = `254${s}`;
  if (!/^254[17]\d{8}$/.test(s)) {
    throw new ApiError(400, "invalid-argument", "Enter a valid Safaricom number, e.g. 0712345678.");
  }
  return s;
}

function validateCartLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_CART_LINES) {
    throw new ApiError(400, "invalid-argument", "Your cart is empty or has too many items.");
  }
  return lines.map((line) => {
    if (!line || typeof line !== "object") {
      throw new ApiError(400, "invalid-argument", "A cart item is invalid.");
    }
    const productId = requireText(line.productId, "product", 140);
    if (productId.includes("/")) {
      throw new ApiError(400, "invalid-argument", "A product identifier is invalid.");
    }
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_QUANTITY_PER_LINE
    ) {
      throw new ApiError(400, "invalid-argument", "Each item quantity must be between 1 and 99.");
    }
    return {
      productId,
      size: typeof line.size === "string" ? line.size.trim().slice(0, 100) : "",
      color: typeof line.color === "string" ? line.color.trim().slice(0, 100) : "",
      quantity: line.quantity,
    };
  });
}

function getProductImage(product) {
  const fallback = "img/products/default.jpg";
  const ok = (img) => typeof img === "string" && img.length <= 2048 && !img.startsWith("data:");
  if (Array.isArray(product.images) && typeof product.images[0] === "string") {
    return ok(product.images[0]) ? product.images[0] : fallback;
  }
  if (typeof product.images === "string") return ok(product.images) ? product.images : fallback;
  return ok(product.image) ? product.image : fallback;
}

function failureMessage(resultCode, resultDesc) {
  switch (Number(resultCode)) {
    case 1032: return "You cancelled the M-Pesa request.";
    case 1: return "Your M-Pesa balance is too low for this payment.";
    case 2001: return "The M-Pesa PIN entered was wrong.";
    case 1037: return "The M-Pesa prompt timed out. Please try again.";
    case 1025:
    case 1019:
    case 1001: return "M-Pesa could not process the request right now. Please try again.";
    default: return resultDesc || "The M-Pesa payment was not completed.";
  }
}

// ─── Daraja API ───────────────────────────────────────────────────────────────
const darajaBase = (env) =>
  env.MPESA_ENV === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";

// Daraja wants YYYYMMDDHHmmss. We use Nairobi time (UTC+3).
function darajaTimestamp() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

const stkPassword = (env, timestamp) =>
  btoa(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`);

let darajaToken = { value: null, expires: 0 };

async function getDarajaToken(env) {
  if (darajaToken.value && Date.now() < darajaToken.expires - 60_000) return darajaToken.value;
  const res = await fetch(`${darajaBase(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`)}` },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    console.error("Daraja OAuth failed", res.status, JSON.stringify(body));
    throw new ApiError(503, "unavailable", "M-Pesa is temporarily unavailable. Please try again.");
  }
  darajaToken = {
    value: body.access_token,
    expires: Date.now() + (Number(body.expires_in) || 3599) * 1000,
  };
  return darajaToken.value;
}

async function darajaPost(env, path, payload) {
  const token = await getDarajaToken(env);
  const res = await fetch(`${darajaBase(env)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  return { httpStatus: res.status, body };
}

function callbackUrl(request, env, paymentId) {
  const url = new URL(request.url);
  url.pathname = "/api/pay/callback";
  url.search = "";
  url.searchParams.set("t", env.MPESA_CALLBACK_TOKEN);
  url.searchParams.set("p", paymentId);
  return url.toString();
}

// ─── Settle a payment (shared by callback + status check) ─────────────────────
// Idempotent: a paid order is created at most once (orders/{paymentId}).
async function settlePayment(fs, paymentId, outcome) {
  const payPath = `mpesaPayments/${paymentId}`;
  const orderPath = `orders/${paymentId}`;

  return fs.runTransaction(async (tx) => {
    const pay = await tx.get(payPath);
    if (!pay) return { status: "UNKNOWN" };

    if (
      pay.checkoutRequestId &&
      outcome.checkoutRequestId &&
      pay.checkoutRequestId !== outcome.checkoutRequestId
    ) {
      console.warn("CheckoutRequestID mismatch, ignoring.", paymentId);
      return { status: pay.status };
    }

    const now = new Date();

    // Already settled. Only back-fill the receipt if we learned it late
    // (a status query succeeds without a receipt; the callback carries it).
    if (FINAL_STATUSES.includes(pay.status)) {
      if (pay.status === "PAID" && outcome.receipt && !pay.receipt) {
        tx.update(payPath, { receipt: outcome.receipt, updatedAt: now });
        tx.update(orderPath, { paymentReference: outcome.receipt });
      }
      return { status: pay.status };
    }

    // Failed / cancelled
    if (Number(outcome.resultCode) !== 0) {
      const status = Number(outcome.resultCode) === 1032 ? "CANCELLED" : "FAILED";
      tx.update(payPath, {
        status,
        resultCode: Number(outcome.resultCode),
        resultDesc: outcome.resultDesc || "",
        failureReason: failureMessage(outcome.resultCode, outcome.resultDesc),
        updatedAt: now,
      });
      return { status };
    }

    // Success: sanity-check the amount
    if (outcome.amount != null && Number(outcome.amount) !== pay.total) {
      console.error(
        "M-Pesa amount mismatch - order NOT created, needs manual review.",
        JSON.stringify({ paymentId, expected: pay.total, received: outcome.amount, receipt: outcome.receipt }),
      );
      tx.update(payPath, {
        status: "REVIEW",
        receipt: outcome.receipt || null,
        resultCode: 0,
        failureReason:
          "Payment amount did not match. Please contact support with your M-Pesa receipt.",
        updatedAt: now,
      });
      return { status: "REVIEW" };
    }

    // Success: check stock, then write everything atomically
    const quantities = new Map();
    for (const item of pay.items) {
      quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    }
    const ids = [...quantities.keys()];
    const products = await tx.getAll(ids.map((id) => `products/${id}`));
    const stockOk = products.every(
      (p, i) => p && Number.isSafeInteger(p.stock) && p.stock >= quantities.get(ids[i]),
    );

    if (stockOk) {
      products.forEach((p, i) => {
        tx.update(`products/${ids[i]}`, { stock: p.stock - quantities.get(ids[i]) });
      });
    } else {
      console.error(
        "Paid M-Pesa order has insufficient stock - needs admin review/refund.",
        paymentId,
        outcome.receipt,
      );
    }

    const orderId = `ORD-${Date.now()}-${randomHex(3).toUpperCase()}`;
    tx.create(orderPath, {
      orderId,
      userId: pay.userId,
      items: pay.items,
      subtotal: pay.subtotal,
      deliveryFee: pay.deliveryFee,
      total: pay.total,
      customerInfo: pay.customerInfo,
      paymentMethod: "mpesa",
      paymentStatus: "PAID",
      paymentReference: outcome.receipt || pay.checkoutRequestId || paymentId,
      mpesaPhone: pay.phone,
      status: "PLACED",
      inventoryUpdated: stockOk,
      inventoryIssue: stockOk ? null : "INSUFFICIENT_STOCK_AT_PAYMENT",
      paidAt: now,
      createdAt: now,
    });
    tx.update(payPath, {
      status: "PAID",
      receipt: outcome.receipt || null,
      resultCode: 0,
      orderDocId: paymentId,
      orderId,
      updatedAt: now,
    });
    return { status: "PAID" };
  });
}

// ─── POST /api/pay/start ──────────────────────────────────────────────────────
async function handleStart(request, env) {
  const uid = await authenticate(request, env);
  const fs = new Firestore(env);
  const data = await request.json().catch(() => ({}));

  const phone = normalizeKenyanPhone(data.mpesaPhone);
  const lines = validateCartLines(data.lines);

  const c = data.customerInfo;
  if (!c || typeof c !== "object") {
    throw new ApiError(400, "invalid-argument", "Customer details are required.");
  }
  const email = requireText(c.email, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "invalid-argument", "A valid email address is required.");
  }
  const address = typeof c.address === "string" ? c.address.trim().slice(0, 500) : "";
  if (!address) throw new ApiError(400, "invalid-argument", "A delivery address is required.");

  // Delivery fee comes from Firestore, never from the browser.
  const areaId = requireText(data.deliveryAreaId, "delivery area", 140);
  if (areaId.includes("/")) throw new ApiError(400, "invalid-argument", "The delivery area is invalid.");
  const area = await fs.get(`deliveryAreas/${areaId}`);
  const areaFee = area && (typeof area.fee === "string" && area.fee.trim() ? Number(area.fee) : area.fee);
  if (!area || area.active === false || typeof area.name !== "string" ||
      !Number.isSafeInteger(areaFee) || areaFee < 0) {
    throw new ApiError(409, "failed-precondition", "That delivery area is not available.");
  }

  // One STK prompt at a time per customer.
  const pending = await fs.queryEquals("mpesaPayments", { userId: uid, status: "PENDING" });
  if (pending.some((p) => p.createdAt && Date.now() - p.createdAt.getTime() < PENDING_GUARD_MS)) {
    throw new ApiError(
      429,
      "resource-exhausted",
      "An M-Pesa prompt was just sent to your phone. Please wait a minute before trying again.",
    );
  }

  // Re-price the cart from Firestore.
  const wanted = new Map();
  for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) || 0) + l.quantity);
  const ids = [...wanted.keys()];
  const docs = await fs.getAll(ids.map((id) => `products/${id}`));
  const products = new Map();
  docs.forEach((p, i) => {
    if (!p) throw new ApiError(409, "failed-precondition", "An item in your cart is no longer available.");
    if (!Number.isSafeInteger(p.stock) || p.stock < wanted.get(ids[i])) {
      throw new ApiError(
        409,
        "failed-precondition",
        `${p.name || "An item"} is out of stock or has too little stock left.`,
      );
    }
    if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0) {
      throw new ApiError(409, "failed-precondition", "A product has an invalid price.");
    }
    products.set(ids[i], p);
  });

  let subtotalMinor = 0;
  const items = lines.map((l) => {
    const p = products.get(l.productId);
    const unitMinor = Math.round(p.price * 100);
    subtotalMinor += unitMinor * l.quantity;
    return {
      id: l.productId,
      productId: l.productId,
      name: typeof p.name === "string" ? p.name : "Product",
      price: unitMinor / 100,
      img: getProductImage(p),
      size: l.size,
      color: l.color,
      quantity: l.quantity,
      lineTotal: (unitMinor * l.quantity) / 100,
    };
  });
  const totalMinor = subtotalMinor + areaFee * 100;
  if (totalMinor <= 0 || totalMinor % 100 !== 0) {
    console.error("M-Pesa needs a whole-shilling total.", totalMinor);
    throw new ApiError(409, "failed-precondition", "The order total must be a whole number of shillings.");
  }
  const total = totalMinor / 100;

  if (Number.isFinite(data.expectedTotal) && data.expectedTotal !== total) {
    throw new ApiError(
      409,
      "failed-precondition",
      "Prices in your cart have changed. Please review your cart and try again.",
    );
  }

  // Record the attempt, then fire the STK push.
  const paymentId = newDocId();
  const payPath = `mpesaPayments/${paymentId}`;
  await fs.create(payPath, {
    userId: uid,
    status: "INITIATED",
    items,
    subtotal: subtotalMinor / 100,
    deliveryFee: areaFee,
    total,
    phone,
    customerInfo: {
      fullName: requireText(c.fullName, "name", 120),
      email,
      phone: requireText(c.phone, "phone number", 40),
      address,
      deliveryArea: area.name.trim(),
      deliveryAreaId: areaId,
    },
    createdAt: new Date(),
  });

  const timestamp = darajaTimestamp();
  let result;
  try {
    result = await darajaPost(env, "/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: stkPassword(env, timestamp),
      Timestamp: timestamp,
      TransactionType: env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
      Amount: total,
      PartyA: phone,
      PartyB: env.MPESA_PARTY_B || env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: callbackUrl(request, env, paymentId),
      AccountReference: "BELLEWEAR",
      TransactionDesc: "Bellewear",
    });
  } catch (err) {
    await fs.update(payPath, { status: "FAILED", failureReason: "Could not reach M-Pesa." }).catch(() => {});
    if (err instanceof ApiError) throw err;
    console.error("STK push request error", err);
    throw new ApiError(503, "unavailable", "Could not reach M-Pesa. Please try again.");
  }

  const { body } = result;
  if (String(body.ResponseCode) !== "0" || !body.CheckoutRequestID) {
    console.error("STK push rejected", result.httpStatus, JSON.stringify(body));
    await fs.update(payPath, {
      status: "FAILED",
      failureReason: body.errorMessage || body.ResponseDescription || "M-Pesa rejected the request.",
    });
    throw new ApiError(
      409,
      "failed-precondition",
      "M-Pesa could not send the payment prompt. Check the number and try again.",
    );
  }

  await fs.update(payPath, {
    status: "PENDING",
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID || null,
  });

  return json({ paymentId, total, message: body.CustomerMessage || "Check your phone." });
}

// ─── POST /api/pay/status (fallback if the callback is slow/lost) ─────────────
async function handleStatus(request, env) {
  const uid = await authenticate(request, env);
  const fs = new Firestore(env);
  const data = await request.json().catch(() => ({}));
  const paymentId = requireText(data.paymentId, "payment", 140);
  if (paymentId.includes("/")) throw new ApiError(400, "invalid-argument", "Invalid payment.");

  const pay = await fs.get(`mpesaPayments/${paymentId}`);
  if (!pay || pay.userId !== uid) throw new ApiError(404, "not-found", "Payment not found.");
  if (pay.status !== "PENDING" || !pay.checkoutRequestId) return json({ status: pay.status });

  const timestamp = darajaTimestamp();
  const { body } = await darajaPost(env, "/mpesa/stkpushquery/v1/query", {
    BusinessShortCode: env.MPESA_SHORTCODE,
    Password: stkPassword(env, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: pay.checkoutRequestId,
  });

  // While the customer is still deciding, Daraja answers with an error body and
  // no ResultCode - that just means "not finished yet".
  if (body.ResultCode === undefined) return json({ status: "PENDING" });

  const outcome = await settlePayment(fs, paymentId, {
    resultCode: Number(body.ResultCode),
    resultDesc: body.ResultDesc,
    checkoutRequestId: pay.checkoutRequestId,
    receipt: null, // status queries do not return the receipt number
    amount: null,
  });
  return json({ status: outcome.status });
}

// ─── POST /api/pay/callback (Safaricom) ───────────────────────────────────────
async function handleCallback(request, env) {
  const ack = { ResultCode: 0, ResultDesc: "Accepted" };
  const url = new URL(request.url);

  if (request.method !== "POST" || !constantTimeEqual(url.searchParams.get("t") || "", env.MPESA_CALLBACK_TOKEN || "")) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const payload = await request.json();
    const cb = payload && payload.Body && payload.Body.stkCallback;
    const paymentId = url.searchParams.get("p") || "";
    if (!cb || !paymentId || paymentId.includes("/")) {
      console.warn("Malformed M-Pesa callback", JSON.stringify(payload));
      return json(ack);
    }

    const meta = {};
    for (const item of (cb.CallbackMetadata && cb.CallbackMetadata.Item) || []) {
      meta[item.Name] = item.Value;
    }

    const outcome = await settlePayment(new Firestore(env), paymentId, {
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      checkoutRequestId: cb.CheckoutRequestID,
      receipt: meta.MpesaReceiptNumber || null,
      amount: meta.Amount != null ? Number(meta.Amount) : null,
    });
    console.log("M-Pesa callback processed", paymentId, outcome.status);
  } catch (err) {
    // Never show Safaricom an error; the status check can recover the payment.
    console.error("M-Pesa callback processing failed", err && err.stack ? err.stack : err);
  }
  return json(ack);
}

// ─── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/") return new Response("Bellewear payments worker is running.", { status: 200 });

    try {
      let response;
      if (url.pathname === "/api/pay/callback") {
        return await handleCallback(request, env); // no CORS: Safaricom is a server
      } else if (url.pathname === "/api/pay/start" && request.method === "POST") {
        response = await handleStart(request, env);
      } else if (url.pathname === "/api/pay/status" && request.method === "POST") {
        response = await handleStatus(request, env);
      } else {
        throw new ApiError(404, "not-found", "Not found.");
      }
      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: { code: err.code, message: err.message } }, err.status, cors);
      }
      console.error("Unhandled error", err && err.stack ? err.stack : err);
      return json(
        { error: { code: "internal", message: "Something went wrong. Please try again." } },
        500,
        cors,
      );
    }
  },
};

export { settlePayment, Firestore, toFields, fromFields };
