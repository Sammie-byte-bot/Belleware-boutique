/**
 * M-Pesa (Safaricom Daraja) STK Push for Bellewear Boutique.
 *
 * Flow:
 *   1. Customer clicks "Pay Now" on checkout.html with M-Pesa selected.
 *   2. initiateMpesaPayment  -> validates the cart against Firestore prices,
 *      writes mpesaPayments/{paymentId} (status PENDING) and sends the STK push.
 *   3. Customer enters their M-Pesa PIN on their phone.
 *   4. Safaricom calls paymentCallback -> we verify it, deduct stock and create
 *      orders/{paymentId} (status PLACED, paymentStatus PAID) in ONE transaction.
 *   5. The checkout page is listening to mpesaPayments/{paymentId} and shows success.
 *   6. checkMpesaPayment is a fallback that asks Safaricom directly if a callback
 *      never arrives.
 *
 * Orders are only ever created here, on the server, after Safaricom confirms
 * payment. The browser can never mark an M-Pesa order as paid.
 */

const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret, defineString} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

// ─── Configuration ────────────────────────────────────────────────────────────
// Secrets:  firebase functions:secrets:set MPESA_CONSUMER_KEY   (etc.)
// Strings:  functions/.env  (see functions/.env.example)
const CONSUMER_KEY = defineSecret("9f4f7dh9Lul64Z1tWMyEPLH6et6uEXyzaYO6KNGO3LGGKSZl");
const CONSUMER_SECRET = defineSecret("lE3lgv7vpA4wqwPCCDajFHA3SkzGRVCv8RcWsxZGMkG2jNXMWP1aoLxorHLgzYej");
const PASSKEY = defineSecret("d08c400286cde90ed920ba19f5debafbc9ca1aee395ddc76b830e7082a9b63f0");
const CALLBACK_TOKEN = defineSecret("MPESA_CALLBACK_TOKEN");

const MPESA_ENV = defineString("MPESA_ENV", {default: "production"});
const SHORTCODE = defineString("MPESA_SHORTCODE");
// CustomerPayBillOnline for a Paybill, CustomerBuyGoodsOnline for a Till number.
const TRANSACTION_TYPE = defineString("MPESA_TRANSACTION_TYPE", {
  default: "CustomerPayBillOnline",
});
// Only needed for Till numbers where the Store (HO) number differs from the Till.
const PARTY_B = defineString("MPESA_PARTY_B", {default: ""});
// Leave empty to use https://us-central1-<project>.cloudfunctions.net/paymentCallback
const CALLBACK_BASE_URL = defineString("MPESA_CALLBACK_BASE_URL", {default: ""});

const REGION = "us-central1";
const SECRETS = [CONSUMER_KEY, CONSUMER_SECRET, PASSKEY, CALLBACK_TOKEN];

const MAX_CART_LINES = 50;
const MAX_QUANTITY_PER_LINE = 99;
const PENDING_GUARD_MS = 90 * 1000; // one STK prompt at a time per customer
const FINAL_STATUSES = ["PAID", "FAILED", "CANCELLED", "REVIEW"];

const db = () => admin.firestore();

// ─── Small helpers ────────────────────────────────────────────────────────────
function requireText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpsError("invalid-argument", `A valid ${field} is required.`);
  }
  return value.trim();
}

function normalizeKenyanPhone(input) {
  let s = String(input || "").replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (/^0[17]\d{8}$/.test(s)) s = `254${s.slice(1)}`;
  else if (/^[17]\d{8}$/.test(s)) s = `254${s}`;
  if (!/^254[17]\d{8}$/.test(s)) {
    throw new HttpsError(
        "invalid-argument",
        "Enter a valid Safaricom number, e.g. 0712345678.",
    );
  }
  return s;
}

function getProductImage(product) {
  const fallback = "img/products/default.jpg";
  const ok = (img) =>
    typeof img === "string" && img.length <= 2048 && !img.startsWith("data:");
  if (Array.isArray(product.images) && typeof product.images[0] === "string") {
    return ok(product.images[0]) ? product.images[0] : fallback;
  }
  if (typeof product.images === "string") {
    return ok(product.images) ? product.images : fallback;
  }
  return ok(product.image) ? product.image : fallback;
}

function validateCartLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_CART_LINES) {
    throw new HttpsError("invalid-argument", "Your cart is empty or has too many items.");
  }
  return lines.map((line) => {
    if (!line || typeof line !== "object") {
      throw new HttpsError("invalid-argument", "A cart item is invalid.");
    }
    const productId = requireText(line.productId, "product", 140);
    if (productId.includes("/")) {
      throw new HttpsError("invalid-argument", "A product identifier is invalid.");
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 ||
        line.quantity > MAX_QUANTITY_PER_LINE) {
      throw new HttpsError("invalid-argument", "Each item quantity must be between 1 and 99.");
    }
    return {
      productId,
      size: typeof line.size === "string" ? line.size.trim().slice(0, 100) : "",
      color: typeof line.color === "string" ? line.color.trim().slice(0, 100) : "",
      quantity: line.quantity,
    };
  });
}

// Daraja wants YYYYMMDDHHmmss. We use Nairobi time (UTC+3).
function darajaTimestamp() {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
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
function darajaBase() {
  return MPESA_ENV.value() === "sandbox" ?
    "https://sandbox.safaricom.co.ke" :
    "https://api.safaricom.co.ke";
}

async function getAccessToken() {
  const basic = Buffer.from(
      `${CONSUMER_KEY.value()}:${CONSUMER_SECRET.value()}`,
  ).toString("base64");
  const res = await fetch(
      `${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`,
      {headers: {Authorization: `Basic ${basic}`}, signal: AbortSignal.timeout(20000)},
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    logger.error("Daraja OAuth failed", {status: res.status, body});
    throw new HttpsError("unavailable", "M-Pesa is temporarily unavailable. Please try again.");
  }
  return body.access_token;
}

async function darajaPost(path, payload) {
  const token = await getAccessToken();
  const res = await fetch(`${darajaBase()}${path}`, {
    method: "POST",
    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  return {httpStatus: res.status, body};
}

function stkPassword(timestamp) {
  return Buffer.from(`${SHORTCODE.value()}${PASSKEY.value()}${timestamp}`).toString("base64");
}

function callbackUrl(paymentId) {
  const base = CALLBACK_BASE_URL.value() ||
    `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/paymentCallback`;
  const url = new URL(base);
  url.searchParams.set("t", CALLBACK_TOKEN.value());
  url.searchParams.set("p", paymentId);
  return url.toString();
}

// ─── Settling a payment (shared by callback + status check) ───────────────────
/**
 * Apply a Safaricom result to a payment. Safe to call many times: it is
 * idempotent, and a paid order is created at most once (orders/{paymentId}).
 */
async function settlePayment(paymentId, outcome) {
  const payRef = db().collection("mpesaPayments").doc(paymentId);
  const orderRef = db().collection("orders").doc(paymentId);

  return db().runTransaction(async (tx) => {
    const paySnap = await tx.get(payRef);
    if (!paySnap.exists) return {status: "UNKNOWN"};
    const pay = paySnap.data();

    if (pay.checkoutRequestId && outcome.checkoutRequestId &&
        pay.checkoutRequestId !== outcome.checkoutRequestId) {
      logger.warn("CheckoutRequestID mismatch, ignoring.", {paymentId});
      return {status: pay.status};
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Already settled: only back-fill the receipt number if we learned it late
    // (a status query succeeds without a receipt; the callback carries it).
    if (FINAL_STATUSES.includes(pay.status)) {
      if (pay.status === "PAID" && outcome.receipt && !pay.receipt) {
        tx.update(payRef, {receipt: outcome.receipt, updatedAt: now});
        tx.update(orderRef, {paymentReference: outcome.receipt});
      }
      return {status: pay.status};
    }

    // ── Failed / cancelled ──
    if (Number(outcome.resultCode) !== 0) {
      const status = Number(outcome.resultCode) === 1032 ? "CANCELLED" : "FAILED";
      tx.update(payRef, {
        status,
        resultCode: Number(outcome.resultCode),
        resultDesc: outcome.resultDesc || "",
        failureReason: failureMessage(outcome.resultCode, outcome.resultDesc),
        updatedAt: now,
      });
      return {status};
    }

    // ── Success: sanity-check the amount ──
    if (outcome.amount != null && Number(outcome.amount) !== pay.total) {
      logger.error("M-Pesa amount mismatch - order NOT created, needs manual review.", {
        paymentId, expected: pay.total, received: outcome.amount, receipt: outcome.receipt,
      });
      tx.update(payRef, {
        status: "REVIEW",
        receipt: outcome.receipt || null,
        resultCode: 0,
        failureReason: "Payment amount did not match. Please contact support with your M-Pesa receipt.",
        updatedAt: now,
      });
      return {status: "REVIEW"};
    }

    // ── Success: read stock, then write everything atomically ──
    const quantities = new Map();
    for (const item of pay.items) {
      quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    }
    const productSnaps = await tx.getAll(
        ...[...quantities.keys()].map((id) => db().collection("products").doc(id)),
    );
    const stockOk = productSnaps.every((s) =>
      s.exists && Number.isSafeInteger(s.data().stock) &&
      s.data().stock >= quantities.get(s.id));

    if (stockOk) {
      for (const s of productSnaps) {
        tx.update(s.ref, {stock: s.data().stock - quantities.get(s.id)});
      }
    } else {
      logger.error("Paid M-Pesa order has insufficient stock - needs admin review/refund.", {
        paymentId, receipt: outcome.receipt,
      });
    }

    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    tx.create(orderRef, {
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
    tx.update(payRef, {
      status: "PAID",
      receipt: outcome.receipt || null,
      resultCode: 0,
      orderDocId: orderRef.id,
      orderId,
      updatedAt: now,
    });
    return {status: "PAID"};
  });
}

// ─── 1. Start a payment (STK push) ────────────────────────────────────────────
exports.initiateMpesaPayment = onCall(
    {region: REGION, secrets: SECRETS, timeoutSeconds: 60},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sign in before paying.");
      }
      const uid = request.auth.uid;
      const data = request.data || {};

      const phone = normalizeKenyanPhone(data.mpesaPhone);
      const lines = validateCartLines(data.lines);

      const c = data.customerInfo;
      if (!c || typeof c !== "object") {
        throw new HttpsError("invalid-argument", "Customer details are required.");
      }
      const email = requireText(c.email, "email", 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpsError("invalid-argument", "A valid email address is required.");
      }
      const address = typeof c.address === "string" ? c.address.trim().slice(0, 500) : "";
      if (!address) {
        throw new HttpsError("invalid-argument", "A delivery address is required.");
      }

      // Delivery area + fee come from Firestore, never from the browser.
      const areaId = requireText(data.deliveryAreaId, "delivery area", 140);
      if (areaId.includes("/")) {
        throw new HttpsError("invalid-argument", "The delivery area is invalid.");
      }
      const areaSnap = await db().collection("deliveryAreas").doc(areaId).get();
      const area = areaSnap.exists ? areaSnap.data() : null;
      const areaFee = area && (typeof area.fee === "string" && area.fee.trim() ?
        Number(area.fee) : area.fee);
      if (!area || area.active === false || typeof area.name !== "string" ||
          !Number.isSafeInteger(areaFee) || areaFee < 0) {
        throw new HttpsError("failed-precondition", "That delivery area is not available.");
      }

      // One STK prompt at a time per customer.
      const recent = await db().collection("mpesaPayments")
          .where("userId", "==", uid).where("status", "==", "PENDING").get();
      const stillActive = recent.docs.some((d) => {
        const t = d.data().createdAt;
        return t && Date.now() - t.toMillis() < PENDING_GUARD_MS;
      });
      if (stillActive) {
        throw new HttpsError(
            "resource-exhausted",
            "An M-Pesa prompt was just sent to your phone. Please wait a minute before trying again.",
        );
      }

      // Re-price the cart from Firestore.
      const ids = [...new Set(lines.map((l) => l.productId))];
      const snaps = await db().getAll(...ids.map((id) => db().collection("products").doc(id)));
      const products = new Map();
      const wanted = new Map();
      for (const l of lines) wanted.set(l.productId, (wanted.get(l.productId) || 0) + l.quantity);
      for (const s of snaps) {
        if (!s.exists) {
          throw new HttpsError("failed-precondition", "An item in your cart is no longer available.");
        }
        const p = s.data();
        if (!Number.isSafeInteger(p.stock) || p.stock < wanted.get(s.id)) {
          throw new HttpsError(
              "failed-precondition",
              `${p.name || "An item"} is out of stock or has too little stock left.`,
          );
        }
        if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0) {
          throw new HttpsError("failed-precondition", "A product has an invalid price.");
        }
        products.set(s.id, p);
      }

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
        logger.error("M-Pesa needs a whole-shilling total.", {totalMinor});
        throw new HttpsError("failed-precondition", "The order total must be a whole number of shillings.");
      }
      const total = totalMinor / 100;

      if (Number.isFinite(data.expectedTotal) && data.expectedTotal !== total) {
        throw new HttpsError(
            "failed-precondition",
            "Prices in your cart have changed. Please review your cart and try again.",
        );
      }

      // Record the payment attempt, then fire the STK push.
      const payRef = db().collection("mpesaPayments").doc();
      const paymentId = payRef.id;
      await payRef.set({
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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const timestamp = darajaTimestamp();
      let result;
      try {
        result = await darajaPost("/mpesa/stkpush/v1/processrequest", {
          BusinessShortCode: SHORTCODE.value(),
          Password: stkPassword(timestamp),
          Timestamp: timestamp,
          TransactionType: TRANSACTION_TYPE.value(),
          Amount: total,
          PartyA: phone,
          PartyB: PARTY_B.value() || SHORTCODE.value(),
          PhoneNumber: phone,
          CallBackURL: callbackUrl(paymentId),
          AccountReference: "BELLEWEAR",
          TransactionDesc: "Bellewear",
        });
      } catch (err) {
        await payRef.update({status: "FAILED", failureReason: "Could not reach M-Pesa."});
        if (err instanceof HttpsError) throw err;
        logger.error("STK push request error", err);
        throw new HttpsError("unavailable", "Could not reach M-Pesa. Please try again.");
      }

      const {body} = result;
      if (String(body.ResponseCode) !== "0" || !body.CheckoutRequestID) {
        logger.error("STK push rejected", {httpStatus: result.httpStatus, body});
        await payRef.update({
          status: "FAILED",
          failureReason: body.errorMessage || body.ResponseDescription || "M-Pesa rejected the request.",
        });
        throw new HttpsError(
            "failed-precondition",
            "M-Pesa could not send the payment prompt. Check the number and try again.",
        );
      }

      await payRef.update({
        status: "PENDING",
        checkoutRequestId: body.CheckoutRequestID,
        merchantRequestId: body.MerchantRequestID || null,
      });

      return {paymentId, total, message: body.CustomerMessage || "Check your phone."};
    },
);

// ─── 2. Safaricom calls this when the customer pays / cancels ─────────────────
exports.paymentCallback = onRequest(
    {region: REGION, secrets: [CALLBACK_TOKEN], timeoutSeconds: 60},
    async (req, res) => {
      const ack = {ResultCode: 0, ResultDesc: "Accepted"};

      const given = Buffer.from(String(req.query.t || ""));
      const expected = Buffer.from(CALLBACK_TOKEN.value());
      if (req.method !== "POST" || given.length !== expected.length ||
          !crypto.timingSafeEqual(given, expected)) {
        res.status(403).send("Forbidden");
        return;
      }

      try {
        const cb = req.body && req.body.Body && req.body.Body.stkCallback;
        const paymentId = String(req.query.p || "");
        if (!cb || !paymentId || paymentId.includes("/")) {
          logger.warn("Malformed M-Pesa callback", {body: req.body});
          res.status(200).json(ack);
          return;
        }

        const meta = {};
        for (const item of (cb.CallbackMetadata && cb.CallbackMetadata.Item) || []) {
          meta[item.Name] = item.Value;
        }

        const outcome = await settlePayment(paymentId, {
          resultCode: cb.ResultCode,
          resultDesc: cb.ResultDesc,
          checkoutRequestId: cb.CheckoutRequestID,
          receipt: meta.MpesaReceiptNumber || null,
          amount: meta.Amount != null ? Number(meta.Amount) : null,
        });
        logger.info("M-Pesa callback processed", {paymentId, status: outcome.status});
      } catch (err) {
        // Never let Safaricom see an error; the status check below can recover.
        logger.error("M-Pesa callback processing failed", err);
      }
      res.status(200).json(ack);
    },
);

// ─── 3. Fallback: ask Safaricom directly if the callback never arrived ────────
exports.checkMpesaPayment = onCall(
    {region: REGION, secrets: SECRETS, timeoutSeconds: 60},
    async (request) => {
      if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
      const paymentId = requireText(request.data && request.data.paymentId, "payment", 140);
      if (paymentId.includes("/")) throw new HttpsError("invalid-argument", "Invalid payment.");

      const payRef = db().collection("mpesaPayments").doc(paymentId);
      const snap = await payRef.get();
      if (!snap.exists || snap.data().userId !== request.auth.uid) {
        throw new HttpsError("not-found", "Payment not found.");
      }
      const pay = snap.data();
      if (pay.status !== "PENDING" || !pay.checkoutRequestId) {
        return {status: pay.status};
      }

      const timestamp = darajaTimestamp();
      const {body} = await darajaPost("/mpesa/stkpushquery/v1/query", {
        BusinessShortCode: SHORTCODE.value(),
        Password: stkPassword(timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: pay.checkoutRequestId,
      });

      // While the customer is still deciding Daraja answers with an error body
      // and no ResultCode - that just means "not finished yet".
      if (body.ResultCode === undefined) return {status: "PENDING"};

      const outcome = await settlePayment(paymentId, {
        resultCode: Number(body.ResultCode),
        resultDesc: body.ResultDesc,
        checkoutRequestId: pay.checkoutRequestId,
        receipt: null, // status queries do not return the receipt number
        amount: null,
      });
      return {status: outcome.status};
    },
);
