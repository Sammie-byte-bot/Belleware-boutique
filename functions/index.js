const crypto = require("node:crypto");
const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

admin.initializeApp();

const db = admin.firestore();
const DELIVERY_FEES = {
  "Nairobi CBD": 150,
  Kangemi: 150,
  Kabete: 150,
  Uthiru: 110,
  Kinoo: 150,
};
const LEGACY_PICKUP_POINT_ID = "legacy-store";
const MAX_CART_LINES = 50;
const MAX_QUANTITY_PER_LINE = 99;

function requireText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpsError("invalid-argument", `A valid ${field} is required.`);
  }
  return value.trim();
}

function normalizePaymentMethod(value) {
  if (value === "POD" || value === "pickup") return value;
  throw new HttpsError("invalid-argument", "Choose cash on delivery or store pickup.");
}

async function validateFulfillment(fulfillment, paymentMethod) {
  if (!fulfillment || typeof fulfillment !== "object") {
    throw new HttpsError("invalid-argument", "Fulfillment details are required.");
  }

  if (fulfillment.type === "delivery") {
    const deliveryArea = requireText(fulfillment.deliveryArea, "delivery area", 80);
    if (!Object.hasOwn(DELIVERY_FEES, deliveryArea)) {
      throw new HttpsError("invalid-argument", "Delivery is not available in that area.");
    }
    if (paymentMethod !== "POD") {
      throw new HttpsError(
        "invalid-argument",
        "Delivery orders must use cash on delivery.",
      );
    }
    return {
      value: {type: "delivery", deliveryArea},
      deliveryFee: DELIVERY_FEES[deliveryArea],
    };
  }

  if (fulfillment.type === "pickup") {
    if (paymentMethod !== "pickup") {
      throw new HttpsError(
        "invalid-argument",
        "Store pickup orders must use payment on pickup.",
      );
    }
    const pickupPointId = requireText(fulfillment.pickupPointId, "pickup point", 140);
    if (pickupPointId.includes("/")) {
      throw new HttpsError("invalid-argument", "The pickup point identifier is invalid.");
    }
    if (pickupPointId !== LEGACY_PICKUP_POINT_ID) {
      const pickupPoint = await db.collection("pickupPoints").doc(pickupPointId).get();
      if (!pickupPoint.exists || pickupPoint.data().active !== true) {
        throw new HttpsError("invalid-argument", "That pickup point is not available.");
      }
    }
    return {
      value: {type: "pickup", pickupPointId},
      deliveryFee: 0,
    };
  }

  throw new HttpsError("invalid-argument", "Choose a valid delivery or pickup option.");
}

function validateCartLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_CART_LINES) {
    throw new HttpsError("invalid-argument", "Your cart is empty or contains too many items.");
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
    for (const field of ["size", "color"]) {
      if (line[field] !== undefined &&
          (typeof line[field] !== "string" || line[field].length > 100)) {
        throw new HttpsError("invalid-argument", `The item ${field} is invalid.`);
      }
    }
    return {
      productId,
      size: typeof line.size === "string" ? line.size.trim() : "",
      color: typeof line.color === "string" ? line.color.trim() : "",
      quantity: line.quantity,
    };
  });
}

function getProductImage(product) {
  const defaultImage = "img/products/default.jpg";
  const isReusableImage = (image) =>
    typeof image === "string" &&
    image.length <= 2048 &&
    !image.startsWith("data:");

  if (Array.isArray(product.images) && typeof product.images[0] === "string") {
    return isReusableImage(product.images[0]) ? product.images[0] : defaultImage;
  }
  if (typeof product.images === "string") {
    return isReusableImage(product.images) ? product.images : defaultImage;
  }
  return isReusableImage(product.image) ? product.image : defaultImage;
}

