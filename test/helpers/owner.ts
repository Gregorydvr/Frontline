// Logging an owner in for a test, and opening the app's pages as them, at
// the app's address in tests.

import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { AppEnv } from '../../src/app';
import { createLoginLink, listOwners, logInWithLink } from '../../src/record';
import type { RecordDb } from '../../src/record/db';
import type { FirmId } from '../../src/record/types';
import { APP_ADDRESS } from './deps';

/** The cookie of a new login for the firm's first owner, as the browser sends it back. */
export async function ownerCookie(db: RecordDb, firm: FirmId): Promise<string> {
  const [owner] = await listOwners(db, firm);
  if (owner === undefined) throw new Error('The firm has no owner');
  const { token } = await createLoginLink(db, firm, { owner: owner.id, job: null });
  const login = await logInWithLink(db, token);
  if (login === null) throw new Error('Not logged in');
  return `__Host-login=${login.session}`;
}

/** Opens a page of the app at the app's address, with a login's cookie, or with none. */
export function opener(app: Hono<AppEnv>, cookie: string | null) {
  return (path: string, init: RequestInit = {}): Promise<Response> =>
    Promise.resolve(
      app.request(
        `${APP_ADDRESS}${path}`,
        { ...init, headers: { ...(cookie === null ? {} : { Cookie: cookie }), ...(init.headers as Record<string, string> | undefined) } },
        env,
      ),
    );
}

/** A form posted from one of the app's own pages, as a browser posts it. */
export function form(fields: Record<string, string>): RequestInit {
  const body = new URLSearchParams(fields).toString();
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(body.length),
      Origin: APP_ADDRESS,
    },
    body,
    redirect: 'manual',
  };
}

/** The rows of a list on a page, as the owner reads them: "first line / second line [chip]". */
export function rowsOf(page: string): string[] {
  return [...page.matchAll(/<(?:div|a) class="row"[^>]*>(?:<span class="tile">.*?<\/span>)?<span class="txt">(.*?)<\/span>(?:<svg[^>]*><use[^>]*><\/use><\/svg>)?<\/(?:div|a)>/g)].map(([, row]) =>
    (row ?? '')
      .replace(/<span class="chip[^"]*">(.*?)<\/span>/g, ' [$1]')
      .replace(/<span class="t2">/g, ' / ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'"),
  );
}

/** The lines of a feed (Done for you), as the owner reads them: "time line". */
export function feedOf(page: string): string[] {
  return [...page.matchAll(/<span class="ft">(.*?)<\/span><time>(.*?)<\/time>/g)].map(([, line, time]) => `${time ?? ''} ${(line ?? '').replace(/&amp;/g, '&')}`);
}
