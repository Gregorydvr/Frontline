import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { version } from '../package.json';
import type { Deps } from './deps';
import { runDue } from './due';
import { landCall } from './land-call';
import { errorName, log } from './log';
import { stopOrStart } from './messages';
import { isUkMobile } from './phone';
import { formField, isFromTwilio, readTwilioForm } from './providers/texts/twilio';
import { findFirmByNumber, recordDelivery, recordTextIn } from './record';
import { openRecord } from './record/db';
import { TEXT_LIMITS } from './record/types';
import { bearerToken, sameSecret } from './secret';
import { readVapiMessage } from './vapi-report';

/** The answer to Twilio for a text that came in: empty, so Twilio sends no reply. */
const NO_REPLY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface AppEnv {
  Bindings: Env;
  Variables: { deps: Deps };
}

/**
 * The Worker's routes. `makeDeps` builds what each request is given: the real
 * clock and providers in the Worker, pretend ones in tests. `extend` adds to
 * the app before its own routes, so anything it adds sees every request; only
 * the version for this machine (src/local.ts) uses it.
 */
export function createApp(makeDeps: (env: Env) => Deps, extend?: (app: Hono<AppEnv>) => void): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set('deps', makeDeps(c.env));
    await next();
  });

  extend?.(app);

  app.get('/health', (c) => c.json({ version }, 200, { 'Cache-Control': 'no-store' }));

  // Where Vapi sends its messages about a firm's calls (docs/vapi.md). It is
  // outside the practice gate, so it checks Vapi's secret before it reads
  // anything, and refuses everything when no secret is set up.
  app.post('/vapi/server', async (c) => {
    if (!(await sameSecret(bearerToken(c.req.header('Authorization')), c.env.VAPI_SECRET))) {
      log('call_report_refused');
      return c.body(null, 401);
    }
    const message = readVapiMessage(await c.req.json().catch(() => null));
    switch (message.kind) {
      case 'other':
        return c.json({});
      case 'unreadable':
        log('call_report_unreadable');
        return c.json({}, 400);
      case 'report': {
        const deps = c.get('deps');
        const db = openRecord(c.env.DB, deps.clock);
        const landed = await landCall(db, message.report);
        if (landed.result === 'stored' && landed.alert !== null) {
          // An urgent call: the owner is alerted at once, before Vapi gets
          // its answer. If this fails, the clock runs the row again shortly,
          // and the alert still cannot go twice. The call is kept either way.
          try {
            await runDue(db, deps, landed.firm, landed.alert);
          } catch (thrown) {
            log('due_failed', { firm: landed.firm, due: landed.alert, error: errorName(thrown) });
          }
        }
        return c.json({}, landed.result === 'unknown_number' ? 404 : 200);
      }
    }
  });

  // Where Twilio sends a text that came in to a firm's number
  // (docs/twilio.md). Outside the practice gate, so it checks Twilio's
  // signature before it reads anything. The text is stored against the
  // customer and shown on their job's page. A STOP or START opts the number
  // out or back in. Nothing answers it in Release 1.
  app.post('/twilio/texts', async (c) => {
    const form = await readTwilioForm(c.req.raw);
    if (form === null) {
      log('twilio_too_large');
      return c.body(null, 413);
    }
    if (!(await isFromTwilio(c.env.TWILIO_AUTH_TOKEN, c.req.url, form, c.req.header('X-Twilio-Signature')))) {
      log('twilio_refused');
      return c.body(null, 401);
    }
    const to = formField(form, 'To');
    const providerId = formField(form, 'MessageSid');
    const words = formField(form, 'Body') ?? '';
    if (to === null || !isUkMobile(to) || providerId === null || providerId.length > TEXT_LIMITS.providerId || words.length > TEXT_LIMITS.textIn) {
      log('twilio_unreadable');
      return c.body(null, 400);
    }
    const db = openRecord(c.env.DB, c.get('deps').clock);
    const firm = await findFirmByNumber(db, to);
    if (firm === null) {
      log('text_in_for_unknown_number');
      return c.body(null, 404);
    }
    const stored = await recordTextIn(db, firm, {
      provider: 'twilio',
      providerId,
      from: formField(form, 'From'),
      words,
      consent: stopOrStart(words),
    });
    log(stored.result === 'stored' ? 'text_in_stored' : 'text_in_repeated', { firm, text: stored.text });
    if (stored.result === 'stored' && stored.consented.length > 0) {
      log('text_in_consent', { firm, text: stored.text, customers: stored.consented.length });
    }
    return c.body(NO_REPLY, 200, { 'Content-Type': 'text/xml' });
  });

  // Where Twilio reports on the delivery of a text sent from a firm's number.
  // Outside the practice gate, so it checks Twilio's signature first. A text
  // only moves forward: delivered, or failed.
  app.post('/twilio/status', async (c) => {
    const form = await readTwilioForm(c.req.raw);
    if (form === null) {
      log('twilio_too_large');
      return c.body(null, 413);
    }
    if (!(await isFromTwilio(c.env.TWILIO_AUTH_TOKEN, c.req.url, form, c.req.header('X-Twilio-Signature')))) {
      log('twilio_refused');
      return c.body(null, 401);
    }
    const from = formField(form, 'From');
    const providerId = formField(form, 'MessageSid');
    const status = formField(form, 'MessageStatus');
    if (from === null || !isUkMobile(from) || providerId === null || status === null) {
      log('twilio_unreadable');
      return c.body(null, 400);
    }
    const db = openRecord(c.env.DB, c.get('deps').clock);
    const firm = await findFirmByNumber(db, from);
    // Twilio's other statuses (queued, sending, sent and the rest) say it is
    // still on its way, which the record already knows.
    const report =
      status === 'delivered'
        ? ({ delivered: true } as const)
        : status === 'failed' || status === 'undelivered'
          ? ({ delivered: false, errorCode: errorCode(formField(form, 'ErrorCode')) } as const)
          : null;
    if (firm === null || report === null) {
      return c.body(null, 200);
    }
    const message = await recordDelivery(db, firm, 'twilio', providerId, report);
    if (message === null) {
      log('delivery_for_unknown_text', { firm });
    } else {
      log('delivery_recorded', { firm, message });
    }
    return c.body(null, 200);
  });

  app.onError((thrown, c) => {
    // A refusal on purpose, such as a 401 from an auth check, keeps its own
    // answer and is not an error.
    if (thrown instanceof HTTPException) {
      return thrown.getResponse();
    }
    // Hono's own handler would log the error's message, which can hold a
    // customer's details. Log only its type (rule 11).
    log('unhandled_error', { error: errorName(thrown) });
    return c.text('Internal Server Error', 500);
  });

  return app;
}

function errorCode(text: string | null): number | null {
  return text !== null && /^\d{1,9}$/.test(text) ? Number(text) : null;
}
