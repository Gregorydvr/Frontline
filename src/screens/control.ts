// The control room's screens (slice G of docs/build-brief.md), for
// Front-line's own staff: the list of firms, one firm, finding a customer,
// one customer, and deleting them. In the example's look, with no side menu.
// The example app has no control room, so every word here is new, and is
// read by staff only (CONTROL_WORDS below).
//
// What a customer or a caller wrote is escaped like everything else, so it
// shows as plain text (rule 17).

import type { Instant } from '../clock';
import { clock24, inLondon, shortDate } from '../london';
import { nationalNumber } from '../phone';
import type { FailedText, LookItem, OwnerMessageForStaff } from '../record/control';
import { SERVICES, type Call, type Customer, type Firm, type Job, type MessageKind, type MessageReason, type Service, type TextIn } from '../record/types';
import { SERVICE_WORDS } from '../words';
import { ARCHIVO_FONT_FACE } from './archivo';
import { dayWords } from './home';
import { html, trusted, type Html } from './html';
import { ICONS, LOOK } from './look';
import { badge } from './shell';

/** Every word on the control room's screens. New in slice G, for staff only; flagged in its pull request. */
export const CONTROL_WORDS = {
  controlRoom: 'Control room',
  firms: 'Firms',
  noFirms: 'No firms yet.',
  allFirms: 'All firms',
  stopOn: 'Stop button on',
  servicesOn: 'On: {services}',
  noServicesOn: 'No services on',
  today: '{calls} calls today · {failed} texts failed this week · {textsIn} texts in today · {unread} unread from the owner',
  services: 'Services',
  switchOn: 'Switch on',
  switchOff: 'Switch off',
  on: 'On',
  off: 'Off',
  stopButton: 'Stop button',
  stopIsOn: 'On: no text goes to this firm’s customers.',
  stopIsOff: 'Off: texts go as normal.',
  pressStop: 'Turn the stop button on',
  releaseStop: 'Turn the stop button off',
  findCustomer: 'Find a customer',
  findHint: 'Name, mobile or landline',
  find: 'Find',
  found: 'Found',
  noneFound: 'Nobody found.',
  callsToday: 'Calls today',
  noCalls: 'No calls today.',
  outcomes: { booked: 'Visit booked', urgent: 'Urgent', message: 'Message taken', details_missing: 'Details missing' },
  textsFailed: 'Texts that failed this week',
  noTextsFailed: 'None.',
  textsIn: 'Texts in this week',
  noTextsIn: 'None.',
  notACustomer: 'Not a customer',
  ownerMessages: 'Message us',
  noOwnerMessages: 'Nothing from the owner.',
  unread: 'Unread',
  needsALook: 'Needs a look',
  nothingNeedsALook: 'Nothing this week.',
  look: {
    stuck: 'Stuck since {time}: a {action} that never finished.',
    nobody_to_alert: 'An urgent call, and nobody to alert: the firm has no owner on record.',
    hold_let_go: 'A time was held on this call and let go. The caller may have been told a time.',
    urgent_not_on_list: 'The agent thought this urgent; it is not on the firm’s urgent list.',
    call_while_off: 'Came while calls were switched off.',
  },
  actions: {
    alert_owner: 'urgent alert',
    send_reminder: 'reminder',
    send_confirmation: 'confirmation',
    send_login_link: 'login text',
  },
  reasons: {
    refused: 'refused by the provider',
    undelivered: 'not delivered',
    unsubscribed: 'they unsubscribed with the provider',
    unclear: 'not clear if this went; it will not be sent again',
  } as Partial<Record<MessageReason, string>>,
  kinds: {
    visit_confirmation: 'Confirmation',
    visit_confirmation_first: 'Confirmation',
    visit_reminder: 'Reminder',
    urgent_alert: 'Urgent alert',
    urgent_alert_details_missing: 'Urgent alert',
    login_link: 'Login text',
  } satisfies Record<MessageKind, string>,
  toOwner: 'to the owner, {name}',
  someone: 'Someone',
  withheld: 'a withheld number',
  // A customer.
  details: 'What is held',
  name: 'Name',
  mobile: 'Mobile',
  landline: 'Landline',
  address: 'Address',
  email: 'Email',
  confirmed: 'Details confirmed',
  notGiven: 'Not given',
  yes: 'Yes, {when}',
  no: 'No',
  jobs: 'Jobs',
  noJobs: 'No jobs.',
  rows: 'Rows held',
  export: 'Export what is held',
  exportHint: 'A file of everything held about them, for the firm. Front-line keeps no copy.',
  delete: 'Delete this customer',
  // Deleting.
  deleteTitle: 'Delete {name}?',
  deleteWarning: 'This cannot be undone. Export what is held first, for the firm.',
  willGo: 'What goes',
  willStay: 'What stays',
  staysStop: 'Their mobile stays on the firm’s list of numbers that get no text, with nothing else about them, because they texted STOP.',
  staysOthers: '{count} other customers of this firm on the same number, and their calls and texts.',
  staysNothing: 'Nothing about them.',
  staysLog: 'The staff log keeps who deleted them, and when, by id only.',
  typeName: 'Type their name, {name}, to delete them',
  wrongName: 'That is not their name as it is held. Nothing was deleted.',
  deleteButton: 'Delete for good',
  deletedTitle: 'Deleted',
  deleted: 'The customer and everything held about them is deleted.',
  alreadyDeleted: 'Already deleted, or not found.',
  cannotReach:
    'Not reached by this: the provider’s own copies of calls and texts (Vapi, Twilio), and the database’s restore points, which drop out after 30 days.',
  tables: {
    history: 'History entries',
    messages: 'Texts sent',
    links: 'Links',
    login_links: 'Owner’s login links to their jobs',
    due: 'Rows in the due list',
    texts_in: 'Texts in',
    opt_outs: 'Opt-outs',
    opted_out_numbers: 'Numbers on the no-text list',
    holds: 'Held times',
    calls: 'Calls',
    visits: 'Visits',
    jobs: 'Jobs',
    customers: 'Customer',
  } as Readonly<Record<string, string>>,
  // The demo firm, on practice and this machine only.
  example: 'The example',
  loadExample: 'Load the example',
  exampleClock: 'Its clock reads {when}.',
  moveHour: 'Move on 1 hour',
  moveDay: 'Move on 1 day',
  moveTo: 'Move on to',
  move: 'Move on',
  movedNote: 'Whatever has come due runs at once.',
  reset: 'Reset the example',
  resetTitle: 'Reset the example?',
  resetWarning: 'This deletes the demo firm and everything in it, and loads it fresh, with its clock at the example’s “today”.',
  resetButton: 'Reset it',
  notAllowed: 'Not allowed',
  notFound: 'Not found',
  back: 'Back',
} as const;

