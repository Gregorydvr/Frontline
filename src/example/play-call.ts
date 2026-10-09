// For /local/book on this machine only: plays a call to the demo firm that
// books a quote visit, through the real addresses, as Vapi sends to them.
// The voice agent asks for the free times from tomorrow, books the first,
// and the report comes as the call ends. Then the visit's confirmation is
// run at once with the stand-in for texts, so its link can be opened here.
//
// Each play is Mrs Ahmed on a new mobile from the range kept for drama, so
// she is a new customer and her confirmation is her first text, with its
// link. Nothing here is deployed: practice and live are built from
// src/index.ts.
//
// The call comes with a recording, as Vapi writes one into the inbox file
// store: a few invented bytes, not a real sound. It is moved into the kept
// store at once, and deleted by the clock 30 days on, which the control room
// can show by moving the demo firm's clock (see /local/files).

import type { Hono } from 'hono';
import { instant } from '../clock';
import type { AppEnv } from '../app';
import { runDue, type DueDeps } from '../due';
import { newId } from '../ids';
import {
  listCallsBetween,
  listCustomers,
  listDueForCall,
  listDueForVisit,
  listJobsForCustomer,
  listMessagesBetween,
  listVisitsForJob,
  placeInInbox,
} from '../record';
import type { RecordDb } from '../record/db';
import type { CallId, CustomerId, FirmId } from '../record/types';
import { EXAMPLE_NUMBER } from './tidewell';
import { ukMobile } from '../phone';

export type Played =
  | { result: 'no_secret' }
  | { result: 'no_times' }
  | { result: 'booked'; say: string; text: 'sent' | 'held' | 'not_sent'; words: string | null; link: string | null };

export async function playBookingCall(
  app: Hono<AppEnv>,
  env: Env,
  db: RecordDb,
  deps: DueDeps,
  firm: FirmId,
): Promise<Played> {
  if (env.VAPI_SECRET === '') {
    return { result: 'no_secret' };
  }
  const firmNumber = ukMobile(EXAMPLE_NUMBER);
  const mobile = `+447700900${String(300 + (await listCustomers(db, firm)).length)}`;
  const callId = `local-${newId()}`;
  const message = (body: Record<string, unknown>) => ({
    message: { ...body, call: { id: callId }, phoneNumber: { number: firmNumber }, customer: { number: mobile } },
  });
  const tool = (name: string, args: Record<string, unknown>) =>
    message({ type: 'tool-calls', toolCallList: [{ id: `call_${newId()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const post = async (address: string, body: unknown) => {
    const response = await app.request(
      address,
      { method: 'POST', headers: { Authorization: `Bearer ${env.VAPI_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      env,
    );
    return response.ok ? await response.json<{ results?: { result?: string }[] }>() : null;
  };
  const answer = async (address: string, body: unknown) => {
    const result = (await post(address, body))?.results?.[0]?.result;
    return result === undefined ? null : (JSON.parse(result) as Record<string, unknown>);
  };

  const times = (await answer('/vapi/free-times', tool('free_times', {})))?.times as { start: string; say: string }[] | undefined;
  const [first] = times ?? [];
  if (first === undefined) {
    return { result: 'no_times' };
  }
  const booked = await answer('/vapi/book', tool('book_visit', { start: first.start }));
  if (booked?.booked !== true) {
    return { result: 'no_times' };
  }
  const now = new Date(db.clock.now()).toISOString();
  const recording = `firms/${firm}/${callId}-mono.mp3`;
  if (db.files !== null) {
    await placeInInbox(db, firm, recording, new TextEncoder().encode('Not a real recording: invented bytes for this machine.'));
  }
  await post(
    '/vapi/server',
    message({
      type: 'end-of-call-report',
      startedAt: now,
      endedAt: now,
      analysis: {
        structuredData: {
          callerType: 'customer',
          name: 'Mrs Ahmed',
          about: 'Boiler replacement',
          address: '27 Station Road',
          summary: 'The boiler keeps cutting out.',
          urgentMatch: null,
        },
      },
      artifact: { recordingUrl: `https://calls-in.example.invalid/${recording}` },
    }),
  );

  // Her confirmation, run at once rather than waiting for the clock.
  const customer = (await listCustomers(db, firm)).find((one) => one.mobile === mobile);
  const [job] = customer === undefined ? [] : await listJobsForCustomer(db, firm, customer.id);
  const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
  const confirmation = visit === undefined ? undefined : (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'send_confirmation');
  const ran = confirmation === undefined ? null : await runDue(db, deps, firm, confirmation.id);
  // And her recording's move into the kept store.
  const call = customer === undefined ? undefined : (await listCallsOf(db, firm, customer.id))[0];
  const move = call === undefined ? undefined : (await listDueForCall(db, firm, call)).find((due) => due.action === 'move_recording');
  if (move !== undefined) await runDue(db, deps, firm, move.id);
  const sent = (await listMessagesBetween(db, firm, visit?.createdAt ?? db.clock.now(), instant(db.clock.now() + 1))).find(
    (one) => one.visit === visit?.id,
  );
  const words = sent?.words ?? null;
  return {
    result: 'booked',
    say: first.say,
    text: ran?.ran === 'held' ? 'held' : sent?.state === 'sent' ? 'sent' : 'not_sent',
    words,
    link: /https?:\/\/\S+\/d\/[0-9a-z]{26}/.exec(words ?? '')?.[0] ?? null,
  };
}

/** The calls of one customer of the firm, newest first. */
async function listCallsOf(db: RecordDb, firm: FirmId, customer: CustomerId): Promise<CallId[]> {
  const calls = await listCallsBetween(db, firm, instant(0), instant(db.clock.now() + 1));
  return calls.filter((one) => one.customer?.id === customer).map((one) => one.id).reverse();
}
