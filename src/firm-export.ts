// The file of one firm's records, for handing over when the firm leaves, or
// whenever staff ask (slice H of docs/build-brief.md). Made by a row in the
// due list, a piece at a time, so a firm's year of records never sits in
// memory whole, and written to the file store in parts. Nothing is ready
// until the whole file is.
//
// A zip holding:
// - everything.json: every row of every table the firm has, times in UTC,
//   with no link tokens or workers' claims
// - customers.csv, jobs.csv, visits.csv, calls.csv, texts.csv and
//   history.csv, to open in a spreadsheet, with times in UK time and history
//   as the owner reads it. Their headings are new wording, listed in the
//   pull request for slice H.
// - recordings/<call id>.mp3: each recording still kept

import { instantFromIso, type Instant } from './clock';
import { historyLine } from './history-lines';
import { inLondon } from './london';
import { nationalNumber, type UkLandline, type UkMobile } from './phone';
import {
  exportToMake,
  firmTablePage,
  firmWording,
  getFirm,
  historyBetween,
  markFirmExportReady,
  openFirmExportFile,
  readCallRecording,
} from './record';
import type { RecordDb } from './record/db';
import { EXPORTED_TABLES, type ExportedTable } from './record/firm-file';
import type { CallId, FirmId } from './record/types';
import { CALL_OUTCOME_WORDS, DIARY_WORDS } from './words';
import { csvRow, ZipWriter } from './zip';

/** The headings of each CSV file. New wording, read by the owner. */
export const EXPORT_HEADINGS = {
  customers: ['Name', 'Mobile', 'Landline', 'Address', 'Email', 'Added'],
  jobs: ['Customer', 'About', 'Where', 'Urgent', 'Opened'],
  visits: ['Customer', 'About', 'Visit', 'Starts', 'Ends', 'State'],
  calls: ['When', 'From', 'Customer', 'Who rang', 'What came of it', 'Summary', 'Recording'],
  texts: ['When', 'Sent or received', 'Customer or owner', 'Number', 'Words', 'State'],
  history: ['When', 'What happened'],
} as const;