/** The frame of every control-room page. */
export function controlPage(title: string, screen: Html): string {
  return html`<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · ${CONTROL_WORDS.controlRoom}</title>
<style>${trusted(ARCHIVO_FONT_FACE)}${trusted(LOOK)}${trusted(CONTROL_LOOK)}</style>
</head>
<body>
${trusted(ICONS)}
<div class="app">
  <main class="main"><div class="screen wide">${screen}</div></main>
</div>
</body>
</html>
`.text;
}

// A few rules of the control room's own, for its forms.
const CONTROL_LOOK = `
.cr-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.cr-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line);min-height:64px}
.cr-row:first-child{border-top:0}
.cr-row form{display:flex;gap:8px;flex-wrap:wrap}
.cr-find{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
.cr-find .field{flex:1;min-width:200px}
.cr-find input,.cr-field input{min-height:44px;padding:0 12px;border:1.5px solid var(--line-strong);border-radius:10px;background:var(--card)}
.cr-list li{padding:10px 14px;border-top:1px solid var(--line);overflow-wrap:anywhere}
.cr-list li:first-child{border-top:0}
.cr-dl{display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:8px 16px;padding:14px;overflow-wrap:anywhere}
.cr-dl dt{color:var(--ink-2)}
.cr-dl dd{margin:0}
.cr-danger{background:var(--error);color:#fff}
`;

