// The file stores (slice H of docs/build-brief.md): the only code that
// touches them, as src/record/ is the only code that touches the database.
// Lint fails a file store used anywhere else.
//
// Two stores:
// - kept: Front-line's own file store (FILES), holding call recordings and
//   firm exports, each under its firm's own path, firms/<firm id>/
// - inbox: where Vapi writes each recording as a call ends (CALLS_IN), under
//   the firm's own path too, set on each firm's agent (docs/vapi.md). A
//   recording stays there only until it is moved.
//
// Every name is made here from the firm given, and every name given in is
// checked to be under that firm's path, so one firm can never reach
// another's files (rule 8). Names hold ids and fixed words only, nothing
// personal (rule 10).
//
// Beside the firms' files, the kept store holds the restore ledger, under
// deletions/: a note of each customer and firm deleted, so the deletes can be
// done again after the database is restored to an earlier point
// (docs/restore.md). It holds ids only.

import { instant, type Instant } from '../clock';
import { isId, newId } from '../ids';
import type { RecordDb } from './db';
import type { CallId, CustomerId, FirmExportId, FirmId } from './types';

/**
 * What the record needs of a file store. Cloudflare's R2 binding is one; a
 * test can wrap one to make a chosen step fail.
 */
export interface FileBucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
  createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>;
}

/** The two file stores, as the system is given them (src/deps.ts). */
export interface FileStores {
  kept: FileBucket;
  inbox: FileBucket;
}

export type StoreName = keyof FileStores;

/** The kinds of recording kept, by the end of the inbox's name for it. Anything else is kept with no ending. */
const RECORDING_ENDINGS = ['mp3', 'wav'] as const;

/** The most names one list or delete of a file store takes. */
const BATCH = 1_000;

/** The size of each part of a large file written in pieces: R2 wants 5 MiB or more for every part but the last. */
export const PART_SIZE = 8 * 1024 * 1024;

/** The firm's own path in either store. */
export function firmPath(firm: FirmId): string {
  if (!isId(firm)) {
    throw new RangeError('Not a firm');
  }
  return `firms/${firm}/`;
}

/** Whether a name is under the firm's own path, with nothing that could climb out of it. */
export function isFirmsKey(firm: FirmId, key: string): boolean {
  return (
    key.startsWith(firmPath(firm)) &&
    key.length > firmPath(firm).length &&
    key.length <= 1_024 &&
    !key.split('/').some((part) => part === '' || part === '.' || part === '..') &&
    /^[A-Za-z0-9._/-]+$/.test(key)
  );
}

/** The name a call's recording is kept under: firms/<firm>/calls/<call>.mp3, from the ending of the inbox's name. */
export function recordingKey(firm: FirmId, call: CallId, from: string): string {
  if (!isId(call)) {
    throw new RangeError('Not a call');
  }
  const ending = from.split('.').pop()?.toLowerCase() ?? '';
  const known = (RECORDING_ENDINGS as readonly string[]).includes(ending) ? `.${ending}` : '';
  return `${firmPath(firm)}calls/${call}${known}`;
}

/** The name a firm's export is kept under. */
export function exportKey(firm: FirmId, id: FirmExportId): string {
  if (!isId(id)) {
    throw new RangeError('Not an export');
  }
  return `${firmPath(firm)}exports/${id}.zip`;
}

function storesOf(db: RecordDb): FileStores {
  if (db.files === null) {
    throw new Error('No file store was given');
  }
  return db.files;
}

/** Refuses a name that is not under the firm's path. */
function checked(firm: FirmId, key: string): string {
  if (!isFirmsKey(firm, key)) {
    throw new RangeError('Not this firm’s file');
  }
  return key;
}

/**
 * Moves a recording from the inbox into the kept store, under its kept name.
 * Gives what happened:
 * - moved: it is in the kept store, and gone from the inbox
 * - already: it was in the kept store already (an earlier run stopped
 *   halfway); the inbox's copy, if any, is gone now
 * - missing: it is in neither, such as when Vapi is still writing it
 * Running it again at any point does no harm: the kept copy is written
 * whole or not at all, and deleting what is gone does nothing.
 */
