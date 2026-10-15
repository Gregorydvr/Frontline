// Every action in the app, by name (task 4 of docs/autopilot.md). An action
// is anything that changes the record or reaches a provider: what an owner,
// Front-line's staff, a customer or the system itself does. Each one here
// says in plain words what it does and who may take it, and records who took
// it, as the record functions it calls do (rule 15).
//
// The routes take every action through act(), and lint fails a route that
// changes the record any other way. So the same list serves a future AI
// assistant: it would be given these names and words, take each one as the
// person it acts for, and be refused anything that person may not do.
//
// Who, in Greg's words: the owner; Front-line, meaning its staff in the
// control room; the customer, from their link; and the system, meaning
// Front-line's own code acting by itself, such as a call landing, a text
// coming in, or a row in the due list. In the record, the system is the
// actor `{ kind: 'frontline' }`.
//
// Reading is not an action: views stay in the routes, and a view the staff
// log must record is logged there (rule 15). The rows of the due list are the
// system's timed actions, each named in DUE_ACTIONS and run by src/due.ts.

import { pushAgent, type Pushed } from './agent-push';
import { answerBook } from './booking';
import { instant, instantFromIso, type Instant } from './clock';
import type { Deps } from './deps';
import type { CallRef, Diary } from './diary';
import { everyMinute, runDue } from './due';
import { loadExample } from './example/load';
import { EXAMPLE_NOW } from './example/tidewell';
import { landCall, type Landed } from './land-call';
import { errorName, log } from './log';
import type { CallerNumber, UkMobile } from './phone';
import {
  askFirmExport,
  cancelLeaving,
  confirmCustomerDetails,
  countLoginLinks,
  createFirm,
  createLoginLink,
  createOwner,
  customerFile,
  deleteCustomer,
  deleteExampleFirm,
  endSession,
  exampleFirms,
  findOwnersByMobile,
  getFirm,
  getJob,
  ledgerSince,
  listFirms,
  logInWithLink,
  logStaff,
  markLeaving,
  recordDelivery,
  recordOwnerMessage,
  recordTextIn,
  redoCustomerDelete,
  setAgent,
  setDiaryRules,
  setExampleClock,
  setFirmNumber,
  setOwnerMobile,
  setService,
  setStopButton,
  setUrgentList,
  setWording,
  deleteFirm,
  markMissingRecordings,
  redoFirmDelete,
} from './record';
import type { CustomerFile, Deleted } from './record/control';
import type { CustomerDetails } from './record/customers';
import { Refused, withFirmClock, type RecordDb } from './record/db';
import { LOGIN_LINK_LIMITS, type SessionToken } from './record/logins';
import type { NumberSet } from './record/firms';
import type { RecordedTextIn } from './record/texts-in';
import type {
  Actor,
  AgreedHow,
  CustomerId,
  DiaryRules,
  DueId,
  Firm,
  FirmExportId,
  FirmId,
  JobId,
  MessageId,
  MessageKind,
  OwnerId,
  OwnerMessageId,
  Service,
  StaffId,
  TextProvider,
  WordingId,
} from './record/types';
import { stopOrStart } from './messages';
import type { CallReport } from './vapi-report';

/** Who may take an action: the owner, Front-line's staff, the customer, or the system itself. */
export type Who = 'owner' | 'staff' | 'customer' | 'system';

/** Who an actor in the record is. */
export function whoIs(by: Actor): Who {
  return by.kind === 'frontline' ? 'system' : by.kind;
}

/** What every action is given: the record, the whole database for the two that need it, what comes from outside, and who is taking it. */
export interface ActionContext {
  db: RecordDb;
  d1: D1Database;
  deps: Deps;
  by: Actor;
}

interface Action<Input, Output> {
  /** What it does, in plain words. */
  says: string;
  /** Who may take it. Anyone else is refused, and nothing changes. */
  who: readonly Who[];
  run(ctx: ActionContext, input: Input): Promise<Output>;
}

function action<Input, Output>(def: Action<Input, Output>): Action<Input, Output> {
  return def;
}

/** The member of staff taking an action that only staff may take. */
function staffOf(ctx: ActionContext): StaffId {
  if (ctx.by.kind !== 'staff') throw new Refused();
  return ctx.by.staff;
}

