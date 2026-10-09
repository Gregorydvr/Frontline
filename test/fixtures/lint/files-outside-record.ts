// Deliberate mistakes, for the check in eslint.config.js that keeps the file
// stores inside src/record/files.ts (rule 8 in CLAUDE.md, slice H). Nothing
// runs this file: lint reads it.
//
// Each mistake carries a comment that turns its rule off for the next line.
// A comment that turns off nothing fails `npm run check`, so if the check
// ever stops catching one of these, the check goes red.

import type { FileBucket, FileStores } from '../../../src/record/files';

export async function mistakes(bucket: R2Bucket, stores: FileStores, ours: FileBucket, maybe: R2Bucket | undefined): Promise<unknown[]> {
  // eslint-disable-next-line frontline/files-outside-record -- deliberate: a file named by anyone, for any firm
  await bucket.put('firms/another-firm/calls/one.mp3', 'stolen');

  // eslint-disable-next-line frontline/files-outside-record -- deliberate: the record's own stores, used past it
  await stores.kept.delete('firms/another-firm/calls/one.mp3');

  // eslint-disable-next-line frontline/files-outside-record -- deliberate: so is the record's own type
  await ours.list({ prefix: 'firms/' });

  // eslint-disable-next-line frontline/files-outside-record -- deliberate: so is one that might be missing
  await maybe?.head('firms/another-firm/calls/one.mp3');

  const found = await stores.inbox.get('firms/another-firm/one.mp3'); // eslint-disable-line frontline/files-outside-record -- deliberate
  // eslint-disable-next-line frontline/files-outside-record -- deliberate: an object read past the record
  const words = await found?.text();

  // eslint-disable-next-line frontline/files-outside-record, @typescript-eslint/unbound-method -- deliberate
  const { put } = bucket;
  return [words, put];
}
