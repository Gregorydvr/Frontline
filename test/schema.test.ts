// The database's own share of the wall (rule 8 in CLAUDE.md): every table
// holding a firm's data has firm_id, and a link across firms is refused even
// when written past the record layer.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { newId } from '../src/ids';
import { ukMobile } from '../src/phone';
import { createCustomer, createFirm, getJob } from '../src/record';
import { openRecord } from '../src/record/db';
import type { JobId } from '../src/record/types';
import { insertJobPastTheRecord, recordTables, tableColumns } from './helpers/db';

const db = openRecord(env.DB, pretendClock(instantFromIso('2026-10-15T08:10:00+01:00')));

describe('the tables', () => {
  it('are the six of slice B', async () => {
    expect(await recordTables(env.DB)).toEqual(['customers', 'firms', 'history', 'jobs', 'owners', 'visits']);
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
