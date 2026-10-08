// The database's own share of the wall (rule 8 in CLAUDE.md): every table
// holding a firm's data has firm_id, and a link across firms is refused even
// when written past the record layer.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { newId } from '../src/ids';
import { ukMobile } from '../src/phone';
import { createCustomer, createFirm, createJob, getJob, historyForJob, recordCall } from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId, JobId } from '../src/record/types';
import {
  insertCallEntryPastTheRecord,
  insertCallPastTheRecord,
  insertJobPastTheRecord,
  recordTables,
  tableColumns,
} from './helpers/db';

const db = openRecord(env.DB, pretendClock(instantFromIso('2026-10-15T08:10:00+01:00')));

describe('the tables', () => {
  it('are the six of slice B, the calls of slice C, and the sending and due list of slice D', async () => {
    expect(await recordTables(env.DB)).toEqual([
      'calls',
      'customers',
      'due',
      'firms',
      'history',
      'jobs',
      'messages',
      'opt_outs',
      'opted_out_numbers',
      'owners',
      'texts_in',
      'visits',
      'wording',
    ]);
  });

  it('all have a firm_id that must be filled in, apart from firms itself', async () => {
    for (const table of await recordTables(env.DB)) {
      if (table === 'firms') continue;
      const firmId = (await tableColumns(env.DB, table)).find((column) => column.name === 'firm_id');
      expect(firmId, table).toEqual({ name: 'firm_id', notnull: 1 });
    }
  });

  it('refuse a job for another firm’s customer, even written past the record layer', async () => {
    const tidewell = await createFirm(db, { name: 'Tidewell Heating', isExample: true });
    const second = await createFirm(db, { name: 'Second Example Firm', isExample: false });
    const mrsAhmed = await createCustomer(db, tidewell, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    const job = newId();

    await expect(insertJobPastTheRecord(env.DB, { id: job, firm: second, customer: mrsAhmed })).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(await getJob(db, second, job as JobId)).toBeNull();

    // The same job for the right firm goes in.
    await insertJobPastTheRecord(env.DB, { id: job, firm: tidewell, customer: mrsAhmed });
    expect(await getJob(db, tidewell, job as JobId)).not.toBeNull();
  });
});

describe('calls in the database', () => {
  async function twoFirms() {
    const tidewell = await createFirm(db, { name: 'Tidewell Heating', isExample: true });
    const second = await createFirm(db, { name: 'Second Example Firm', isExample: false });
    const mrPrice = await createCustomer(db, tidewell, { name: 'Mr Price', mobile: ukMobile('07700 900016') });
    const job = await createJob(db, tidewell, {
      customer: mrPrice,
      about: 'Leak under the sink',
      place: '6 Bridge Street',
      urgent: true,
    });
    return { tidewell, second, mrPrice, job };
  }

  it('refuse a call for another firm’s customer and job, even written past the record layer', async () => {
    const { tidewell, second, mrPrice, job } = await twoFirms();
    const call = { id: newId(), customer: mrPrice, job, providerCallId: `past-${newId()}` };
    await expect(insertCallPastTheRecord(env.DB, { ...call, firm: second })).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
    await insertCallPastTheRecord(env.DB, { ...call, firm: tidewell });
  });

  it('hold a call only once, whichever firm it is written for', async () => {
    const { tidewell, second } = await twoFirms();
    const providerCallId = `once-${newId()}`;
    await insertCallPastTheRecord(env.DB, { id: newId(), firm: tidewell, customer: null, job: null, providerCallId });
    await expect(
      insertCallPastTheRecord(env.DB, { id: newId(), firm: second, customer: null, job: null, providerCallId }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('refuse history that names another firm’s call, or a call about another job, even past the record layer', async () => {
    const { tidewell, second, mrPrice, job } = await twoFirms();
    const made = await recordCall(db, tidewell, {
      provider: 'vapi',
      providerCallId: `entry-${newId()}`,
      startedAt: db.clock.now(),
      endedAt: null,
      from: ukMobile('07700 900016'),
      for: { kind: 'customer', customer: mrPrice, about: 'Leak under the sink', place: '6 Bridge Street' },
      urgentItem: 'a leak',
      summary: null,
      transcript: null,
    });
    const secondsCustomer = await createCustomer(db, second, { name: 'Mr Price', mobile: ukMobile('07700 900016') });
    const secondsJob = await createJob(db, second, {
      customer: secondsCustomer,
      about: 'Leak under the sink',
      place: '6 Bridge Street',
      urgent: true,
    });

    const attempts: { firm: FirmId; customer: string; job: string }[] = [
      // The second firm's own job, naming the first firm's call.
      { firm: second, customer: secondsCustomer, job: secondsJob },
      // The first firm's call, said to be about another of its jobs.
      { firm: tidewell, customer: mrPrice, job },
    ];
    for (const attempt of attempts) {
      await expect(insertCallEntryPastTheRecord(env.DB, { id: newId(), call: made.call, ...attempt })).rejects.toThrow(
        /History names a call of another firm/,
      );
    }
    expect(await historyForJob(db, second, secondsJob)).toEqual([]);
    expect(await historyForJob(db, tidewell, job)).toEqual([]);

    // The call's own job takes it.
    await insertCallEntryPastTheRecord(env.DB, {
      id: newId(),
      firm: tidewell,
      call: made.call,
      customer: mrPrice,
      job: made.job,
    });
  });
});
