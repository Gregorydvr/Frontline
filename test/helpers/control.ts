// Opening the control room in a test, at its address in tests, as the
// stand-in member of staff, or as anyone else.

import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { AppEnv } from '../../src/app';
import { CONTROL_ADDRESS } from './deps';

/** Opens a page of the control room at its address. */
export function controlOpener(app: Hono<AppEnv>) {
  return (path: string, init: RequestInit = {}): Promise<Response> => Promise.resolve(app.request(`${CONTROL_ADDRESS}${path}`, init, env));
}

/** A form posted from one of the control room's own pages, as a browser posts it. */
export function controlForm(fields: Record<string, string>, origin = CONTROL_ADDRESS): RequestInit {
  const body = new URLSearchParams(fields).toString();
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length), Origin: origin },
    body,
    redirect: 'manual',
  };
}
