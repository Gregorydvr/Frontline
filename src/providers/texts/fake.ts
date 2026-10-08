// The stand-in for texts, used on this machine and in tests. It keeps what it
// was asked to send, and sends nothing. A test can tell it to refuse, or to
// fail in a way that leaves it unclear whether the text went.

import { newId } from '../../ids';
import type { OutgoingText, TextResult, Texts } from '.';

export class FakeTexts implements Texts {
  readonly provider = 'fake' as const;
  /** Every text it took, in order. */
  readonly sent: (OutgoingText & { providerId: string })[] = [];
  /** What the next texts get, in place of being taken, first to last. */
  private readonly upcoming: ('refused' | 'unsubscribed' | 'unclear')[] = [];

  /** Makes the next text get this answer. */
  willAnswer(answer: 'refused' | 'unsubscribed' | 'unclear'): void {
    this.upcoming.push(answer);
  }

  sendText(text: OutgoingText): Promise<TextResult> {
    const answer = this.upcoming.shift();
    if (answer === 'unclear') {
      return Promise.reject(new Error('The stand-in lost the connection'));
    }
    if (answer !== undefined) {
      return Promise.resolve({ ok: false, reason: answer, code: answer === 'unsubscribed' ? 21610 : 21211 });
    }
    const providerId = `fake-${newId()}`;
    this.sent.push({ ...text, providerId });
    return Promise.resolve({ ok: true, providerId });
  }
}