/** The other words in the CSV files. New wording, read by the owner. */
export const EXPORT_WORDS = {
  yes: 'Yes',
  no: 'No',
  sent: 'Sent',
  received: 'Received',
  booked: 'Booked',
  cancelled: 'Cancelled',
  outcome: { booked: 'Visit booked', urgent: CALL_OUTCOME_WORDS.urgent, message: CALL_OUTCOME_WORDS.message },
  state: { sending: 'Sending', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', not_sent: 'Not sent' },
} as const;

/** How far apart the history is read, so no one read is too large. */
const HISTORY_WINDOW = 31 * 24 * 60 * 60_000;

type Row = Record<string, unknown>;

/**
 * Makes the firm's oldest export still to make. Gives made, or
 * nothing_to_do when there is none. On a failure, the part-written file is
 * given up and the export stays to make, so the row can run again.
 */
export async function makeFirmExport(db: RecordDb, firm: FirmId): Promise<'made' | 'nothing_to_do'> {
  const id = await exportToMake(db, firm);
  if (id === null) {
    return 'nothing_to_do';
  }
  const file = await openFirmExportFile(db, firm, id);
  try {
    const zip = new ZipWriter((chunk) => file.write(chunk), db.clock.now());
    await writeFirm(db, firm, zip);
    await zip.finish();
    await markFirmExportReady(db, firm, id, await file.finish());
  } catch (thrown) {
    await file.abort().catch(() => undefined);
    throw thrown;
  }
  return 'made';
}

async function writeFirm(db: RecordDb, firm: FirmId, zip: ZipWriter): Promise<void> {
  // Everything, table by table, a page at a time.
  const everything = zip.entry('everything.json', 'compress');
  await everything.write(`{"firm":${JSON.stringify(firm)},"made":${JSON.stringify(new Date(db.clock.now()).toISOString())},"tables":{`);
  for (const [at, table] of EXPORTED_TABLES.entries()) {
    await everything.write(`${at === 0 ? '' : ','}${JSON.stringify(table)}:[`);
    let first = true;
    for await (const row of rowsOf(db, firm, table)) {
      await everything.write(`${first ? '' : ','}${JSON.stringify(row)}`);
      first = false;
    }
    await everything.write(']');
  }
  await everything.write('}}');
  await everything.end();

  // The CSV files, with who each row is about by name.
  const names = new Map<string, string>();
  const customers = zip.entry('customers.csv', 'compress');
  await customers.write(csvRow(EXPORT_HEADINGS.customers));
  for await (const row of rowsOf(db, firm, 'customers')) {
    names.set(idOf(row.id), idOf(row.name));
    await customers.write(csvRow([text(row.name), number(row.mobile), number(row.landline), text(row.address), text(row.email), ukTime(row.created_at)]));
  }
  await customers.end();

  const jobs = new Map<string, { customer: string; about: string }>();
  const jobsFile = zip.entry('jobs.csv', 'compress');
  await jobsFile.write(csvRow(EXPORT_HEADINGS.jobs));
  for await (const row of rowsOf(db, firm, 'jobs')) {
    const customer = names.get(idOf(row.customer_id)) ?? '';
    jobs.set(idOf(row.id), { customer, about: idOf(row.about) });
    await jobsFile.write(csvRow([customer, text(row.about), text(row.place), row.urgent === 1 ? EXPORT_WORDS.yes : EXPORT_WORDS.no, ukTime(row.created_at)]));
  }
  await jobsFile.end();

  const visits = zip.entry('visits.csv', 'compress');
  await visits.write(csvRow(EXPORT_HEADINGS.visits));
  for await (const row of rowsOf(db, firm, 'visits')) {
    const job = jobs.get(idOf(row.job_id));
    await visits.write(
      csvRow([
        job?.customer ?? '',
        job?.about ?? '',
        wordFor(DIARY_WORDS, row.kind) ?? text(row.kind),
        ukTime(row.starts_at),
        ukTime(row.ends_at),
        row.state === 'cancelled' ? EXPORT_WORDS.cancelled : EXPORT_WORDS.booked,
      ]),
    );
  }
  await visits.end();

  const kept: CallId[] = [];
  const calls = zip.entry('calls.csv', 'compress');
  await calls.write(csvRow(EXPORT_HEADINGS.calls));
  for await (const row of rowsOf(db, firm, 'calls')) {
    const isKept = row.recording_state === 'kept';
    if (isKept) kept.push(idOf(row.id) as CallId);
    const outcome = wordFor(EXPORT_WORDS.outcome, row.outcome) ?? '';
    await calls.write(
      csvRow([
        ukTime(row.started_at),
        number(row.from_number),
        names.get(idOf(row.customer_id)) ?? '',
        text(row.caller),
        outcome,
        text(row.summary),
        isKept ? recordingName(idOf(row.id) as CallId, idOf(row.recording_key)) : '',
      ]),
    );
  }
  await calls.end();

  const owners = new Map<string, string>();
  for await (const row of rowsOf(db, firm, 'owners')) owners.set(idOf(row.id), idOf(row.name));
  const texts = zip.entry('texts.csv', 'compress');
  await texts.write(csvRow(EXPORT_HEADINGS.texts));
  for await (const row of rowsOf(db, firm, 'messages')) {
    const to = row.customer_id === null ? (owners.get(idOf(row.owner_id)) ?? '') : (names.get(idOf(row.customer_id)) ?? '');
    const state = wordFor(EXPORT_WORDS.state, row.state) ?? '';
    await texts.write(csvRow([ukTime(row.created_at), EXPORT_WORDS.sent, to, number(row.to_number), text(row.words), state]));
  }
  for await (const row of rowsOf(db, firm, 'texts_in')) {
    await texts.write(csvRow([ukTime(row.received_at), EXPORT_WORDS.received, names.get(idOf(row.customer_id)) ?? '', number(row.from_number), text(row.words), '']));
  }
  await texts.end();

  // History as the owner reads it in Done for you, a month at a time.
  const wording = await firmWording(db, firm);
  const history = zip.entry('history.csv', 'compress');
  await history.write(csvRow(EXPORT_HEADINGS.history));
  const firmNow = await getFirm(db, firm);
  const end = db.clock.now() + 1;
  for (let from = firmNow?.createdAt ?? 0; from < end; from += HISTORY_WINDOW) {
    const to = Math.min(from + HISTORY_WINDOW, end);
    for (const entry of await historyBetween(db, firm, from as Instant, to as Instant)) {
      const line = historyLine(entry, 'feed', wording);
      if (line !== null) await history.write(csvRow([stamp(entry.at), line]));
    }
  }
  await history.end();

  // Each recording still kept, as it is.
  for (const call of kept) {
    const recording = await readCallRecording(db, firm, call);
    if (recording !== null) await zip.stream(recordingName(call, recording.key), recording.body);
  }
}

/** Every row of one of the firm's tables, a page at a time. */
async function* rowsOf(db: RecordDb, firm: FirmId, table: ExportedTable): AsyncGenerator<Row> {
  let after = 0;
  for (;;) {
    const page = await firmTablePage(db, firm, table, after);
    yield* page.rows;
    if (page.last === null) return;
    after = page.last;
  }
}

/** A recording's name in the zip: recordings/<call id>, with its kept file's ending. */
function recordingName(call: CallId, key: string): string {
  const ending = /\.(mp3|wav)$/.exec(key)?.[1];
  return `recordings/${call}${ending === undefined ? '' : `.${ending}`}`;
}

/** The words for a value from one of the lists above, if it is on it. */
function wordFor(words: Readonly<Record<string, string>>, value: unknown): string | undefined {
  return typeof value === 'string' && Object.hasOwn(words, value) ? words[value] : undefined;
}

/** An id from a row, or empty when there is none. */
function idOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A number as the owner writes it, such as 07700 900003. */
function number(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return nationalNumber(value as UkMobile | UkLandline);
  } catch {
    return value;
  }
}

/** A time from the export's UTC dates, as UK time, such as 2026-10-15 08:10. */
function ukTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return stamp(instantFromIso(value));
  } catch {
    return null;
  }
}

function stamp(at: Instant): string {
  const uk = inLondon(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(uk.year)}-${two(uk.month)}-${two(uk.day)} ${two(uk.hour)}:${two(uk.minute)}`;
}