async function createOrder(data, context) {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Sign in before placing an order.");
  }

  const paymentMethod = normalizePaymentMethod(data.paymentMethod);
  const fulfillment = await validateFulfillment(data.fulfillment, paymentMethod);
  const lines = validateCartLines(data.lines);
  const customer = data.customerInfo;
  if (!customer || typeof customer !== "object") {
    throw new HttpsError("invalid-argument", "Customer details are required.");
  }
  const customerInfo = {
    fullName: requireText(customer.fullName, "name", 120),
    email: requireText(customer.email, "email", 254).toLowerCase(),
    phone: requireText(customer.phone, "phone number", 40),
    address: typeof customer.address === "string" ? customer.address.trim().slice(0, 500) : "",
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerInfo.email)) {
    throw new HttpsError("invalid-argument", "A valid email address is required.");
  }
  if (fulfillment.value.type === "delivery" && !customerInfo.address) {
    throw new HttpsError("invalid-argument", "A delivery address is required.");
  }

  const productQuantities = new Map();
  for (const line of lines) {
    productQuantities.set(
      line.productId,
      (productQuantities.get(line.productId) || 0) + line.quantity,
    );
  }
  const productRefs = [...productQuantities.keys()].map((id) =>
    db.collection("products").doc(id),
  );
  const orderRef = db.collection("orders").doc();
  const orderId = `ORD-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const result = await db.runTransaction(async (transaction) => {
    const productSnapshots = await transaction.getAll(...productRefs);
    const products = new Map();

    productSnapshots.forEach((snapshot) => {
      if (!snapshot.exists) {
        throw new HttpsError("failed-precondition", "An item in your cart is no longer available.");
      }
      const product = snapshot.data();
      const stock = product.stock;
      if (!Number.isSafeInteger(stock) || stock < productQuantities.get(snapshot.id)) {
        throw new HttpsError(
          "failed-precondition",
          `${product.name || "An item"} is out of stock or has insufficient quantity.`,
        );
      }
      if (typeof product.price !== "number" || !Number.isFinite(product.price) ||
          product.price < 0) {
        throw new HttpsError("failed-precondition", "A product has an invalid price.");
      }
      products.set(snapshot.id, product);
    });

    let subtotalMinor = 0;
    const items = lines.map((line) => {
      const product = products.get(line.productId);
      const unitPriceMinor = Math.round(product.price * 100);
      const lineTotalMinor = unitPriceMinor * line.quantity;
      subtotalMinor += lineTotalMinor;
      return {
        productId: line.productId,
        name: typeof product.name === "string" ? product.name : "Product",
        price: unitPriceMinor / 100,
        img: getProductImage(product),
        size: line.size,
        color: line.color,
        quantity: line.quantity,
        lineTotal: lineTotalMinor / 100,
      };
    });

    const deliveryFeeMinor = fulfillment.deliveryFee * 100;
    const totalMinor = subtotalMinor + deliveryFeeMinor;
    if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
      throw new HttpsError("failed-precondition", "The order total is invalid.");
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const orderData = {
      orderId,
      userId: context.auth.uid,
      items,
      fulfillment: fulfillment.value,
      customerInfo,
      subtotal: subtotalMinor / 100,
      deliveryFee: fulfillment.deliveryFee,
      total: totalMinor / 100,
      paymentMethod,
      paymentStatus: "UNPAID",
      status: "PLACED_UNPAID",
      inventoryUpdated: false,
      createdAt: now,
    };
    transaction.create(orderRef, orderData);
    return {
      orderDocId: orderRef.id,
      orderId,
      total: totalMinor / 100,
      status: orderData.status,
      orderData: {
        ...orderData,
        createdAt: Date.now(),
      },
    };
  });

  return result;
}

exports.createOrder = onCall(async (request) =>
  createOrder(request.data || {}, request),
);

exports.processConfirmedPickupOrder = onDocumentUpdated(
  "orders/{orderId}",
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (before.status === "CONFIRMED" || after.status !== "CONFIRMED" ||
        !["pickup", "POD"].includes(after.paymentMethod) ||
        after.inventoryUpdated === true) {
      return;
    }

    const orderRef = event.data.after.ref;
    const result = await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) return {updated: false};
      const order = orderSnapshot.data();
      if (order.status !== "CONFIRMED" ||
          !["pickup", "POD"].includes(order.paymentMethod) ||
          order.inventoryUpdated === true) {
        return {updated: false};
      }

      const quantities = new Map();
      for (const item of order.items || []) {
        quantities.set(
          item.productId,
          (quantities.get(item.productId) || 0) + item.quantity,
        );
      }
      const productRefs = [...quantities.keys()].map((id) => db.collection("products").doc(id));
      const productSnapshots = productRefs.length
        ? await transaction.getAll(...productRefs)
        : [];
      const missingStock = productSnapshots.some((snapshot) =>
        !snapshot.exists ||
        !Number.isSafeInteger(snapshot.data().stock) ||
        snapshot.data().stock < quantities.get(snapshot.id),
      );

      if (missingStock) {
        transaction.update(orderRef, {
          inventoryIssue: "INSUFFICIENT_STOCK_AT_CONFIRMATION",
        });
        return {updated: false, inventoryIssue: true};
      }

      for (const snapshot of productSnapshots) {
        transaction.update(snapshot.ref, {
          stock: snapshot.data().stock - quantities.get(snapshot.id),
        });
      }
      transaction.update(orderRef, {
        inventoryUpdated: true,
        inventoryUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        inventoryIssue: null,
      });
      return {updated: true};
    });

    if (result.inventoryIssue) {
      logger.error("Confirmed unpaid order requires inventory review.", {
        orderId: event.params.orderId,
      });
    }
  },
);
