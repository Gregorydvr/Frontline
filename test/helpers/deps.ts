// Pretend dependencies for tests: the pretend clock, the stand-in for texts,
// a queue that keeps what is put on it, and the local file stores. Tests
// never reach a provider.

import { env } from 'cloudflare:workers';
import type { Clock } from '../../src/clock';
import type { Deps } from '../../src/deps';
import type { DueMessage, DueQueue } from '../../src/due';
import { StandInStaff } from '../../src/providers/access/fake';
import { FakeTexts } from '../../src/providers/texts/fake';
import { FakeNumbers } from '../../src/providers/numbers/fake';
import { FakeStripe } from '../../src/providers/stripe/fake';
import { FakeVapi } from '../../src/providers/vapi/fake';

/** A queue that keeps what the clock puts on it, for a test to run by hand. */
export class PretendQueue implements DueQueue {
  readonly bodies: DueMessage[] = [];

  sendBatch(messages: Iterable<{ body: DueMessage }>): Promise<void> {
    for (const message of messages) {
      this.bodies.push(message.body);
    }
    return Promise.resolve();
  }
}

/** Where customers' links go in tests. */
export const LINK_ADDRESS = 'https://links.example';

/** Where the owner's app is in tests. */
export const APP_ADDRESS = 'https://app.example';

/** Where the control room is in tests. */
export const CONTROL_ADDRESS = 'https://control.example';

/** Vapi's id for the credential in tests: invented. */
export const VAPI_CREDENTIAL = '00000000-0000-4000-8000-0000000000c1';

export interface TestDeps extends Deps {
  texts: FakeTexts;
  queue: PretendQueue;
  agents: FakeVapi;
  numbers: FakeNumbers;
  billing: FakeStripe;
}

export function testDeps(clock: Clock): TestDeps {
  return {
    clock,
    texts: new FakeTexts(),
    queue: new PretendQueue(),
    linkAddress: LINK_ADDRESS,
    appAddress: APP_ADDRESS,
    copy: 'practice',
    staff: new StandInStaff(),
    controlAddress: CONTROL_ADDRESS,
    // The local file stores the tests run against, kept apart between test files.
    files: { kept: env.FILES, inbox: env.CALLS_IN },
    agents: new FakeVapi(),
    vapiCredential: VAPI_CREDENTIAL,
    // Task 5's texts, switched off as on every copy. A test switches one on.
    textsOn: [],
    // The stand-in for buying numbers, which reaches nothing. Every real copy
    // has none, until its NUMBERS_ON is "yes"; a test sets this to null to
    // see the step switched off.
    numbers: new FakeNumbers(),
    // The stand-in member of staff may switch a firm to live; a test adds
    // another member of staff to see anyone else refused.
    goLiveBy: 'staff@example.com',
    // The stand-in for Stripe, which reaches nothing. A test sets this to
    // null to see billing switched off, as on every copy without a test key.
    billing: new FakeStripe(),
  };
}
