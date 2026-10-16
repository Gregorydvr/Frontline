// Deliberate mistakes, for the check in eslint.config.js that keeps Stripe
// reached only through src/providers/stripe/, which refuses a live key.
// Nothing runs this file: lint reads it.
//
// Each mistake carries a comment that turns its rule off for the next line.
// A comment that turns off nothing fails `npm run check`, so if the check
// ever stops catching one of these, the check goes red.

export async function mistakes(customer: string): Promise<unknown[]> {
  // eslint-disable-next-line frontline/stripe-outside-provider -- deliberate: Stripe's own address
  const made = await fetch('https://api.stripe.com/v1/customers');

  // eslint-disable-next-line frontline/stripe-outside-provider -- deliberate
  const address = `https://api.stripe.com/v1/customers/${customer}`;
  return [made, address];
}

// Not mistakes: ordinary words about Stripe pass.
export function notMistakes(): string[] {
  return ['Stripe takes the card.', 'dashboard.stripe.com is where Greg looks at a subscription.'];
}
