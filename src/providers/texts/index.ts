// Texts: what send() hands a text to (rule 1 in CLAUDE.md). Two versions sit
// behind it: Twilio's on practice and live, and a stand-in on this machine
// and in tests, so tests never reach Twilio.
//
// Only send() in src/send.ts calls sendText(). Lint fails anything else that
// does.

import type { UkMobile } from '../../phone';
import type { TextProvider } from '../../record/types';

export interface OutgoingText {
  from: UkMobile;
  to: UkMobile;
  /** The words, already checked to be GSM-7 (rule 4). */
  body: string;
}

export type TextResult =
  /** The provider took the text, and gave its id for it. */
  | { ok: true; providerId: string }
  /**
   * The provider said no. "unsubscribed" is its refusal for a customer who
   * opted out with the provider itself. The code is the provider's own.
   */
  | { ok: false; reason: 'refused' | 'unsubscribed'; code: number | null };

export interface Texts {
  readonly provider: TextProvider;
  /**
   * Hands one text to the provider. Throws when it is not clear whether the
   * provider took it, such as when the network fails: then it must not be
   * sent again.
   */
  sendText(text: OutgoingText): Promise<TextResult>;
}
