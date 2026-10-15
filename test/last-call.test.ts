// The report scripts/last-call.js prints about one practice call
// (scripts/call-report-text.js): what Vapi holds, read from an example of
// Vapi's record of a call with invented people; Front-line's side, from the
// control room's real report on the same call; and the checks that the two
// agree. The script itself reaches the network, so it is not run here; what
// it prints and checks is.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bookingLines,
  bookingSummary,
  conversation,
  crossCheck,
  firmFromSettings,
  numberKind,
  readOnly,
  reportLines,
  safetyCheck,
  safetyLines,
  summariseVapiCall,
  uk,
} from '../scripts/call-report-text.js';
import type { BookingText, CallReportForStaff } from '../src/call-report';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { ukMobile } from '../src/phone';
import { listCallsBetween, listDueForVisit, optOutNumber } from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId } from '../src/record/types';
import practice from '../vapi/practice-assistant.json';
import booked from './fixtures/vapi/call-record-booked.json';
import { controlOpener } from './helpers/control';
import { testDeps } from './helpers/deps';
import { asAnotherCall, report, send, sendTool, tidewell, toolCall, withDetails, type Report } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-28T11:14:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const VAPI_ID = booked.id;

let firm: FirmId;
let number: string;
let numbers = 750;

beforeEach(async () => {
  clock.set(instantFromIso('2026-09-28T11:14:00+01:00'));
  numbers += 1;
  number = `+447700900${String(numbers)}`;
  firm = await tidewell(db, number);
});

/**
 * Mrs Ahmed's call as the example record has it, through the real system:
 * her booking, then the report as the call ends, changed as given, and her
 * confirmation run. Gives the control room's report on it.
 */
async function throughTheSystem(options: { ended?: (body: Report) => Report; beforeTheReport?: () => Promise<void> } = {}): Promise<CallReportForStaff | null> {
  // Vapi's ids are kept once across every firm, so each test's call has its own.
  const vapiId = `last-call-${String(numbers)}`;
  await sendTool(app, '/vapi/book', toolCall('book', { start: '2026-10-01T15:00' }, { to: number, callId: vapiId }));
  await options.beforeTheReport?.();
  clock.set(instantFromIso('2026-09-28T11:15:12+01:00'));
  const ended = asAnotherCall(report('mrs-ahmed-booked', number), vapiId);
  expect((await send(app, options.ended === undefined ? ended : options.ended(ended))).status).toBe(200);
  const [call] = await listCallsBetween(db, firm, ...allTime);
  if (call?.visit !== undefined && call.visit !== null) {
    const confirmation = (await listDueForVisit(db, firm, call.visit.id)).find((due) => due.action === 'send_confirmation');
    if (confirmation !== undefined) await runDue(db, deps, firm, confirmation.id);
  }
  const answer = await controlOpener(app)(`/control/firms/${firm}/calls/vapi/${vapiId}`);
  return answer.status === 404 ? null : await answer.json<CallReportForStaff>();
}

describe('what the script may do', () => {
  it('only reads: GET, and nothing that changes anything', () => {
    expect(readOnly('GET')).toBe('GET');
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'get', '']) {
      expect(() => readOnly(method)).toThrow('Only GET is allowed');
    }
  });

  it('finds the practice firm from the agent’s recording path', () => {
    expect(firmFromSettings(practice)).toBe(practice.artifactPlan.recordingPath.slice('/firms/'.length));
    expect(firmFromSettings({ artifactPlan: { recordingPath: '/elsewhere' } })).toBeNull();
    expect(firmFromSettings(null)).toBeNull();
  });

  it('shows a caller’s number only as the kind it is', () => {
    expect(numberKind('+447700900003')).toBe('mobile');
    expect(numberKind('07700 900003')).toBe('mobile');
    expect(numberKind('+441632960123')).toBe('landline');
    expect(numberKind(undefined)).toBe('withheld');
    expect(numberKind('anonymous')).toBe('withheld');
  });

  it('writes times in UK time', () => {
    expect(uk('2026-10-01T14:00:00.000Z')).toBe('Thu 1 Oct, 15:00:00');
    expect(uk('2026-10-26T09:00:00.000Z')).toBe('Mon 26 Oct, 09:00:00');
    expect(uk(null)).toBe('(none)');
  });
});

