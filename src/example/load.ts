// Loads the demo firm through the record layer, the same way everything else
// will write to the record. It runs on a pretend clock that steps through the
// example's days, so each record and entry carries the example's own time.

import { instantFromIso, pretendClock } from '../clock';
import { ukMobile } from '../phone';
import {
  addHistory,
  createCustomer,
  createFirm,
  createJob,
  createOwner,
  createVisit,
  exampleFirms,
  setService,
} from '../record';
import { openRecord } from '../record/db';
import { SERVICES, type CustomerId, type FirmId, type JobId, type VisitId } from '../record/types';
import {
  CUSTOMERS,
  EXAMPLE_FIRM,
  EXAMPLE_OWNER,
  EXAMPLE_SET_UP,
  TIMELINE,
  VISITS,
  type CustomerKey,
  type VisitKey,
} from './tidewell';

const frontline = { kind: 'frontline' } as const;

/**
 * Writes the demo firm and everything in it, and gives its id. The wall tests
 * load it a second time under another name, for a firm of the same shape.
 */
export async function loadExample(
  d1: D1Database,
  firmAs: { name: string; isExample: boolean } = { name: EXAMPLE_FIRM, isExample: true },
): Promise<FirmId> {
  const clock = pretendClock(instantFromIso(EXAMPLE_SET_UP));
  const db = openRecord(d1, clock);

  const firm = await createFirm(db, firmAs);
  for (const service of SERVICES) {
    await setService(db, firm, service, true, frontline);
  }
  await createOwner(db, firm, { name: EXAMPLE_OWNER });

  const people = new Map<CustomerKey, { customer: CustomerId; job: JobId }>();
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
        const { name, mobile, about, place, urgent } = CUSTOMERS[step.customer];
        const customer = await createCustomer(db, firm, { name, mobile: ukMobile(mobile) });
        const job = await createJob(db, firm, { customer, about, place, urgent });
        people.set(step.customer, { customer, job });
        break;
      }
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
      case 'call_answered':
      case 'passed_to_owner':
        await addHistory(db, firm, { kind: step.add, by: frontline, job: personOf(step.job).job });
        break;
      case 'details_taken':
        await addHistory(db, firm, { kind: step.add, by: frontline, customer: personOf(step.customer).customer });
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