/** The record as the firm reads the time: its own clock if it is an example firm moved on. */
async function firmDb(ctx: ActionContext, firm: FirmId): Promise<{ db: RecordDb; firm: Firm }> {
  const found = await getFirm(ctx.db, firm);
  if (found === null) throw new Refused();
  return { db: withFirmClock(ctx.db, found), firm: found };
}

export const ACTIONS = {
  // The system: calls, tool calls during a call, texts coming in, delivery
  // reports, and logging in, where the link stands for the owner and the
  // record names them.
  land_call: action({
    says: 'Keeps a call as its report comes in from Vapi, and alerts the owner at once if it is urgent.',
    who: ['system'],
    async run(ctx, input: { report: CallReport }): Promise<Landed> {
      const landed = await landCall(ctx.db, input.report, ctx.deps.textsOn);
      if (landed.result === 'stored' && landed.alert !== null) {
        // Sent at once, before Vapi gets its answer. If this fails, the clock
        // runs the row again shortly, and the alert still cannot go twice.
        // The call is kept either way.
        try {
          await runDue(ctx.db, ctx.deps, landed.firm, landed.alert);
        } catch (thrown) {
          log('due_failed', { firm: landed.firm, due: landed.alert, error: errorName(thrown) });
        }
      }
      return landed;
    },
  }),
  book_on_call: action({
    says: 'Holds one of the firm’s free times for a caller, as the voice agent books it during the call.',
    who: ['system'],
    run(ctx, input: { diary: Diary; firm: Firm; call: CallRef | null; args: Record<string, unknown> | null; from: CallerNumber }): Promise<string> {
      return answerBook(input.diary, input.firm, input.call, input.args, {
        db: withFirmClock(ctx.db, input.firm),
        from: input.from,
        linkAddress: ctx.deps.linkAddress,
      });
    },
  }),
  take_text_in: action({
    says: 'Keeps a text that came in to the firm’s number, and acts on a STOP or START.',
    who: ['system'],
    async run(ctx, input: { firm: FirmId; provider: TextProvider; providerId: string; from: string | null; words: string }): Promise<RecordedTextIn> {
      const stored = await recordTextIn(ctx.db, input.firm, { ...input, consent: stopOrStart(input.words) });
      log(stored.result === 'stored' ? 'text_in_stored' : 'text_in_repeated', { firm: input.firm, text: stored.text });
      if (stored.result === 'stored' && stored.consented.length > 0) {
        log('text_in_consent', { firm: input.firm, text: stored.text, customers: stored.consented.length });
      }
      return stored;
    },
  }),
  record_delivery: action({
    says: 'Records whether a text the firm sent was delivered.',
    who: ['system'],
    async run(ctx, input: { firm: FirmId; provider: TextProvider; providerId: string; report: { delivered: true } | { delivered: false; errorCode: number | null } }): Promise<MessageId | null> {
      const message = await recordDelivery(ctx.db, input.firm, input.provider, input.providerId, input.report);
      if (message === null) log('delivery_for_unknown_text', { firm: input.firm });
      else log('delivery_recorded', { firm: input.firm, message });
      return message;
    },
  }),
  send_login_link: action({
    says: 'Texts a link to log in to the mobile on an owner’s record, if the number typed is an owner’s, within the limits on how many.',
    who: ['system'],
    async run(ctx, input: { mobile: UkMobile; job: JobId | null }): Promise<void> {
      const now = ctx.db.clock.now();
      log('login_asked');
      for (const { firm, owner } of await findOwnersByMobile(ctx.db, input.mobile)) {
        if (
          (await countLoginLinks(ctx.db, firm, owner, instant(now - 60 * 60_000))) >= LOGIN_LINK_LIMITS.hour ||
          (await countLoginLinks(ctx.db, firm, owner, instant(now - 24 * 60 * 60_000))) >= LOGIN_LINK_LIMITS.day
        ) {
          log('login_link_limit', { firm, owner });
          continue;
        }
        // A job to land on only if it is this firm's.
        const landOn = input.job === null ? null : ((await getJob(ctx.db, firm, input.job))?.id ?? null);
        const { due } = await createLoginLink(ctx.db, firm, { owner, job: landOn });
        log('login_link_made', { firm, due });
        // Sent at once. If this fails, the clock runs the row again shortly,
        // and the text still cannot go twice.
        try {
          await runDue(ctx.db, ctx.deps, firm, due);
        } catch (thrown) {
          log('due_failed', { firm, due, error: errorName(thrown) });
        }
      }
    },
  }),
  log_in: action({
    says: 'Logs an owner in with the link they were texted, once. The record names the owner the link was for.',
    who: ['system'],
    async run(ctx, input: { token: string }): Promise<{ firm: FirmId; owner: OwnerId; job: JobId | null; session: SessionToken } | null> {
      const login = await logInWithLink(ctx.db, input.token);
      if (login === null) log('login_link_not_found');
      else log('logged_in', { firm: login.firm, owner: login.owner });
      return login;
    },
  }),

  // The owner, in the owner's app.
  log_out: action({
    says: 'Logs the owner out on this phone or computer.',
    who: ['owner'],
    async run(ctx, input: { firm: FirmId; session: SessionToken }): Promise<void> {
      if (ctx.by.kind !== 'owner') throw new Refused();
      await endSession(ctx.db, input.firm, input.session);
      log('logged_out', { firm: input.firm, owner: ctx.by.owner });
    },
  }),
  message_frontline: action({
    says: 'Sends Front-line a message from the owner, kept as written.',
    who: ['owner'],
    async run(ctx, input: { firm: FirmId; words: string }): Promise<OwnerMessageId> {
      if (ctx.by.kind !== 'owner') throw new Refused();
      const message = await recordOwnerMessage(ctx.db, input.firm, ctx.by.owner, input.words);
      log('owner_message_stored', { firm: input.firm, message });
      return message;
    },
  }),

  // The customer, from the link in their first text.
  confirm_details: action({
    says: 'Confirms or corrects the customer’s name, address and email, from their link.',
    who: ['customer'],
    async run(ctx, input: { firm: FirmId; customer: CustomerId; job: JobId; details: CustomerDetails }): Promise<'details_confirmed' | 'details_corrected'> {
      const kind = await confirmCustomerDetails(ctx.db, input.firm, input.customer, input.job, input.details);
      log('details_saved', { firm: input.firm, customer: input.customer, corrected: kind === 'details_corrected' });
      return kind;
    },
  }),

  // Front-line's staff, in the control room. Each is in the staff log.
  switch_service: action({
    says: 'Switches one of the firm’s services on or off.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; service: Service; on: boolean }): Promise<void> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await setService(db, input.firm, input.service, input.on, ctx.by);
      await logStaff(db, input.firm, staff, input.on ? 'service_on' : 'service_off', { service: input.service });
      log('staff_changed_firm', { firm: input.firm, staff });
    },
  }),
  set_stop_button: action({
    says: 'Turns the firm’s stop button on or off. While it is on, no text goes to the firm’s customers.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; on: boolean }): Promise<void> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await setStopButton(db, input.firm, input.on, ctx.by);
      await logStaff(db, input.firm, staff, input.on ? 'stop_on' : 'stop_off');
      log('staff_changed_firm', { firm: input.firm, staff });
    },
  }),
  export_customer: action({
    says: 'Gives everything held about one customer, for the member of staff who asked. Front-line keeps no copy.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; customer: CustomerId }): Promise<CustomerFile | null> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const file = await customerFile(db, input.firm, input.customer);
      if (file === null) return null;
      await logStaff(db, input.firm, staff, 'exported_customer', { customer: input.customer });
      log('customer_exported', { firm: input.firm, customer: input.customer, staff });
      return file;
    },
  }),
  delete_customer: action({
    says: 'Deletes a customer and everything about them, once their name is typed as held.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; customer: CustomerId; typedName: string }): Promise<Deleted | null> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const deleted = await deleteCustomer(db, input.firm, input.customer, staff, input.typedName);
      if (deleted !== null) log('customer_deleted', { firm: input.firm, customer: input.customer, staff });
      return deleted;
    },
  }),
  ask_firm_export: action({
    says: 'Asks for a file of everything the firm holds, made by a row in the due list.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId }): Promise<FirmExportId> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const id = await askFirmExport(db, input.firm, staff);
      log('firm_export_asked', { firm: input.firm, staff });
      return id;
    },
  }),
  mark_leaving: action({
    says: 'Marks the firm as leaving, once its name is typed: stop button on, every service off, its export asked for, and its delete in 30 days.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; typedName: string }): Promise<DueId> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const due = await markLeaving(db, input.firm, staff, input.typedName);
      log('firm_leaving', { firm: input.firm, staff });
      return due;
    },
  }),
  cancel_leaving: action({
    says: 'Cancels a firm’s leaving, until it is deleted.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId }): Promise<void> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await cancelLeaving(db, input.firm, staff);
      log('firm_leaving_cancelled', { firm: input.firm, staff });
    },
  }),
  delete_firm: action({
    says: 'Deletes a leaving firm and everything it holds, once its export is made and its name typed.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; typedName: string }): Promise<void> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await deleteFirm(db, input.firm, staff, input.typedName);
      log('firm_deleted', { firm: input.firm, staff });
    },
  }),
  replay_deletions: action({
    says: 'After the database is restored to an earlier point, deletes again every customer and firm deleted since then.',
    who: ['staff'],
    async run(ctx, input: { since: Instant }): Promise<{ customers: number; firms: number; recordings: number }> {
      const staff = staffOf(ctx);
      const done = { customers: 0, firms: 0, recordings: 0 };
      for (const entry of await ledgerSince(ctx.db, input.since)) {
        const firm = await getFirm(ctx.db, entry.firm);
        if (firm === null) continue;
        const db = withFirmClock(ctx.db, firm);
        if (entry.kind === 'customer') {
          if ((await redoCustomerDelete(db, firm.id, entry.customer, staff)) !== null) done.customers += 1;
        } else if ((await redoFirmDelete(db, firm.id, staff)) === 'deleted') {
          done.firms += 1;
        }
      }
      for (const firm of await listFirms(ctx.db, staff)) {
        done.recordings += await markMissingRecordings(withFirmClock(ctx.db, firm), firm.id);
      }
      log('deletions_replayed', { staff, ...done });
      return done;
    },
  }),
  add_firm: action({
    says: 'Adds a firm, by name, with every service off.',
    who: ['staff'],
    async run(ctx, input: { name: string }): Promise<FirmId> {
      const staff = staffOf(ctx);
      const firm = await createFirm(ctx.db, { name: input.name, isExample: false }, ctx.by);
      log('firm_added', { firm, staff });
      return firm;
    },
  }),
  add_owner: action({
    says: 'Adds the firm’s owner, with the name customers read in texts and a mobile for alerts and logging in.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; name: string; mobile: UkMobile }): Promise<OwnerId> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const owner = await createOwner(db, input.firm, { name: input.name, mobile: input.mobile }, ctx.by);
      log('firm_set_up_changed', { firm: input.firm, staff });
      return owner;
    },
  }),
  change_owner_mobile: action({
    says: 'Changes an owner’s mobile. Their logins end, and links not yet used stop working.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; owner: OwnerId; mobile: UkMobile }): Promise<void> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await setOwnerMobile(db, input.firm, input.owner, input.mobile, ctx.by);
      log('firm_set_up_changed', { firm: input.firm, staff });
    },
  }),
  set_firm_number: action({
    says: 'Sets the number the firm’s customers ring and text.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; number: UkMobile }): Promise<NumberSet> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const done = await setFirmNumber(db, input.firm, input.number, ctx.by);
      if (done === 'set') log('firm_set_up_changed', { firm: input.firm, staff });
      return done;
    },
  }),
  set_urgent_list: action({
    says: 'Sets what counts as urgent for the firm. Its agent in Vapi is updated, if it has one set.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; items: readonly string[] }): Promise<void> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await setUrgentList(db, input.firm, input.items, ctx.by);
      log('firm_set_up_changed', { firm: input.firm, staff });
    },
  }),
  set_diary_rules: action({
    says: 'Sets when the firm’s visits can be booked, how much notice it needs, and how long each kind of visit takes.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; rules: DiaryRules }): Promise<void> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await setDiaryRules(db, input.firm, input.rules, ctx.by);
      log('firm_set_up_changed', { firm: input.firm, staff });
    },
  }),
  agree_wording: action({
    says: 'Saves the words of a kind of text, as the owner agreed them, naming the owner and how they agreed.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; kind: MessageKind; words: string; owner: OwnerId; how: AgreedHow }): Promise<WordingId> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const id = await setWording(db, input.firm, `text:${input.kind}`, input.words, ctx.by, { owner: input.owner, how: input.how });
      log('wording_agreed', { firm: input.firm, staff });
      return id;
    },
  }),
  set_agent: action({
    says: 'Sets which voice agent in Vapi is the firm’s, and checks it.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; assistantId: string }): Promise<'set' | 'taken'> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      const done = await setAgent(db, input.firm, input.assistantId, staff);
      if (done === 'set') log('agent_set', { firm: input.firm, staff });
      return done;
    },
  }),
  check_agent: action({
    says: 'Checks the firm’s voice agent in Vapi now, and puts the record’s settings on it unless it was changed in Vapi.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId }): Promise<Pushed> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await logStaff(db, input.firm, staff, 'checked_agent');
      return pushAgent(db, ctx.deps, input.firm, { by: { kind: 'staff', staff }, due: null, overwrite: false });
    },
  }),
  overwrite_agent: action({
    says: 'Puts the record’s settings on the firm’s voice agent, replacing a change made in Vapi. Never on an agent that is not the firm’s.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId }): Promise<Pushed> {
      const staff = staffOf(ctx);
      const { db } = await firmDb(ctx, input.firm);
      await logStaff(db, input.firm, staff, 'overwrote_agent');
      return pushAgent(db, ctx.deps, input.firm, { by: { kind: 'staff', staff }, due: null, overwrite: true });
    },
  }),

  // Front-line's staff, on practice and this machine only: the demo firm.
  load_example: action({
    says: 'Loads the demo firm, Tidewell Heating, when there is none. Practice and this machine only.',
    who: ['staff'],
    async run(ctx): Promise<FirmId> {
      const staff = staffOf(ctx);
      if (ctx.deps.copy === 'live') throw new Refused();
      // Loaded twice, it gives the one already there.
      const [already] = await exampleFirms(ctx.db);
      if (already !== undefined) return already;
      const firm = await loadExample(ctx.d1);
      await setExampleClock(ctx.db, firm, instantFromIso(EXAMPLE_NOW), staff, 'start');
      log('example_loaded', { firm, staff });
      return firm;
    },
  }),
  move_example_clock: action({
    says: 'Moves the demo firm’s clock on, then runs whatever has come due. Practice and this machine only.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId; to: Instant }): Promise<void> {
      const staff = staffOf(ctx);
      if (ctx.deps.copy === 'live') throw new Refused();
      await setExampleClock(ctx.db, input.firm, input.to, staff, 'move_on');
      log('example_clock_moved', { firm: input.firm, staff });
      await everyMinute(ctx.d1, ctx.deps);
    },
  }),
  reset_example: action({
    says: 'Deletes the demo firm and loads it fresh, at the example’s “today”. Practice and this machine only.',
    who: ['staff'],
    async run(ctx, input: { firm: FirmId }): Promise<FirmId> {
      const staff = staffOf(ctx);
      if (ctx.deps.copy === 'live') throw new Refused();
      await deleteExampleFirm(ctx.db, input.firm, staff);
      const firm = await loadExample(ctx.d1);
      await setExampleClock(ctx.db, firm, instantFromIso(EXAMPLE_NOW), staff, 'start');
      log('example_reset', { firm, staff });
      return firm;
    },
  }),
} as const;

export type ActionName = keyof typeof ACTIONS;
type RunOf<N extends ActionName> = (typeof ACTIONS)[N]['run'];
export type ActionInput<N extends ActionName> = Parameters<RunOf<N>>[1];
export type ActionOutput<N extends ActionName> = Awaited<ReturnType<RunOf<N>>>;

/**
 * Takes one named action, as the actor in the context. Refused, with nothing
 * changed, for anyone the action does not name.
 */
export async function act<N extends ActionName>(ctx: ActionContext, name: N, input: ActionInput<N>): Promise<ActionOutput<N>> {
  const chosen: Action<ActionInput<N>, ActionOutput<N>> = ACTIONS[name] as unknown as Action<ActionInput<N>, ActionOutput<N>>;
  if (!chosen.who.includes(whoIs(ctx.by))) throw new Refused();
  return chosen.run(ctx, input);
}
