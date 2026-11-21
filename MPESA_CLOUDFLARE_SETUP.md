# M-Pesa on Cloudflare Workers — setup (no Firebase Blaze plan needed)

Cloudflare Workers is free, and Firestore works on the free Spark plan, so nothing here needs billing.

## How it works

1. Customer picks **M-Pesa** on checkout and clicks **Pay with M-Pesa**.
2. The page calls your Worker (`/api/pay/start`) with the customer's Firebase login token.
3. The Worker checks the login, re-prices the cart from Firestore (prices can't be changed in the browser) and sends the STK push.
4. Customer enters their PIN. Safaricom calls the Worker (`/api/pay/callback`).
5. The Worker deducts stock and creates the order (`PLACED`, `paymentStatus: PAID`) in one atomic step.
6. Checkout watches `mpesaPayments/{id}` in Firestore and shows the success screen → receipt.
7. If the callback is slow, checkout asks the Worker to query Safaricom directly (at 45s and 90s).

Orders are created **only by the Worker, after Safaricom confirms**. Failed or cancelled attempts stay in `mpesaPayments` and never appear as orders.

## First, tidy up the earlier Firebase-Functions attempt

If you already extracted my previous zip: **delete** `functions/mpesa.js`, `functions/.env` and `functions/.env.example`. This zip includes the original `functions/index.js` back, so just overwrite it.

## Before you deploy — confirm these in Daraja

1. In your `Prod-BELLEWEAR BOUTIQUE` app → **Products** tab, **Lipa na M-Pesa Online (STK Push)** must be enabled for short code `1444988`, and Go Live must be approved.
2. **Paybill or Till?** `wrangler.toml` assumes a **Paybill**. If 1444988 is a **Till number**, change to
   `MPESA_TRANSACTION_TYPE = "CustomerBuyGoodsOnline"`.
   A wrong value makes Safaricom reject every request.

## Deploy (about 10 minutes)

### 1. Cloudflare login
```bash
cd cloudflare-worker
npm install
npx wrangler login          # opens the browser; create a free Cloudflare account if needed
```

### 2. Firebase service account key (lets the Worker write to Firestore)
Firebase Console → ⚙ **Project settings** → **Service accounts** → **Generate new private key**.
Save the file as `cloudflare-worker/service-account.json` (it's git-ignored).

### 3. Store the secrets in Cloudflare
When asked "create a new Worker?", answer **Y**. Paste each value when prompted.

```bash
npx wrangler secret put MPESA_CONSUMER_KEY       # from Daraja → "Show credentials"
npx wrangler secret put MPESA_CONSUMER_SECRET
npx wrangler secret put MPESA_PASSKEY
npx wrangler secret put MPESA_CALLBACK_TOKEN     # any long random string, e.g. output of:
#   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Then the service account (pick your system):
```bash
# Mac / Linux / Git Bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < service-account.json

# Windows PowerShell
Get-Content service-account.json -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```
After that, **delete `service-account.json`** from your computer. The key bypasses Firestore security rules, so it must live only in Cloudflare.

### 4. Edit `wrangler.toml`
Set `ALLOWED_ORIGINS` to your real website address(es), exactly as typed in the browser, no trailing slash. Example:
`"https://bellewear.vercel.app,http://localhost:5500"`

### 5. Deploy the Worker
```bash
npx wrangler deploy
```
It prints your address, e.g. `https://bellewear-pay.yourname.workers.dev`.

### 6. Connect the checkout page
Open `checkout.html`, find `PAYMENTS_API` and paste that address:
```js
const PAYMENTS_API = "https://bellewear-pay.yourname.workers.dev";
```

### 7. Deploy the Firestore rules (free on Spark)
```bash
firebase deploy --only firestore:rules
```
(or paste `firestore.rules` into Firebase Console → Firestore → Rules → Publish).
Then publish your website as usual (Vercel).

## Test it

1. Make a test product priced **Ksh 1** and a cheap delivery area.
2. Checkout → Delivery → M-Pesa → pay from your own phone.
3. Check: success screen, order in My Orders/admin, stock down by 1, `paymentReference` = the M-Pesa receipt (e.g. `RK12AB3CD4`).
4. Also try: cancelling the prompt, a wrong PIN, and ignoring it.

Live logs: `cd cloudflare-worker && npx wrangler tail`

For testing with no real money, create a Daraja **sandbox** app and set `MPESA_ENV = "sandbox"` and `MPESA_SHORTCODE = "174379"`, then `npx wrangler secret put` the sandbox key, secret and passkey.

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| Alert: "set PAYMENTS_API…" | Step 6 not done |
| Browser console shows a CORS error | Your site's address isn't in `ALLOWED_ORIGINS` (step 4), then redeploy |
| "M-Pesa could not send the payment prompt" | STK Push not enabled / Go Live pending / Paybill-vs-Till mismatch / wrong passkey. Check `wrangler tail` for Safaricom's message |
| Prompt arrives but order never appears | Callback not reaching the Worker or `MPESA_CALLBACK_TOKEN` differs. The 45s/90s fallback should still recover it |
| Logs show Firestore `403` | In Google Cloud Console → IAM, give the service account the **Cloud Datastore User** role |

## Free-plan limits

Free Workers allow 100,000 requests/day and 10 ms of CPU per request. Waiting on Safaricom/Firestore doesn't count as CPU, so this should be fine. If you ever see "exceeded CPU" errors, the $5 Workers Paid plan lifts the limit.

## Admin notes

- M-Pesa orders arrive as `status: PLACED`, `paymentStatus: PAID`.
- `inventoryIssue: INSUFFICIENT_STOCK_AT_PAYMENT` on an order = the customer paid but stock ran out meanwhile. Fulfil or refund manually.
- A `mpesaPayments` doc with `status: REVIEW` = amount mismatch. Check the M-Pesa receipt before acting.

## Security notes

- Consumer key/secret/passkey and the service account live only in Cloudflare secrets, never in your HTML/JS or Git.
- The Worker verifies every customer's Firebase login token itself, and only trusts prices and delivery fees from Firestore.
- `firestore.rules` no longer lets browsers create `mpesa` orders, so nobody can fake a paid M-Pesa order.
- Your Daraja screenshot only showed the first few characters of each credential, which is fine. If the full values were ever pasted into chat/email/Git, use **Rotate Credentials** on the Daraja card.

## Not changed, but worth knowing

- **Card payments (Paystack)** still create the order from the browser after payment, so a determined user could forge a "paid" card order. The same Worker approach would fix it.
- The nested folder `Belleware-boutique-main/Belleware-boutique-main/` holds an old unused sandbox `stkPush`; safe to delete.