export async function moveFile(db: RecordDb, firm: FirmId, from: string, to: string): Promise<'moved' | 'already' | 'missing'> {
  const { kept, inbox } = storesOf(db);
  const source = await inbox.get(checked(firm, from));
  if (source === null) {
    return (await kept.head(checked(firm, to))) === null ? 'missing' : 'already';
  }
  const contentType = source.httpMetadata?.contentType ?? contentTypeOf(to);
  // A stream of known length, as the file store wants.
  const sized = new FixedLengthStream(source.size);
  const [, written] = await Promise.all([
    source.body.pipeTo(sized.writable),
    kept.put(checked(firm, to), sized.readable, { httpMetadata: { contentType } }),
  ]);
  if (written === null) {
    throw new Error('The file store did not take the file');
  }
  await inbox.delete(from);
  return 'moved';
}

function contentTypeOf(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

/**
 * Puts a file in the inbox under the firm's path, as Vapi does when a call
 * ends. Only for playing a call on this machine (src/example/play-call.ts):
 * nothing deployed writes to the inbox.
 */
export async function placeInInbox(db: RecordDb, firm: FirmId, name: string, body: Uint8Array): Promise<void> {
  await storesOf(db).inbox.put(checked(firm, name), body, { httpMetadata: { contentType: contentTypeOf(name) } });
}

/** Deletes some of the firm's files from one store. Each must be under the firm's path. Deleting one that is gone does nothing. */
export async function deleteFiles(db: RecordDb, firm: FirmId, store: StoreName, keys: readonly string[]): Promise<void> {
  const bucket = storesOf(db)[store];
  const names = keys.map((key) => checked(firm, key));
  for (let start = 0; start < names.length; start += BATCH) {
    await bucket.delete(names.slice(start, start + BATCH));
  }
}

/** One of the firm's files, as a listing gives it. */
export interface FileListed {
  key: string;
  size: number;
  /** When it was written, by the real clock: the file store's own time. */
  uploaded: Instant;
}

/** Every file of the firm's in one store, under one part of its path such as "calls/", in name order. */
export async function listFiles(db: RecordDb, firm: FirmId, store: StoreName, under = ''): Promise<FileListed[]> {
  return listUnder(storesOf(db)[store], `${firmPath(firm)}${under}`);
}

async function listUnder(bucket: FileBucket, prefix: string): Promise<FileListed[]> {
  const found: FileListed[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix, limit: BATCH, ...(cursor === undefined ? {} : { cursor }) });
    for (const object of page.objects) {
      found.push({ key: object.key, size: object.size, uploaded: instant(object.uploaded.getTime()) });
    }
    if (!page.truncated) return found;
    cursor = page.cursor;
  }
}

/** Deletes every file of the firm's in one store. Gives how many there were. */
export async function deleteAllFiles(db: RecordDb, firm: FirmId, store: StoreName): Promise<number> {
  const all = await listFiles(db, firm, store);
  await deleteFiles(db, firm, store, all.map((file) => file.key));
  return all.length;
}

/** One of the firm's kept files, to read once, or null when it is not there. */
export async function readFile(db: RecordDb, firm: FirmId, key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  const found = await storesOf(db).kept.get(checked(firm, key));
  return found === null ? null : { body: found.body as ReadableStream<Uint8Array>, size: found.size };
}

/** Whether one of the firm's kept files is there. */
export async function hasFile(db: RecordDb, firm: FirmId, key: string): Promise<boolean> {
  return (await storesOf(db).kept.head(checked(firm, key))) !== null;
}

/**
 * Writes one of the firm's kept files in parts, for a file too large to
 * hold at once, such as a firm's export. Nothing is in the store under the
 * name until finish() is called; abort() gives up, leaving nothing.
 */
export interface FileWriter {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<number>;
  abort(): Promise<void>;
}

