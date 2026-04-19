# STAREDOWN v3

Real-money multiplayer staring contest with Google login, Stripe payments, and global leaderboard.

## Railway Environment Variables Required

Set these in Railway → Variables:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
BASE_URL=https://your-railway-url.up.railway.app
```

## Firebase Service Account

1. Go to Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key"
3. Copy the entire JSON content
4. Paste it as the FIREBASE_SERVICE_ACCOUNT variable in Railway (as one line)

## Stripe Webhook

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: https://your-url/webhook
3. Select event: checkout.session.completed
4. Copy the signing secret → set as STRIPE_WEBHOOK_SECRET in Railway
