// The report scripts/last-call.js prints about one practice call
// (scripts/call-report-text.js): what Vapi holds, read from an example of
// Vapi's record of a call with invented people; Front-line's side, from the
// control room's real report on the same call; and the checks that the two
// agree. The script itself reaches the network, so it is not run here; what
// it prints and checks is.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  conversation,
  crossCheck,
  firmFromSettings,
  numberKind,
  readOnly,
  reportLines,
  summariseVapiCall,
  uk,
} from '../scripts/call-report-text.js';
import type { CallReportForStaff } from '../src/call-report';
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
