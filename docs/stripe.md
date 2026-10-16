# Stripe: billing firms, in test mode only

What Front-line expects in Stripe to bill firms (task 2 of queue 3 in `docs/autopilot.md`). **Test mode only.** No live key is used anywhere: the Worker refuses any key that is not one of Stripe's test keys (`sk_test_…` or `rk_test_…`), and the live copy never bills, whatever it is given. Nothing here is set up yet; until it is, billing is switched off on every copy and each firm's page says so.

Everything here happens on Greg's own machine, in Stripe's dashboard in **test mode**, or with Wrangler. Never from a cloud session.

## What billing does

- **Going live** starts a 14-day free trial: Front-line makes the firm's customer in Stripe, named as the firm, and a monthly subscription for the services it chose, at Greg's prices (`src/billing.ts`): £80 for Calls & bookings, £50 for each other service, £150 for all five. No set-up fee, no VAT.
- The first 20 firms billed are numbered as founding firms, and their price is locked.
- **A card:** staff press "Make a link to add a card" on the firm's page and send the link to the owner themselves. It opens Stripe's own page, which takes the card; Front-line never sees it (rule 7). When Stripe says the card was added, Front-line makes it the card the subscription charges.
- **When the trial ends with no card**, the subscription pauses and nothing is charged until a card is added.
- **Cancelling**, on the owner's word: at once in the free trial, or when paused or behind with a payment; at the end of the month paid for when the firm is paying. A firm marked as leaving is cancelled at once.
- Stripe's events (`/stripe/webhook`) keep each firm's state current: trial, paying, a failed payment, paused, cancelled.

## To switch it on for practice, in test mode

1. In Stripe's dashboard, in **test mode**, make one product, such as "Front-line services". Copy its id (`prod_…`) into `STRIPE_PRODUCT_ID` under practice in `wrangler.jsonc` (an id, not a secret), and deploy.
2. Set practice's test secret key: `npx wrangler secret put STRIPE_SECRET_KEY --env practice`, with the **test** secret key (`sk_test_…`). A restricted test key (`rk_test_…`) works too if it can write customers, subscriptions, Checkout sessions and setup intents.
3. In Stripe's dashboard, in test mode, add a webhook endpoint: `https://practice-app.vanrooyenenterprises.com/stripe/webhook`, sending `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed` and `checkout.session.completed`. Set its signing secret: `npx wrangler secret put STRIPE_WEBHOOK_SECRET --env practice` (`whsec_…`).
4. In Cloudflare Access, add `/stripe/*` to practice-app's Bypass policy, beside `/vapi/*` and `/twilio/*` (`docs/access.md`). The route checks Stripe's signature itself.
5. Go live with a practice firm, then pay with one of Stripe's test cards on the card link. Stripe's dashboard can end the trial early to see the first charge.

Open question 20 in `docs/decisions.md` lists what Greg decides first.