/** The headers every control-room page is sent with: no copies kept, no search engines, no scripts, forms only to here. */
export const CONTROL_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

const logo = html`<svg class="logo" role="img" aria-label="Front-line"><use href="#logo"></use></svg>`;

function words(template: string, gaps: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, gap: string) => (gap in gaps ? String(gaps[gap]) : whole));
}

function when(at: Instant): string {
  return `${shortDate(at)} ${clock24(at)}`;
}

function section(title: string, body: Html): Html {
  return html`<section class="block"><h2>${title}</h2>${body}</section>`;
}

function list(items: readonly Html[], empty: string): Html {
  return items.length === 0 ? html`<p class="meta">${empty}</p>` : html`<ul class="card cr-list">${items.map((item) => html`<li>${item}</li>`)}</ul>`;
}

/** What one firm's line on the list of firms shows. */
export interface FirmLine {
  firm: Firm;
  callsToday: number;
  failedThisWeek: number;
  textsInToday: number;
  unread: number;
}

export function firmsScreen(lines: readonly FirmLine[], canLoadExample: boolean): Html {
  return html`<div class="cr-top">${logo}<p class="meta">${CONTROL_WORDS.controlRoom}</p></div>
<h1>${CONTROL_WORDS.firms}</h1>
${
  lines.length === 0
    ? html`<p class="meta">${CONTROL_WORDS.noFirms}</p>`
    : html`<div class="card">${lines.map(
        (line) => html`<a class="row" href="/control/firms/${line.firm.id}"><span class="txt"><span class="t1">${line.firm.name} ${badge(line.firm)}</span>
<span class="t2">${servicesOn(line.firm)}${line.firm.stopped ? html` · <strong class="problem">${CONTROL_WORDS.stopOn}</strong>` : null}</span>
<span class="t2">${words(CONTROL_WORDS.today, { calls: line.callsToday, failed: line.failedThisWeek, textsIn: line.textsInToday, unread: line.unread })}</span></span></a>`,
      )}</div>`
}
${canLoadExample ? html`<form method="post" action="/control/example"><button class="btn btn-line" type="submit">${CONTROL_WORDS.loadExample}</button></form>` : null}`;
}

function servicesOn(firm: Firm): string {
  const on = SERVICES.filter((service) => firm.services[service]).map((service) => SERVICE_WORDS[service]);
  return on.length === 0 ? CONTROL_WORDS.noServicesOn : words(CONTROL_WORDS.servicesOn, { services: on.join(', ') });
}

/** What one firm's page shows. */
export interface FirmView {
  firm: Firm;
  now: Instant;
  calls: readonly Call[];
  failed: readonly FailedText[];
  textsIn: readonly TextIn[];
  ownerMessages: readonly OwnerMessageForStaff[];
  look: readonly LookItem[];
  /** The demo firm's clock and reset are shown: an example firm, on practice or this machine. */
  exampleTools: boolean;
}

