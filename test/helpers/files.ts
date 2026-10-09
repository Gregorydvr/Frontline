// The file stores in tests: the local ones the test runtime gives (the same
// as D1's local database, kept apart between test files), and a wrapper that
// makes one step fail on purpose, to show that stopping halfway and running
// again does no harm. Lint lets this file, and src/record/files.ts, use a
// file store.

import { env } from 'cloudflare:workers';
import type { FileBucket, FileStores } from '../../src/record/files';

/** The local file stores. */
export function localFiles(): FileStores {
  return { kept: env.FILES, inbox: env.CALLS_IN };
}

type Step = 'put' | 'delete' | 'get' | 'list' | 'createMultipartUpload';

/**
 * A file store that fails the nth time one step is asked of it (counting
 * from 1), and works as the store it wraps otherwise.
 */
export function failingOn(bucket: FileBucket, step: Step, nth = 1): FileBucket & { failed: boolean } {
  let count = 0;
  const wrapper = {
    failed: false,
    head: (key: string) => bucket.head(key),
    get: async (key: string) => {
      check('get');
      return bucket.get(key);
    },
    put: async (key: string, value: Parameters<FileBucket['put']>[1], options?: R2PutOptions) => {
      check('put');
      return bucket.put(key, value, options);
    },
    delete: async (keys: string | string[]) => {
      check('delete');
      return bucket.delete(keys);
    },
    list: async (options?: R2ListOptions) => {
      check('list');
      return bucket.list(options);
    },
    createMultipartUpload: async (key: string, options?: R2MultipartOptions) => {
      check('createMultipartUpload');
      return bucket.createMultipartUpload(key, options);
    },
  };
  function check(asked: Step): void {
    if (asked !== step) return;
    count += 1;
    if (count === nth) {
      wrapper.failed = true;
      throw new Error('Broken on purpose');
    }
  }
  return wrapper;
}

/** Every name in one of the local file stores, under one path. */
export async function namesIn(bucket: FileBucket, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) });
    names.push(...page.objects.map((object) => object.key));
    if (!page.truncated) return names;
    cursor = page.cursor;
  }
}

/** What a file in one of the local file stores holds, as text, or null when it is not there. */
export async function fileText(bucket: FileBucket, key: string): Promise<string | null> {
  const found = await bucket.get(key);
  return found === null ? null : found.text();
}

/** Deletes one file from one of the local file stores, as a step that ran before a stop. */
export async function removeFile(bucket: FileBucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/** Writes a file into one of the local file stores, as a step that ran before a stop. */
export async function putFile(bucket: FileBucket, key: string, text: string): Promise<void> {
  await bucket.put(key, text);
}
