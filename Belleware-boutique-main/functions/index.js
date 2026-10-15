const functions = require("firebase-functions");
const fetch = require("node-fetch");
require("dotenv").config();

// Load your credentials securely (functions:config:set)
const consumer_key = functions.config().api.consumer_key;
const consumer_secret = functions.config().api.consumer_secret;
const shortcode = functions.config().api.shortcode; // must exist
const lipa_na_mpesa_passkey = functions.config().api.passkey;

const authUrl =
  "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const stkPushUrl =
  "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

// Get access token
async function getAccessToken() {
  const res = await fetch(authUrl, {
    method: "GET",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(consumer_key + ":" + consumer_secret).toString("base64"),
    },
  });
  const data = await res.json();
  return data.access_token;
}

// Cloud Function
exports.stkPush = functions.https.onCall(async (data, context) => {
  const { phone, amount, accountReference, transactionDesc } = data;

  if (!phone || !amount) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Phone and amount are required"
    );
  }

  const token = await getAccessToken();
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  const password = Buffer.from(
    shortcode + lipa_na_mpesa_passkey + timestamp
  ).toString("base64");

  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: "https://yourdomain.com/mpesa-callback",
    AccountReference: accountReference || "Bellewear",
    TransactionDesc: transactionDesc || "Purchase",
  };

  const res = await fetch(stkPushUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  return result;
});

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

// Triggered when a new order is created in the "orders" collection
exports.processNewPODOrder = onDocumentCreated(
  "orders/{orderId}",
  async (event) => {
    const orderData = event.data.data();
    const orderId = event.params.orderId;

    // Only process Cash on Delivery (POD) orders
    if (orderData.paymentMethod !== "POD") return null;

    console.log(`Processing new POD Order: ${orderId}`);

    const db = admin.firestore();
    const batch = db.batch();

    // 1. Automatically update stock for each item in the order
    for (const item of orderData.items) {
      const productRef = db.collection("products").doc(item.productId);
      batch.update(productRef, {
        stock: admin.firestore.FieldValue.increment(-item.quantity),
      });
    }

    // 2. Add an internal log/status for admin tracking
    const orderRef = db.collection("orders").doc(orderId);
    batch.update(orderRef, {
      automatedStatus: "Awaiting Dispatch",
      inventoryUpdated: true,
    });

    return batch.commit();
  }
);