export function firmScreen(view: FirmView): Html {
  const { firm } = view;
  const base = `/control/firms/${firm.id}`;
  return html`<a class="link" href="/control">${CONTROL_WORDS.allFirms}</a>
<div class="block"><h1>${firm.name} ${badge(firm)}</h1><p class="meta">${dayWords(view.now)}, ${clock24(view.now)}</p></div>
${findForm(base, '')}
${section(
  CONTROL_WORDS.services,
  html`<div class="card">${SERVICES.map((service) => switchRow(base, service, firm.services[service]))}
<div class="cr-row"><span class="txt"><span class="t1">${CONTROL_WORDS.stopButton}</span><span class="t2${firm.stopped ? ' problem' : ''}">${firm.stopped ? CONTROL_WORDS.stopIsOn : CONTROL_WORDS.stopIsOff}</span></span>
<form method="post" action="${base}/stop"><input type="hidden" name="on" value="${firm.stopped ? '0' : '1'}"><button class="btn btn-sm ${firm.stopped ? 'btn-line' : 'cr-danger'}" type="submit">${firm.stopped ? CONTROL_WORDS.releaseStop : CONTROL_WORDS.pressStop}</button></form></div></div>`,
)}
${section(CONTROL_WORDS.needsALook, list(view.look.map(lookLine), CONTROL_WORDS.nothingNeedsALook))}
${section(
  CONTROL_WORDS.ownerMessages,
  list(
    view.ownerMessages.map(
      (message) => html`${message.unread ? html`<span class="chip chip-ok">${CONTROL_WORDS.unread}</span> ` : null}<span class="t2">${when(message.createdAt)} · ${message.owner.name}</span><br>${message.words}`,
    ),
    CONTROL_WORDS.noOwnerMessages,
  ),
)}
${section(
  CONTROL_WORDS.callsToday,
  list(
    view.calls.map(
      (call) =>
        html`${clock24(call.startedAt)} · ${call.customer === null ? (call.caller ?? CONTROL_WORDS.someone) : html`<a class="link" href="${base}/customers/${call.customer.id}">${call.customer.name}</a>`} · ${CONTROL_WORDS.outcomes[call.customer === null && call.caller === null ? 'details_missing' : call.outcome]}${call.summary === null ? null : html`<br><span class="t2">${call.summary}</span>`}`,
    ),
    CONTROL_WORDS.noCalls,
  ),
)}
${section(
  CONTROL_WORDS.textsFailed,
  list(
    view.failed.map(
      (text) =>
        html`${when(text.createdAt)} · ${CONTROL_WORDS.kinds[text.kind]} ${text.to.kind === 'customer' ? html`to <a class="link" href="${base}/customers/${text.to.id}">${text.to.name}</a>` : words(CONTROL_WORDS.toOwner, { name: text.to.name })}${text.reason === null ? null : html`<br><span class="t2">${CONTROL_WORDS.reasons[text.reason] ?? text.reason}</span>`}`,
    ),
    CONTROL_WORDS.noTextsFailed,
  ),
)}
${section(
  CONTROL_WORDS.textsIn,
  list(
    view.textsIn.map(
      (text) =>
        html`${when(text.receivedAt)} · ${text.customer === null ? html`<span class="chip chip-plain">${CONTROL_WORDS.notACustomer}</span> ${text.from ?? CONTROL_WORDS.withheld}` : html`<a class="link" href="${base}/customers/${text.customer.id}">${text.customer.name}</a>`}<br><span class="t2">${text.words}</span>`,
    ),
    CONTROL_WORDS.noTextsIn,
  ),
)}
${view.exampleTools ? exampleTools(base, view.now) : null}`;
}

function switchRow(base: string, service: Service, on: boolean): Html {
  return html`<div class="cr-row"><span class="txt"><span class="t1">${SERVICE_WORDS[service]}</span><span class="t2">${on ? CONTROL_WORDS.on : CONTROL_WORDS.off}</span></span>
<form method="post" action="${base}/service"><input type="hidden" name="service" value="${service}"><input type="hidden" name="on" value="${on ? '0' : '1'}"><button class="btn btn-sm btn-line" type="submit">${on ? CONTROL_WORDS.switchOff : CONTROL_WORDS.switchOn}</button></form></div>`;
}

function lookLine(item: LookItem): Html {
  const who = item.customer?.name ?? item.caller ?? null;
  const what =
    item.kind === 'stuck'
      ? words(CONTROL_WORDS.look.stuck, { time: when(item.at), action: item.due === null ? '' : CONTROL_WORDS.actions[item.due.action] })
      : CONTROL_WORDS.look[item.kind];
  return html`<span class="t2">${when(item.at)}${who === null ? null : html` · ${who}`}</span><br>${what}`;
}

