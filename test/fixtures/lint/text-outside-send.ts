// Deliberate mistakes, for the check in eslint.config.js that keeps every
// text going out through send() in src/send.ts (rule 1 in CLAUDE.md). Nothing
// runs this file: lint reads it.
//
// Each mistake carries a comment that turns its rule off for the next line.
// A comment that turns off nothing fails `npm run check`, so if the check
// ever stops catching one of these, the check goes red.

import type { Texts } from '../../../src/providers/texts';
import type { UkMobile } from '../../../src/phone';

export async function mistakes(texts: Texts, from: UkMobile, to: UkMobile): Promise<unknown[]> {
  // eslint-disable-next-line frontline/text-outside-send -- deliberate: a text handed to a provider past send()
  const sent = await texts.sendText({ from, to, body: 'Reminder: see you tomorrow.' });

  // eslint-disable-next-line frontline/text-outside-send, @typescript-eslint/unbound-method -- deliberate
  const { sendText } = texts;

  // eslint-disable-next-line frontline/text-outside-send -- deliberate: Twilio's own address
  const twilio = await fetch('https://api.twilio.com/2010-04-01/Accounts');

  const account = 'AC0';
  // eslint-disable-next-line frontline/text-outside-send -- deliberate
  const address = `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`;
  return [sent, sendText, twilio, address];
}

// Not mistakes: these must pass, so the check does not get in the way of
// ordinary words, or of other things called send.
export function notMistakes(queue: { send(body: string): void }): string[] {
  queue.send('due');
  return ['Send a text to the customer.', 'twilio.com is where Greg sets the number up.'];
}
