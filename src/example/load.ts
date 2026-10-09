// Loads the demo firm through the record layer, the same way everything else
// will write to the record. It runs on a pretend clock that steps through the
// example's days, so each record and entry carries the example's own time.

import { instantFromIso, pretendClock, type Instant } from '../clock';
import { newId } from '../ids';
import { DRAFT_WORDING } from '../messages';
import { ukMobile } from '../phone';
import {
  addHistory,
  cancelDue,
  createCustomer,
  createFirm,
  createJob,
  createOwner,
  createVisit,
  exampleFirms,
  markCallBooked,
  recordCall,
  setDiaryRules,
  setFirmNumber,
  setService,
  setUrgentList,
  setWording,
} from '../record';
import { openRecord } from '../record/db';
import {
  MESSAGE_KINDS,
  type CallId,
  type CustomerId,
  type FirmId,
  type JobId,
  type MessageKind,
  type VisitId,
} from '../record/types';
import {
  CUSTOMERS,
  EXAMPLE_DIARY_RULES,
  EXAMPLE_FIRM,
  EXAMPLE_NUMBER,
  EXAMPLE_OWNER,
  EXAMPLE_OWNER_MOBILE,
  EXAMPLE_SERVICES,
  EXAMPLE_SET_UP,
  EXAMPLE_URGENT_LIST,
  TIMELINE,
  VISITS,
  type CustomerKey,
  type VisitKey,
} from './tidewell';

const frontline = { kind: 'frontline' } as const;

/**
 * Writes the demo firm and everything in it, and gives its id. The wall tests
 * load it a second time under another name and number, for a firm of the
 * same shape.
 */
export async function loadExample(
  d1: D1Database,
  firmAs: { name: string; isExample: boolean; number: string } = {
    name: EXAMPLE_FIRM,
    isExample: true,
    number: EXAMPLE_NUMBER,
  },
): Promise<FirmId> {
  const clock = pretendClock(instantFromIso(EXAMPLE_SET_UP));
  const db = openRecord(d1, clock);

  const firm = await createFirm(db, { name: firmAs.name, isExample: firmAs.isExample });
  // Release 1's service only. The example's other four come back on with
  // their releases, as their quotes and invoices do.
  for (const service of EXAMPLE_SERVICES) {
    await setService(db, firm, service, true, frontline);
  }
  await setFirmNumber(db, firm, ukMobile(firmAs.number), frontline);
  await setUrgentList(db, firm, EXAMPLE_URGENT_LIST, frontline);
  await setDiaryRules(db, firm, EXAMPLE_DIARY_RULES, frontline);
  await createOwner(db, firm, { name: EXAMPLE_OWNER, mobile: ukMobile(EXAMPLE_OWNER_MOBILE) });
  // The wording agreed at set-up: the drafts, for each kind that has one.
  for (const kind of Object.keys(MESSAGE_KINDS) as MessageKind[]) {
    const draft = DRAFT_WORDING[kind];
    if (draft !== null) {
      await setWording(db, firm, `text:${kind}`, draft, frontline);
    }
  }

  const people = new Map<CustomerKey, { customer: CustomerId; job: JobId; call?: CallId }>();
  const visits = new Map<VisitKey, VisitId>();
  const personOf = (key: CustomerKey) => found(people.get(key));
  const visitOf = (key: VisitKey) => found(visits.get(key));

  for (const step of TIMELINE) {
    const at = instantFromIso(step.at);
    if (at < clock.now()) {
      throw new RangeError('The example timeline is out of order');
    }
    clock.set(at);

    switch (step.add) {
      case 'customer': {
        const { name, mobile, about, place } = CUSTOMERS[step.customer];
        const customer = await createCustomer(db, firm, { name, mobile: ukMobile(mobile), address: place });
        const job = await createJob(db, firm, { customer, about, place, urgent: false });
        people.set(step.customer, { customer, job });
        break;
      }
      case 'call': {
        const { name, mobile, about, place } = CUSTOMERS[step.customer];
        const number = ukMobile(mobile);
        const made = await recordCall(db, firm, {
          ...exampleCall(at),
          from: number,
          for: { kind: 'new_customer', name, mobile: number, landline: null, noText: null, about, place },
          urgentItem: step.urgent,
          summary: step.summary,
        });
        if (made.customer === null || made.job === null) {
          throw new RangeError('A new customer’s call opens their job');
        }
        // The example passes Mr Price's urgent call to the owner with its own
        // entry (passed_to_owner below), so the alert written with the call
        // is not run.
        if (made.alert !== null) {
          await cancelDue(db, firm, made.alert);
        }
        people.set(step.customer, { customer: made.customer, job: made.job, call: made.call });
        break;
      }
      case 'message':
        await recordCall(db, firm, {
          ...exampleCall(at),
          from: ukMobile(step.mobile),
          for: { kind: 'not_customer', caller: step.caller },
          urgentItem: null,
          summary: step.summary,
        });
        break;
      case 'visit': {
        const { customer, kind, startsAt } = VISITS[step.visit];
        const visit = await createVisit(db, firm, {
          job: personOf(customer).job,
          startsAt: instantFromIso(startsAt),
          kind,
        });
        visits.set(step.visit, visit);
        break;
      }
      case 'call_booked':
        await markCallBooked(db, firm, found(personOf(VISITS[step.visit].customer).call), visitOf(step.visit));
        break;
      case 'passed_to_owner':
        await addHistory(db, firm, { kind: step.add, by: frontline, job: personOf(step.job).job });
        break;
      case 'visit_booked':
      case 'confirmation_sent':
      case 'reminder_sent':
        await addHistory(db, firm, { kind: step.add, by: frontline, visit: visitOf(step.visit) });
        break;
    }
  }
  return firm;
}

/**
 * The parts of a call the example does not give. Each load gets its own made
 * up id for the call, since a call is held only once.
 */
function exampleCall(at: Instant) {
  return { provider: 'vapi', providerCallId: newId(), startedAt: at, endedAt: null, transcript: null } as const;
}

/** The demo firm, loaded first if no example firm is there yet. */
export async function ensureExample(d1: D1Database): Promise<FirmId> {
  const db = openRecord(d1, pretendClock(instantFromIso(EXAMPLE_SET_UP)));
  const [firm] = await exampleFirms(db);
  return firm ?? loadExample(d1);
}

function found<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new RangeError('The example timeline names something before it exists');
  }
  return value;
}