describe('what Vapi holds about a call', () => {
  it('gives the date the agent was given, each tool with its arguments and answer, and which details came through', () => {
    expect(summariseVapiCall(booked)).toEqual({
      id: VAPI_ID,
      startedAt: '2026-09-28T10:14:00.000Z',
      endedAt: '2026-09-28T10:15:10.000Z',
      endedReason: 'customer-ended-call',
      caller: 'mobile',
      dateLine: 'Today is Monday 28 September 2026, UK time. Written as YYYY-MM-DD, that is 2026-09-28.',
      tools: [
        {
          name: 'free_times',
          secondsIn: 20.1,
          argumentsAs: 'text',
          arguments: { day: '2026-10-01' },
          answer: {
            times: [
              { start: '2026-10-01T08:00', say: 'Thursday 1 October at 8am' },
              { start: '2026-10-01T09:00', say: 'Thursday 1 October at 9am' },
              { start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm' },
            ],
          },
        },
        {
          name: 'book_visit',
          secondsIn: 28.3,
          argumentsAs: 'text',
          arguments: { start: '2026-10-01T15:00' },
          answer: { booked: true, start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm', text: true },
        },
      ],
      detailsGiven: ['about', 'address', 'callerType', 'name', 'postcode', 'summary'],
      callerType: 'customer',
      urgentMatch: null,
    });
  });

  it('gives the conversation only when asked, with each tool in its place', () => {
    const lines = conversation(booked);
    expect(lines).toContain('[  20.1s] -> free_times {"day": "2026-10-01"}');
    expect(lines.some((line) => line.includes('Caller: 3pm please.'))).toBe(true);
  });
});

describe('the booking', () => {
  it('gives the day the agent asked about, the times it was given, and what booking was told', () => {
    expect(bookingSummary(summariseVapiCall(booked))).toEqual({
      freeTimes: [
        {
          secondsIn: 20.1,
          day: '2026-10-01',
          times: [
            { start: '2026-10-01T08:00', say: 'Thursday 1 October at 8am' },
            { start: '2026-10-01T09:00', say: 'Thursday 1 October at 9am' },
            { start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm' },
          ],
        },
      ],
      bookVisit: [{ secondsIn: 28.3, start: '2026-10-01T15:00', result: 'booked', say: 'Thursday 1 October at 3pm', text: true }],
    });
  });

  it('prints what the agent asked and was told, and where the customer’s and owner’s texts stand', async () => {
    const frontline = await throughTheSystem();
    const printed = reportLines(summariseVapiCall(booked), frontline, []);
    expect(printed).toContain('Booking');
    expect(printed).toContain(
      '  free_times at 20.1s with day 2026-10-01: Thursday 1 October at 8am (2026-10-01T08:00); Thursday 1 October at 9am (2026-10-01T09:00); Thursday 1 October at 3pm (2026-10-01T15:00).',
    );
    expect(printed).toContain('  book_visit at 28.3s with 2026-10-01T15:00: booked for Thursday 1 October at 3pm, text promised.');
    expect(printed).toContain("  Customer's confirmation: sent.");
    expect(printed).toContain("  Owner's text: waiting to go.");
  });

  it('says when the agent gave no day, was given no times, or was not booked, and why', () => {
    const [freeTimes, book] = summariseVapiCall(booked).tools;
    if (freeTimes === undefined || book === undefined) throw new Error('No tools');
    const vapi = {
      ...summariseVapiCall(booked),
      tools: [
        { ...freeTimes, arguments: {}, answer: { times: [] } },
        { ...freeTimes, secondsIn: 22, arguments: {}, answer: 'Request timed out' },
        { ...book, answer: { booked: false, why: 'taken' } },
        { ...book, secondsIn: 30, answer: { booked: false, why: 'not_offered' } },
        { ...book, secondsIn: 31, answer: null },
        { ...book, secondsIn: 32, answer: { booked: true, start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm', text: false } },
      ],
    };
    expect(bookingLines(vapi, null)).toEqual([
      'Booking',
      '  free_times at 20.1s with no day: no times.',
      '  free_times at 22.0s with no day: no answer it could read.',
      '  book_visit at 28.3s with 2026-10-01T15:00: not booked: the time was taken.',
      '  book_visit at 30.0s with 2026-10-01T15:00: not booked: the time is not one the firm offers.',
      '  book_visit at 31.0s with 2026-10-01T15:00: not booked: no answer it could read.',
      '  book_visit at 32.0s with 2026-10-01T15:00: booked for Thursday 1 October at 3pm, no text promised.',
    ]);
  });

  it('says when the agent used neither tool, and that no booking text is due', async () => {
    const frontline = await throughTheSystem();
    if (frontline === null) throw new Error('No call');
    const vapi = { ...summariseVapiCall(booked), tools: [] };
    const unbooked = { ...frontline, booking: { customerText: null, ownerText: null } };
    expect(bookingLines(vapi, unbooked)).toEqual([
      'Booking',
      '  free_times: not called.',
      '  book_visit: not called.',
      "  Customer's confirmation: none due.",
      "  Owner's text: none due.",
    ]);
  });

  it('says a text is held for quiet hours, with when it goes in UK time', async () => {
    const frontline = await throughTheSystem();
    if (frontline === null) throw new Error('No call');
    const held: BookingText = { due: 'x', state: 'quiet_hours', until: '2026-10-02T07:00:00.000Z', reasons: [] };
    const atNight = { ...frontline, booking: { customerText: held, ownerText: held } };
    expect(bookingLines(summariseVapiCall(booked), atNight).slice(-2)).toEqual([
      "  Customer's confirmation: held for quiet hours, goes Fri 2 Oct, 08:00:00.",
      "  Owner's text: held for quiet hours, goes Fri 2 Oct, 08:00:00.",
    ]);
  });

  it('says why a confirmation did not go', async () => {
    const frontline = await throughTheSystem({ beforeTheReport: () => optOutNumber(db, firm, ukMobile('07700 900003')) });
    expect(bookingLines(summariseVapiCall(booked), frontline)).toContain("  Customer's confirmation: not sent (opted_out).");
  });
});

describe('the agent’s safety advice', () => {
  const lines = safetyLines(practice);
  const [gas = '', water = '', other = ''] = lines;
  /** A call in Vapi's form, with the agent's lines as given, a few seconds apart. */
  const callWith = (...said: string[]) => ({
    artifact: { messages: said.map((message, i) => ({ role: 'bot', message, secondsFromStart: 10 + i * 5 })) },
  });

  it('takes the lines from the agent’s settings file, word for word', () => {
    expect(lines).toEqual([
      'Please leave the property and call the National Gas Emergency Service on 0800 111 999, or 999 if anyone is in immediate danger.',
      "Please keep away from any wet electrics, and don't touch switches or sockets near the water. If you can do it safely, turn off the water at the stopcock. If anyone is in danger, leave the property and call 999.",
      'If anyone is in danger, leave the property and call 999.',
    ]);
  });

  it('passes a gas boiler service quote, which mentions gas but gives no safety advice', () => {
    const quote = callWith(
      "Hello, you're through to Practice Test Plumbing's automated assistant. This call is recorded. How can I help?",
      'Thank you. So that is a gas boiler service, and you would like someone to come and price it.',
      'Let me check the diary.',
      'I can offer Friday 16 October at midday, Monday 19 October at 9am, or Tuesday 20 October at 8am. Which suits you?',
      'That is booked for Monday 19 October at 9am, and you will get a text to confirm it. Thank you, goodbye.',
    );
    expect(safetyCheck(quote, lines)).toEqual([]);
    expect(safetyCheck(booked, lines)).toEqual([]);
  });

  it('passes each listed line, alone or among other words, whatever the punctuation, apostrophes or gaps in the number', () => {
    expect(safetyCheck(callWith(gas, water, other), lines)).toEqual([]);
    expect(safetyCheck(callWith(`Thank you for telling me. ${water} Now, can I take your name?`), lines)).toEqual([]);
    const spoken = 'please leave the property and call the national gas emergency service on 0800111999 - or 999 if anyone is in immediate danger';
    expect(safetyCheck(callWith(spoken, water.replace("don't", 'don’t')), lines)).toEqual([]);
  });

  it('fails advice of the agent’s own, as on the leak calls of 15 Oct 2026, giving only how far in it was', () => {
    const ownAdvice =
      'As you have a water leak, please be aware that if there is any risk of danger, such as electrical fittings getting wet or if you feel unsafe, please leave the property and call 999 if anyone is in immediate danger.';
    expect(safetyCheck(callWith('Thank you.', ownAdvice), lines)).toEqual([
      'The agent gave safety advice that is not one of its safety lines at 15.0s. Look at it with --transcript.',
    ]);
  });

  it('fails a listed line with advice of its own added, on 999, leaving or an emergency', () => {
    for (const added of ['Call 999 if the ceiling comes down.', 'You may want to leave the property for now.', 'This sounds like an emergency.']) {
      expect(safetyCheck(callWith(`${water} ${added}`), lines)).toHaveLength(1);
    }
  });

  it('says so when the settings file has no safety lines to check against', () => {
    expect(safetyCheck(booked, [])).toEqual(["The agent's settings file has no list of safety lines, so its safety advice could not be checked."]);
    expect(safetyLines({ model: { messages: [{ role: 'system', content: 'Take a message.' }] } })).toEqual([]);
  });
});

describe('the report and its checks', () => {
  it('finds Vapi and Front-line agree on a booked call, and prints no name, number or address', async () => {
    const frontline = await throughTheSystem();
    const vapi = summariseVapiCall(booked);
    expect(crossCheck(vapi, frontline)).toEqual([]);
    const printed = reportLines(vapi, frontline, []).join('\n');
    expect(printed).toContain('book_visit at 28.3s with {"start":"2026-10-01T15:00"} (arguments as text)');
    expect(printed).toContain('Visit: ');
    expect(printed).toContain('quote_visit, booked, Thu 1 Oct, 15:00:00 to Thu 1 Oct, 16:00:00');
    expect(printed).toContain('send_confirmation: done (sent)');
    expect(printed).toContain('visit_confirmation_first to the customer: sent');
    expect(printed).toContain('Checks: Vapi and Front-line agree.');
    for (const personal of ['Mrs Ahmed', 'Ahmed', '+447700900003', '07700 900003', 'Station Road', 'ZZ1', 'cutting out', number]) {
      expect(printed).not.toContain(personal);
    }
  });

  it('says so when the agent used a booking tool on a call it marked urgent, even with no report from Front-line', async () => {
    const urgent = { ...summariseVapiCall(booked), urgentMatch: 'a leak' };
    const used = [
      'The agent used free_times on a call it marked urgent ("a leak"), though its instructions say never to on a dangerous call.',
      'The agent used book_visit on a call it marked urgent ("a leak"), though its instructions say never to on a dangerous call.',
    ];
    expect(crossCheck(urgent, null)).toEqual([...used, 'Front-line has no call with this id: the report did not arrive, or was for another number.']);
    const frontline = await throughTheSystem();
    expect(crossCheck(urgent, frontline)).toEqual(expect.arrayContaining(used));
    expect(crossCheck({ ...urgent, tools: [] }, null)).toEqual(['Front-line has no call with this id: the report did not arrive, or was for another number.']);
    expect(crossCheck(summariseVapiCall(booked), frontline)).toEqual([]);
  });

  it('says so when Front-line has no such call', () => {
    expect(crossCheck(summariseVapiCall(booked), null)).toEqual([
      'Front-line has no call with this id: the report did not arrive, or was for another number.',
    ]);
  });

  it('says so when the agent was told it was booked but no visit was filed', async () => {
    const frontline = await throughTheSystem({ ended: (body) => withDetails(body, (data) => ({ ...data, address: '' })) });
    expect(crossCheck(summariseVapiCall(booked), frontline)).toContain(
      'The agent was told the time was booked, but no visit was filed (hold: released).',
    );
  });

  it('says so when a promised confirmation did not go', async () => {
    const frontline = await throughTheSystem({ beforeTheReport: () => optOutNumber(db, firm, ukMobile('07700 900003')) });
    expect(crossCheck(summariseVapiCall(booked), frontline)).toContain('The agent promised a text, but the confirmation is not_sent (opted_out).');
  });

  it('says so when the visit filed is not the time the agent booked', async () => {
    const frontline = await throughTheSystem();
    if (frontline?.visit == null) throw new Error('No visit');
    const moved = { ...frontline, visit: { ...frontline.visit, startsAt: '2026-10-01T13:00:00.000Z' } };
    expect(crossCheck(summariseVapiCall(booked), moved)).toEqual([
      'The visit filed starts 2026-10-01T13:00:00.000Z, not at 2026-10-01T15:00, the time the agent booked.',
    ]);
  });

  it('says so when the agent marked a call urgent for something not on the firm’s list', async () => {
    const frontline = await throughTheSystem();
    const vapi = { ...summariseVapiCall(booked), urgentMatch: 'a burst pipe' };
    expect(crossCheck(vapi, frontline)).toContain('The agent marked the call urgent ("a burst pipe"), but it is not on the firm\'s urgent list, so no alert went.');
  });
});