export async function writeFile(db: RecordDb, firm: FirmId, key: string): Promise<FileWriter> {
  const upload = await storesOf(db).kept.createMultipartUpload(checked(firm, key), { httpMetadata: { contentType: contentTypeOf(key) } });
  const parts: R2UploadedPart[] = [];
  let pending: Uint8Array[] = [];
  let pendingSize = 0;
  let size = 0;
  const sendPart = async (): Promise<void> => {
    const part = new Uint8Array(pendingSize);
    let at = 0;
    for (const chunk of pending) {
      part.set(chunk, at);
      at += chunk.length;
    }
    pending = [];
    pendingSize = 0;
    parts.push(await upload.uploadPart(parts.length + 1, part));
  };
  return {
    async write(chunk) {
      pending.push(chunk);
      pendingSize += chunk.length;
      size += chunk.length;
      if (pendingSize >= PART_SIZE) await sendPart();
    },
    async finish() {
      if (pendingSize > 0 || parts.length === 0) await sendPart();
      await upload.complete(parts);
      return size;
    },
    async abort() {
      await upload.abort();
    },
  };
}

/** A delete noted in the restore ledger. */
export type LedgerEntry =
  | { kind: 'customer'; firm: FirmId; customer: CustomerId; at: Instant }
  | { kind: 'firm'; firm: FirmId; at: Instant };

/** What a ledger note is given: the delete, without its time, which the note takes from the real clock. */
export type LedgerNote = { kind: 'customer'; firm: FirmId; customer: CustomerId } | { kind: 'firm'; firm: FirmId };

const LEDGER = 'deletions/';

/**
 * Notes a delete in the restore ledger, before it is done: a restore of the
 * database does not touch the file store, so after one, each delete noted
 * since can be done again (docs/restore.md). Ids only.
 */
export async function noteDeletion(db: RecordDb, entry: LedgerNote): Promise<void> {
  if (!isId(entry.firm) || (entry.kind === 'customer' && !isId(entry.customer))) {
    throw new RangeError('Not an id');
  }
  // Written by the real clock, so the ledger is in the order things happened.
  const at = db.realClock.now();
  const key = `${LEDGER}${String(at).padStart(16, '0')}-${newId()}.json`;
  const body = entry.kind === 'customer' ? { kind: entry.kind, firm: entry.firm, customer: entry.customer, at } : { kind: entry.kind, firm: entry.firm, at };
  await storesOf(db).kept.put(key, JSON.stringify(body), { httpMetadata: { contentType: 'application/json' } });
}

/**
 * The deletes noted in the restore ledger at or after an instant, oldest
 * first, by the real clock. Across every firm: after a restore, every
 * firm's deletes are done again. Ids only.
 */
export async function ledgerSince(db: RecordDb, since: Instant): Promise<LedgerEntry[]> {
  const bucket = storesOf(db).kept;
  const entries: LedgerEntry[] = [];
  for (const file of await listUnder(bucket, LEDGER)) {
    const at = Number(file.key.slice(LEDGER.length, LEDGER.length + 16));
    if (!Number.isSafeInteger(at) || at < since) continue;
    const found = await bucket.get(file.key);
    const entry = found === null ? null : ledgerEntry(await found.json(), at);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

function ledgerEntry(body: unknown, at: number): LedgerEntry | null {
  if (typeof body !== 'object' || body === null) return null;
  const { kind, firm, customer } = body as Record<string, unknown>;
  if (!isId(firm)) return null;
  if (kind === 'firm') return { kind, firm: firm as FirmId, at: instant(at) };
  if (kind === 'customer' && isId(customer)) return { kind, firm: firm as FirmId, customer: customer as CustomerId, at: instant(at) };
  return null;
}

/** Deletes the ledger's notes from before an instant, by the real clock. Gives how many. */
export async function trimLedger(db: RecordDb, before: Instant): Promise<number> {
  const bucket = storesOf(db).kept;
  const old = (await listUnder(bucket, LEDGER)).filter((file) => Number(file.key.slice(LEDGER.length, LEDGER.length + 16)) < before);
  for (let start = 0; start < old.length; start += BATCH) {
    await bucket.delete(old.slice(start, start + BATCH).map((file) => file.key));
  }
  return old.length;
}
