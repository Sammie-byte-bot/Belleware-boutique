
# M-Pesa (Daraja STK Push) setup — Bellewear Boutique

## How it works

1. Customer picks **M-Pesa** on checkout, confirms their number, clicks **Pay with M-Pesa**.
2. `initiateMpesaPayment` re-prices the cart from Firestore (the browser can't change prices) and sends the STK push.
3. Customer enters their PIN. Safaricom calls `paymentCallback`.
4. The server verifies the callback, deducts stock and creates the order (`PLACED`, `paymentStatus: PAID`) in one transaction.
5. Checkout is listening to `mpesaPayments/{id}` and shows the success screen → receipt.
6. If the callback is slow, checkout asks Safaricom directly (`checkMpesaPayment`) at 45s and 90s.

Orders for M-Pesa are created **only on the server, after Safaricom confirms**. Failed/cancelled attempts stay in `mpesaPayments` and never show up as orders.

## Before you deploy — 3 things to confirm

1. **Firebase Blaze plan.** Cloud Functions can't call Safaricom on the free Spark plan.
2. **Daraja product + Go Live.** In the Daraja portal, open your `Prod-BELLEWEAR BOUTIQUE` app → **Products** tab and make sure **Lipa na M-Pesa Online (M-Pesa Express / STK Push)** is enabled for short code `1444988`. If Go Live isn't fully approved, production calls will be rejected.
3. **Paybill or Till?** Short code `1444988` is set up as a **Paybill** in `functions/.env`. If it's actually a **Till number**, change to:
   `MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline`
   (Wrong value = Safaricom rejects the request with an invalid-transaction-type error.)

## Deploy

From the project folder:

```bash
cd functions
npm install
cp .env.example .env        # already created for you; edit if needed

# Secrets — paste each value when prompted (use "Show credentials" on Daraja)
firebase functions:secrets:set MPESA_CONSUMER_KEY
firebase functions:secrets:set MPESA_CONSUMER_SECRET
firebase functions:secrets:set MPESA_PASSKEY

# Random token that proves callbacks really come through your URL
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
firebase functions:secrets:set MPESA_CALLBACK_TOKEN     # paste the token above

cd ..
firebase deploy --only functions,firestore:rules
```

The callback URL is built automatically:
`https://us-central1-bellewear-boutique.cloudfunctions.net/paymentCallback`
(nothing to register in Daraja — it's sent with each request).

## Test it

1. Create a test product priced **Ksh 1** with delivery fee small (or a cheap delivery area).
2. Checkout → Delivery → M-Pesa → pay with your own number.
3. Confirm: success screen, order in **My Orders / admin**, stock reduced by 1, `paymentReference` = M-Pesa receipt (e.g. `RK12AB3CD4`).
4. Also test: cancel the prompt, wrong PIN, and let it time out.

Logs: `firebase functions:log --only paymentCallback,initiateMpesaPayment`

To test with **no real money**, create a Daraja *sandbox* app, set `MPESA_ENV=sandbox`, `MPESA_SHORTCODE=174379`, and use the sandbox consumer key/secret/passkey from the Daraja simulator page.

## Admin notes

- M-Pesa orders arrive as `status: PLACED`, `paymentStatus: PAID`.
- If an order has `inventoryIssue: INSUFFICIENT_STOCK_AT_PAYMENT`, the customer paid but stock ran out in the meantime — fulfil or refund manually.
- `mpesaPayments` docs with `status: REVIEW` = amount mismatch; check the M-Pesa receipt before acting.

## Security notes

- Consumer key/secret/passkey live only in Firebase Secrets — never in HTML/JS files.
- Your Daraja screenshot only showed the first few characters of each credential, which is fine. If the full values were ever pasted into chat, email, or Git, use **Rotate Credentials** on the Daraja app card.
- `firestore.rules` no longer lets the browser create `mpesa` orders, so nobody can fake a paid M-Pesa order.

## Things I noticed (not changed)

- **Card payments (Paystack)** still create the order from the browser after payment, and the rules accept it, so a determined user could forge a "paid" card order. Worth moving to a server-verified flow like this one.
- There's an old nested folder `Belleware-boutique-main/Belleware-boutique-main/` with an early sandbox `stkPush` function and a placeholder callback URL. It isn't used — safe to delete.
