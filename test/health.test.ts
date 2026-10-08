import { env, exports } from 'cloudflare:workers';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../package.json';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Worker', () => {
  it('answers GET /health with the version', async () => {
    const response = await exports.default.fetch('http://localhost/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 404 for an address it does not know', async () => {
    const response = await exports.default.fetch('http://localhost/nothing-here');
    expect(response.status).toBe(404);
  });
});

describe('createApp', () => {
  it('gives every request the clock it was built with', async () => {
    const clock = pretendClock(instantFromIso('2026-09-28T10:15:00Z'));
    const app = createApp(() => ({ clock }));
    app.get('/test/now', (c) => c.json({ now: c.get('deps').clock.now() }));

    const first = await app.request('/test/now', {}, env);
    expect(await first.json()).toEqual({ now: instantFromIso('2026-09-28T10:15:00Z') });

    clock.advance(60_000);
    const second = await app.request('/test/now', {}, env);
    expect(await second.json()).toEqual({ now: instantFromIso('2026-09-28T10:16:00Z') });
  });

  it('answers an unexpected error with a plain 500 and logs its type, never its message', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp(() => ({ clock: pretendClock(instantFromIso('2026-09-28T10:15:00Z')) }));
    app.get('/test/fail', () => {
      throw new TypeError('Mrs Ahmed, 27 Station Road, 07700 900123');
    });

    const response = await app.request('/test/fail', {}, env);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(logged.mock.calls).toEqual([[JSON.stringify({ error: 'TypeError', event: 'unhandled_error' })]]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('keeps the answer of a refusal on purpose, such as a 401, and logs nothing', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp(() => ({ clock: pretendClock(instantFromIso('2026-09-28T10:15:00Z')) }));
    app.get('/test/refuse', () => {
      throw new HTTPException(401);
    });

    const response = await app.request('/test/refuse', {}, env);

    expect(response.status).toBe(401);
    expect(logged).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});