function exampleTools(base: string, now: Instant): Html {
  const { year, month, day, hour, minute } = inLondon(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${String(year)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
  return section(
    CONTROL_WORDS.example,
    html`<p class="meta">${words(CONTROL_WORDS.exampleClock, { when: `${dayWords(now)}, ${clock24(now)}` })} ${CONTROL_WORDS.movedNote}</p>
<div class="cr-find">
<form method="post" action="${base}/clock"><input type="hidden" name="by" value="hour"><button class="btn btn-line" type="submit">${CONTROL_WORDS.moveHour}</button></form>
<form method="post" action="${base}/clock"><input type="hidden" name="by" value="day"><button class="btn btn-line" type="submit">${CONTROL_WORDS.moveDay}</button></form>
</div>
<form class="cr-find" method="post" action="${base}/clock"><div class="field cr-field"><label for="cr-to">${CONTROL_WORDS.moveTo}</label><input id="cr-to" name="to" type="datetime-local" value="${local}" min="${local}"></div><button class="btn btn-line" type="submit">${CONTROL_WORDS.move}</button></form>
<a class="link" href="${base}/reset">${CONTROL_WORDS.reset}</a>`,
  );
}

function findForm(base: string, typed: string): Html {
  return html`<form class="cr-find" method="get" action="${base}/customers" role="search"><div class="field cr-field"><label for="cr-q">${CONTROL_WORDS.findCustomer}</label><input id="cr-q" name="q" type="search" maxlength="60" value="${typed}" placeholder="${CONTROL_WORDS.findHint}"></div><button class="btn btn-ink" type="submit">${CONTROL_WORDS.find}</button></form>`;
}

export function findScreen(firm: Firm, typed: string, found: readonly Customer[]): Html {
  const base = `/control/firms/${firm.id}`;
  return html`<a class="link" href="${base}">${firm.name}</a>
<h1>${CONTROL_WORDS.findCustomer}</h1>
${findForm(base, typed)}
${typed === '' ? null : found.length === 0 ? html`<p class="meta">${CONTROL_WORDS.noneFound}</p>` : html`<div class="card">${found.map(
  (customer) => html`<a class="row" href="${base}/customers/${customer.id}"><span class="txt"><span class="t1">${customer.name}</span><span class="t2">${numberOf(customer)}${customer.address === null ? null : html` · ${customer.address}`}</span></span></a>`,
)}</div>`}`;
}

function numberOf(customer: Customer): string {
  if (customer.mobile !== null) return nationalNumber(customer.mobile);
  if (customer.landline !== null) return nationalNumber(customer.landline);
  return CONTROL_WORDS.withheld;
}

export function customerScreen(firm: Firm, customer: Customer, jobs: readonly Job[], counts: Readonly<Record<string, number>>): Html {
  const base = `/control/firms/${firm.id}/customers/${customer.id}`;
  return html`<a class="link" href="/control/firms/${firm.id}">${firm.name}</a>
<h1>${customer.name}</h1>
${section(
  CONTROL_WORDS.details,
  html`<dl class="card cr-dl">
<dt>${CONTROL_WORDS.name}</dt><dd>${customer.name}</dd>
<dt>${CONTROL_WORDS.mobile}</dt><dd>${customer.mobile === null ? CONTROL_WORDS.notGiven : nationalNumber(customer.mobile)}</dd>
<dt>${CONTROL_WORDS.landline}</dt><dd>${customer.landline === null ? CONTROL_WORDS.notGiven : nationalNumber(customer.landline)}</dd>
<dt>${CONTROL_WORDS.address}</dt><dd>${customer.address ?? CONTROL_WORDS.notGiven}</dd>
<dt>${CONTROL_WORDS.email}</dt><dd>${customer.email ?? CONTROL_WORDS.notGiven}</dd>
<dt>${CONTROL_WORDS.confirmed}</dt><dd>${customer.detailsConfirmedAt === null ? CONTROL_WORDS.no : words(CONTROL_WORDS.yes, { when: when(customer.detailsConfirmedAt) })}</dd>
</dl>`,
)}
${section(CONTROL_WORDS.jobs, list(jobs.map((job) => html`${shortDate(job.createdAt)} · ${job.about}<br><span class="t2">${job.place}</span>`), CONTROL_WORDS.noJobs))}
${section(CONTROL_WORDS.rows, countList(counts))}
<form method="post" action="${base}/export" class="stack"><p class="meta">${CONTROL_WORDS.exportHint}</p><button class="btn btn-ink" type="submit">${CONTROL_WORDS.export}</button></form>
<a class="link" href="${base}/delete">${CONTROL_WORDS.delete}</a>`;
}

function countList(counts: Readonly<Record<string, number>>): Html {
  const lines = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => html`${CONTROL_WORDS.tables[table] ?? table}: ${count}`);
  return list(lines, CONTROL_WORDS.staysNothing);
}

export interface DeleteView {
  firm: Firm;
  customer: Customer;
  counts: Readonly<Record<string, number>>;
  othersOnTheirNumbers: number;
  wrongName: boolean;
}

export function deleteScreen(view: DeleteView): Html {
  const { firm, customer, counts } = view;
  const base = `/control/firms/${firm.id}/customers/${customer.id}`;
  const goes: Record<string, number> = { ...counts };
  delete goes.opted_out_numbers;
  const stays: Html[] = [];
  if ((counts.opted_out_numbers ?? 0) > 0) stays.push(html`${CONTROL_WORDS.staysStop}`);
  if (view.othersOnTheirNumbers > 0) stays.push(html`${words(CONTROL_WORDS.staysOthers, { count: view.othersOnTheirNumbers })}`);
  stays.push(html`${CONTROL_WORDS.staysLog}`);
  return html`<a class="link" href="${base}">${customer.name}</a>
<div class="block"><h1>${words(CONTROL_WORDS.deleteTitle, { name: customer.name })}</h1><p class="problem">${CONTROL_WORDS.deleteWarning}</p></div>
<form method="post" action="${base}/export"><button class="btn btn-line" type="submit">${CONTROL_WORDS.export}</button></form>
${section(CONTROL_WORDS.willGo, countList(goes))}
${section(CONTROL_WORDS.willStay, list(stays, CONTROL_WORDS.staysNothing))}
<form method="post" action="${base}/delete" class="stack">
${view.wrongName ? html`<p class="problem" role="alert">${CONTROL_WORDS.wrongName}</p>` : null}
<div class="field cr-field"><label for="cr-name">${words(CONTROL_WORDS.typeName, { name: customer.name })}</label><input id="cr-name" name="name" type="text" autocomplete="off" maxlength="60" required></div>
<button class="btn cr-danger" type="submit">${CONTROL_WORDS.deleteButton}</button>
</form>`;
}

export function deletedScreen(firm: Firm, removed: Readonly<Record<string, number>> | null): Html {
  return html`<a class="link" href="/control/firms/${firm.id}">${firm.name}</a>
<div class="block"><h1>${CONTROL_WORDS.deletedTitle}</h1><p class="meta">${removed === null ? CONTROL_WORDS.alreadyDeleted : CONTROL_WORDS.deleted}</p></div>
${removed === null ? null : countList(removed)}
<p class="meta">${CONTROL_WORDS.cannotReach}</p>`;
}

export function resetScreen(firm: Firm): Html {
  const base = `/control/firms/${firm.id}`;
  return html`<a class="link" href="${base}">${firm.name}</a>
<div class="block"><h1>${CONTROL_WORDS.resetTitle}</h1><p class="problem">${CONTROL_WORDS.resetWarning}</p></div>
<form method="post" action="${base}/reset"><button class="btn cr-danger" type="submit">${CONTROL_WORDS.resetButton}</button></form>`;
}

export function messageScreen(title: string): Html {
  return html`<div class="block"><h1>${title}</h1></div><a class="link" href="/control">${CONTROL_WORDS.allFirms}</a>`;
}
