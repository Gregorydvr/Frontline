// The control room's screens (slice G of docs/build-brief.md), for
// Front-line's own staff: the list of firms, one firm, finding a customer,
// one customer, and deleting them. In the example's look, with no side menu.
// The example app has no control room, so every word here is new, and is
// read by staff only (CONTROL_WORDS below).
//
// What a customer or a caller wrote is escaped like everything else, so it
// shows as plain text (rule 17).

import { instant, type Instant } from '../clock';
import { PERIODS } from '../record/periods';
import { clock24, inLondon, shortDate } from '../london';
import { nationalNumber } from '../phone';
import type { FailedText, LookItem, OwnerMessageForStaff } from '../record/control';
import type { FirmExport } from '../record/firm-file';
import type { DiaryProblem, NameProblem, SetUpGap, UrgentListProblem, WordingProblem } from '../set-up';
import {
  AGREED_HOW,
  MESSAGE_KINDS,
  SERVICES,
  VISIT_KINDS,
  type AgreedHow,
  type Call,
  type Customer,
  type DueAction,
  type Firm,
  type Job,
  type MessageKind,
  type MessageReason,
  type Owner,
  type Service,
  type TextIn,
  type VisitKind,
  type WordingVersion,
} from '../record/types';
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
    recording_not_kept: 'The recording of this call is not in Front-line’s file store. Check the firm’s agent in Vapi.',
  },
  actions: {
    alert_owner: 'urgent alert',
    send_reminder: 'reminder',
    send_confirmation: 'confirmation',
    send_login_link: 'login text',
    move_recording: 'move of a recording',
    delete_recording: 'delete of a recording',
    sweep: 'daily sweep',
    make_firm_export: 'firm export',
    delete_firm: 'delete of the firm',
  } satisfies Record<DueAction, string>,
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
  exportHint: 'A zip of everything held about them, with their recordings, for the firm. Front-line keeps no copy.',
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
  // Keeping and deleting a firm (slice H).
  records: 'The firm’s records',
  exportFirm: 'Export this firm',
  exportFirmHint: 'A zip of everything the firm holds, with spreadsheets and the recordings still kept, to hand over. Kept for 30 days.',
  exportAsked: 'Asked for {when}. Being made.',
  exportReady: 'Made {when} · {size}',
  exportDownloaded: 'Last downloaded {when}',
  exportNotDownloaded: 'Not downloaded yet',
  download: 'Download',
  noExports: 'No exports.',
  leaving: 'Leaving',
  leavingSince: 'Leaving since {when}. It is deleted on {deleteOn} ({days} days left) unless it is cancelled.',
  leavingNoExport: 'Its export has not been downloaded yet.',
  markLeaving: 'This firm is leaving',
  leavingTitle: '{name} is leaving?',
  leavingWarning: 'This turns the stop button on, switches every service off, cancels every text still waiting, and makes the firm’s export. The firm and everything it holds is deleted 30 days from now, unless the leaving is cancelled. Its calls and texts are no longer kept.',
  typeFirmName: 'Type the firm’s name, {name}, to go on',
  wrongFirmName: 'That is not the firm’s name as it is held. Nothing was changed.',
  leavingButton: 'Mark as leaving',
  cancelLeaving: 'Cancel the leaving',
  deleteFirm: 'Delete the firm now',
  deleteFirmTitle: 'Delete {name} now?',
  deleteFirmWarning: 'This cannot be undone. Every file and every row the firm holds is deleted.',
  deleteFirmNeedsExport: 'The export must be made first. Download it and hand it to the firm.',
  firmStays: 'The staff log, and a note that the firm was deleted and when, by id only.',
  firmDeletedTitle: 'Firm deleted',
  firmDeleted: 'The firm and everything it held is deleted.',
  firmCannotReach:
    'Not reached by this: the firm’s number with Twilio and its texts there, its agent and calls with Vapi, and the database’s restore points, which drop out after 30 days. See docs/firm-leaving.md.',
  // After a restore.
  afterRestore: 'After a restore',
  afterRestoreHint: 'A restore brings back customers and firms deleted since its point. Give the time the database was restored to, and every delete noted since then is done again.',
  restoredTo: 'Restored to (UK time)',
  deletesSince: '{count} deletes noted since then.',
  deleteAgain: 'Delete again',
  deletedAgain: 'Done again: {customers} customers and {firms} firms deleted; {recordings} calls marked as having lost their recording.',
  // Setting up a firm (slice H2). New, for staff only; flagged in its pull
  // request.
  addFirm: 'Add a firm',
  addFirmHint: 'It starts with every service off and the stop button off.',
  firmName: 'The firm’s name, as its texts will say it',
  add: 'Add',
  save: 'Save',
  setUp: 'Set-up',
  missing: 'Still missing before Calls & bookings can be switched on',
  nothingMissing: 'Nothing missing.',
  gaps: {
    number: 'Its number',
    owner: 'Its owner',
    owner_mobile: 'A mobile for its owner',
    urgent_list: 'What counts as urgent',
    diary: 'When visits can be booked',
    quote_visit_length: 'How long a quote visit takes',
    wording: 'Agreed wording for: {kinds}',
  } satisfies Record<SetUpGap['kind'], string>,
  outside: 'Set up outside Front-line, by hand: its agent in Vapi (docs/vapi.md) and its number in Twilio (docs/twilio.md).',
  forVapi: 'For its agent in Vapi',
  firmId: 'Firm id',
  recordingPath: 'Recording path',
  urgentForAgent: 'Urgent list, for urgentMatch',
  noneYet: 'None yet',
  change: 'Change',
  owner: 'Owner',
  addOwner: 'Add its owner',
  ownerName: 'Their name, as customers will read it in texts, such as Tom',
  ownerMobile: 'Their mobile, for alerts and the login link',
  noMobile: 'No mobile',
  changeMobile: 'Change their mobile',
  newMobile: 'New mobile',
  mobileWarning: 'Every login they have ends, and any login link already sent stops working. They log in again with a link sent to the new mobile.',
  notAMobile: 'That is not a UK mobile number.',
  mobileIsFirmsNumber: 'That is the firm’s own number. The owner needs their own mobile.',
  ownerAlready: 'The firm has its owner.',
  nameProblems: {
    empty: 'A name is needed.',
    too_long: 'Longer than {longest} characters, or on more than one line.',
    not_gsm7: 'These characters cannot go in a text: {characters}',
  } satisfies Record<NameProblem['kind'], string>,
  number: 'Number',
  numberHint: 'The 07 number bought for the firm in Twilio. Its customers ring and text it, and its texts come from it.',
  numberProblems: {
    not_mobile: 'That is not a UK mobile number.',
    taken: 'That number is another firm’s.',
    owners_mobile: 'That is the owner’s own mobile.',
    calls_on: 'The number can be changed only while Calls & bookings is off: customers reply to the number they have.',
  },
  urgent: 'What counts as urgent',
  urgentHint: 'One per line, such as: a leak. Its agent in Vapi must have the same list.',
  urgentProblems: {
    too_many: 'At most 20.',
    item: 'Empty, or longer than 60 characters: {item}',
    twice: 'Twice: {item}',
  } satisfies Record<UrgentListProblem['kind'], string>,
  diary: 'When visits can be booked',
  days: 'Days',
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  opens: 'First visit starts',
  closes: 'Last visit ends by',
  every: 'Minutes between starts',
  daysAhead: 'Days ahead that times are offered',
  lengths: 'How long each kind of visit takes, in minutes. Leave empty for one that is not booked. The voice agent books quote visits only.',
  visitKinds: { quote_visit: 'Quote visit', install: 'Install', service: 'Service' } satisfies Record<VisitKind, string>,
  diaryProblems: {
    no_days: 'Choose at least one day.',
    hours: 'The first visit must start before the last one ends.',
    every: 'Minutes between starts: at least 5, and no more than the hours allow.',
    days_ahead: 'Days ahead: from 1 to 90.',
    length: 'Each length: at least 5 minutes, and no more than the hours allow.',
  } satisfies Record<DiaryProblem['kind'], string>,
  wording: 'Wording',
  wordingHint: 'Each kind of text goes only in words the owner agreed (rule 2).',
  agreed: 'Agreed',
  notAgreed: 'Not agreed yet',
  textKinds: {
    visit_confirmation: 'Confirmation of a visit',
    visit_confirmation_first: 'Confirmation, as the first text to a new customer',
    visit_reminder: 'Reminder the day before a visit',
    urgent_alert: 'Urgent alert to the owner',
    urgent_alert_details_missing: 'Urgent alert to the owner, details missing',
    login_link: 'Login text to the owner',
  } satisfies Record<MessageKind, string>,
  gapsItCanUse: 'Gaps it can use',
  gapMeanings: {
    customer: 'the customer’s name as given, such as Mrs Ahmed',
    firm: 'the firm’s name',
    owner: 'the owner’s name, or the firm’s if it has no owner',
    day: 'the visit’s day, such as Thursday 1 October',
    time: 'the visit’s time, such as 3pm',
    purpose: 'what the visit is for, such as to look at the job and price it',
    weekday: 'the visit’s day of the week, such as Thursday',
    place: 'where, as the caller gave it',
    summary: 'one line about the call',
    number: 'the number to ring them on',
    link: 'the link: to confirm their details, to the job, or to log in',
  } as Readonly<Record<string, string>>,
  startsFromDraft: 'Not agreed yet. These are the draft words.',
  wordsLabel: 'Words',
  check: 'Check',
  saveAgreed: 'Save as agreed',
  whoAgreed: 'The owner who agreed them',
  how: 'How they agreed',
  hows: { phone: 'on the phone', in_person: 'in person', in_writing: 'in writing' } satisfies Record<AgreedHow, string>,
  agreedTick: 'The owner agreed these exact words',
  needTick: 'Tick to say the owner agreed these exact words. Nothing was saved.',
  needOwner: 'Add the firm’s owner first: they agree the wording.',
  nothingSaved: 'Nothing was saved.',
  checked: 'Checked',
  fits: 'Every character can go in a text.',
  preview: 'With example details: {segments} ({characters} characters)',
  previewLongest: 'With the longest details a call can give: up to {segments}',
  segment: '1 segment',
  segments: '{n} segments',
  wordingProblems: {
    empty: 'Empty.',
    too_long: 'Longer than {longest} characters.',
    spacing: 'Tabs and odd line breaks cannot go in a text.',
    two_lines: 'One line only.',
    not_gsm7: 'These characters cannot go in a text: {characters}',
    unknown_gap: '{gap} is not a gap this text can use.',
    stray_brace: 'A { or } that does not open or close a gap.',
    needs_link: 'This text must carry its link: {link}',
    needs_stop: 'The first text must tell them how to opt out, with the word STOP.',
    unknown_key: 'Not a kind of text.',
  } satisfies Record<WordingProblem['kind'], string>,
  versions: 'Versions, newest first',
  inUse: 'In use',
  versionAgreed: 'Agreed by {owner}, {how}, {when}. Recorded by {who}.',
  versionSet: 'Set {when}, by {who}.',
  frontline: 'Front-line',
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
.cr-field textarea,.cr-field select{min-height:44px;padding:10px 12px;border:1.5px solid var(--line-strong);border-radius:10px;background:var(--card);font:inherit;width:100%}
.cr-field textarea{min-height:140px;resize:vertical}
.cr-days{border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:4px 16px}
.cr-days legend{font-weight:600;padding:0;margin-bottom:6px}
.cr-tick{display:flex;align-items:center;gap:8px;min-height:44px}
.cr-tick input{width:22px;height:44px;margin:0}
.cr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.cr-preview{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px}
.cr-words{white-space:pre-wrap;overflow-wrap:anywhere}
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
<span class="t2">${line.firm.leaving === null ? null : html`<strong class="problem">${CONTROL_WORDS.leaving}</strong> · `}${servicesOn(line.firm)}${line.firm.stopped ? html` · <strong class="problem">${CONTROL_WORDS.stopOn}</strong>` : null}</span>
<span class="t2">${words(CONTROL_WORDS.today, { calls: line.callsToday, failed: line.failedThisWeek, textsIn: line.textsInToday, unread: line.unread })}</span></span></a>`,
      )}</div>`
}
<a class="btn btn-line" href="/control/add-firm">${CONTROL_WORDS.addFirm}</a>
${canLoadExample ? html`<form method="post" action="/control/example"><button class="btn btn-line" type="submit">${CONTROL_WORDS.loadExample}</button></form>` : null}
<a class="link" href="/control/after-restore">${CONTROL_WORDS.afterRestore}</a>`;
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
  /** The firm's exports, newest first. */
  exports: readonly FirmExport[];
  /** How far the firm is set up. */
  setUp: SetUpView;
}

/** How far a firm is set up: what it still needs before Calls & bookings, and its owners. */
export interface SetUpView {
  gaps: readonly SetUpGap[];
  owners: readonly Owner[];
}

export function firmScreen(view: FirmView): Html {
  const { firm } = view;
  const base = `/control/firms/${firm.id}`;
  return html`<a class="link" href="/control">${CONTROL_WORDS.allFirms}</a>
<div class="block"><h1>${firm.name} ${badge(firm)}</h1><p class="meta">${dayWords(view.now)}, ${clock24(view.now)}</p></div>
${findForm(base, '')}
${setUpSection(firm, view.setUp)}
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
${recordsSection(view)}
${view.exampleTools ? exampleTools(base, view.now) : null}`;
}

/** The firm's exports, and its leaving: marking it, the days left, cancelling it and deleting it. */
function recordsSection(view: FirmView): Html {
  const { firm } = view;
  const base = `/control/firms/${firm.id}`;
  const exports = list(
    view.exports.map((made) =>
      made.state === 'asked' || made.readyAt === null
        ? html`${words(CONTROL_WORDS.exportAsked, { when: when(made.askedAt) })}`
        : html`${words(CONTROL_WORDS.exportReady, { when: when(made.readyAt), size: sizeWords(made.size ?? 0) })}<br><span class="t2">${made.downloadedAt === null ? CONTROL_WORDS.exportNotDownloaded : words(CONTROL_WORDS.exportDownloaded, { when: when(made.downloadedAt) })}</span>
<br><a class="link" href="${base}/export/${made.id}">${CONTROL_WORDS.download}</a>`,
    ),
    CONTROL_WORDS.noExports,
  );
  const downloaded = view.exports.some((made) => made.downloadedAt !== null);
  const leaving =
    firm.leaving === null
      ? html`<a class="link" href="${base}/leaving">${CONTROL_WORDS.markLeaving}</a>`
      : html`<p class="problem">${words(CONTROL_WORDS.leavingSince, {
          when: when(firm.leaving.at),
          deleteOn: shortDate(deleteOn(firm.leaving.at)),
          days: Math.max(0, Math.ceil((deleteOn(firm.leaving.at) - view.now) / DAY)),
        })}</p>
${downloaded ? null : html`<p class="problem">${CONTROL_WORDS.leavingNoExport}</p>`}
<form method="post" action="${base}/leaving/cancel"><button class="btn btn-line" type="submit">${CONTROL_WORDS.cancelLeaving}</button></form>
<a class="link" href="${base}/delete">${CONTROL_WORDS.deleteFirm}</a>`;
  return section(
    CONTROL_WORDS.records,
    html`<p class="meta">${CONTROL_WORDS.exportFirmHint}</p>
<form method="post" action="${base}/export"><button class="btn btn-line" type="submit">${CONTROL_WORDS.exportFirm}</button></form>
${exports}
${leaving}`,
  );
}

const DAY = 24 * 60 * 60_000;

/** When a leaving firm is deleted by the clock: 30 days after it was marked. */
function deleteOn(leftAt: Instant): Instant {
  return instant(leftAt + PERIODS.leaving);
}

function sizeWords(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${String(Math.max(1, Math.round(bytes / 1024)))} kB`;
}

export function leavingScreen(firm: Firm, wrongName: boolean): Html {
  const base = `/control/firms/${firm.id}`;
  return html`<a class="link" href="${base}">${firm.name}</a>
<div class="block"><h1>${words(CONTROL_WORDS.leavingTitle, { name: firm.name })}</h1><p class="problem">${CONTROL_WORDS.leavingWarning}</p></div>
<form method="post" action="${base}/leaving" class="stack">
${wrongName ? html`<p class="problem" role="alert">${CONTROL_WORDS.wrongFirmName}</p>` : null}
<div class="field cr-field"><label for="cr-name">${words(CONTROL_WORDS.typeFirmName, { name: firm.name })}</label><input id="cr-name" name="name" type="text" autocomplete="off" maxlength="120" required></div>
<button class="btn cr-danger" type="submit">${CONTROL_WORDS.leavingButton}</button>
</form>`;
}

export function firmDeleteScreen(firm: Firm, exportMade: boolean, wrongName: boolean): Html {
  const base = `/control/firms/${firm.id}`;
  return html`<a class="link" href="${base}">${firm.name}</a>
<div class="block"><h1>${words(CONTROL_WORDS.deleteFirmTitle, { name: firm.name })}</h1><p class="problem">${CONTROL_WORDS.deleteFirmWarning}</p></div>
${section(CONTROL_WORDS.willStay, list([html`${CONTROL_WORDS.firmStays}`], CONTROL_WORDS.staysNothing))}
${
  exportMade
    ? html`<form method="post" action="${base}/delete" class="stack">
${wrongName ? html`<p class="problem" role="alert">${CONTROL_WORDS.wrongFirmName}</p>` : null}
<div class="field cr-field"><label for="cr-name">${words(CONTROL_WORDS.typeFirmName, { name: firm.name })}</label><input id="cr-name" name="name" type="text" autocomplete="off" maxlength="120" required></div>
<button class="btn cr-danger" type="submit">${CONTROL_WORDS.deleteButton}</button>
</form>`
    : html`<p class="problem">${CONTROL_WORDS.deleteFirmNeedsExport}</p>`
}
<p class="meta">${CONTROL_WORDS.firmCannotReach}</p>`;
}

export function firmDeletedScreen(): Html {
  return html`<a class="link" href="/control">${CONTROL_WORDS.allFirms}</a>
<div class="block"><h1>${CONTROL_WORDS.firmDeletedTitle}</h1><p class="meta">${CONTROL_WORDS.firmDeleted}</p></div>
<p class="meta">${CONTROL_WORDS.firmCannotReach}</p>`;
}

/** What the page for after a restore shows: how many deletes are noted since the time given, and what doing them again did. */
export interface AfterRestoreView {
  typed: string;
  since: number | null;
  done: { customers: number; firms: number; recordings: number } | null;
}

export function afterRestoreScreen(view: AfterRestoreView): Html {
  return html`<a class="link" href="/control">${CONTROL_WORDS.allFirms}</a>
<div class="block"><h1>${CONTROL_WORDS.afterRestore}</h1><p class="meta">${CONTROL_WORDS.afterRestoreHint}</p></div>
${view.done === null ? null : html`<p class="meta" role="status">${words(CONTROL_WORDS.deletedAgain, view.done)}</p>`}
<form class="cr-find" method="get" action="/control/after-restore"><div class="field cr-field"><label for="cr-since">${CONTROL_WORDS.restoredTo}</label><input id="cr-since" name="since" type="datetime-local" value="${view.typed}" required></div><button class="btn btn-line" type="submit">${CONTROL_WORDS.find}</button></form>
${
  view.since === null
    ? null
    : html`<p class="meta">${words(CONTROL_WORDS.deletesSince, { count: view.since })}</p>
<form method="post" action="/control/after-restore"><input type="hidden" name="since" value="${view.typed}"><button class="btn cr-danger" type="submit">${CONTROL_WORDS.deleteAgain}</button></form>`
}`;
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

// Setting up a firm (slice H2).

/** What a firm still needs, how it is set up so far with a link to change each part, and what its agent in Vapi needs. */
function setUpSection(firm: Firm, setUp: SetUpView): Html {
  const base = `/control/firms/${firm.id}`;
  const [owner] = setUp.owners;
  const missing = setUp.gaps.map((gap) =>
    gap.kind === 'wording'
      ? html`${words(CONTROL_WORDS.gaps.wording, { kinds: gap.missing.map((kind) => CONTROL_WORDS.textKinds[kind]).join('; ') })}`
      : html`${CONTROL_WORDS.gaps[gap.kind]}`,
  );
  const wordingGap = setUp.gaps.find((gap) => gap.kind === 'wording');
  const kinds = Object.keys(MESSAGE_KINDS).length;
  const agreedCount = kinds - (wordingGap?.kind === 'wording' ? wordingGap.missing.length : 0);
  return section(
    CONTROL_WORDS.setUp,
    html`${
      missing.length === 0
        ? html`<p class="meta">${CONTROL_WORDS.nothingMissing}</p>`
        : html`<p class="problem">${CONTROL_WORDS.missing}</p>${list(missing, '')}`
    }
<dl class="card cr-dl">
<dt>${CONTROL_WORDS.owner}</dt><dd>${
      owner === undefined
        ? html`${CONTROL_WORDS.noneYet} · <a class="link" href="${base}/owner">${CONTROL_WORDS.addOwner}</a>`
        : html`${owner.name} · ${owner.mobile === null ? CONTROL_WORDS.noMobile : nationalNumber(owner.mobile)} · <a class="link" href="${base}/owners/${owner.id}/mobile">${CONTROL_WORDS.changeMobile}</a>`
    }</dd>
<dt>${CONTROL_WORDS.number}</dt><dd>${firm.phoneNumber === null ? CONTROL_WORDS.noneYet : nationalNumber(firm.phoneNumber)} · <a class="link" href="${base}/number">${CONTROL_WORDS.change}</a></dd>
<dt>${CONTROL_WORDS.urgent}</dt><dd>${firm.urgentList.length === 0 ? CONTROL_WORDS.noneYet : firm.urgentList.join('; ')} · <a class="link" href="${base}/urgent">${CONTROL_WORDS.change}</a></dd>
<dt>${CONTROL_WORDS.diary}</dt><dd>${diaryInWords(firm)} · <a class="link" href="${base}/diary">${CONTROL_WORDS.change}</a></dd>
<dt>${CONTROL_WORDS.wording}</dt><dd>${CONTROL_WORDS.agreed}: ${agreedCount} / ${kinds} · <a class="link" href="${base}/wording">${CONTROL_WORDS.change}</a></dd>
</dl>
<p class="meta">${CONTROL_WORDS.outside}</p>
<h3>${CONTROL_WORDS.forVapi}</h3>
<dl class="card cr-dl">
<dt>${CONTROL_WORDS.firmId}</dt><dd class="cr-mono">${firm.id}</dd>
<dt>${CONTROL_WORDS.recordingPath}</dt><dd class="cr-mono">/firms/${firm.id}</dd>
<dt>${CONTROL_WORDS.urgentForAgent}</dt><dd class="cr-mono">${firm.urgentList.length === 0 ? CONTROL_WORDS.noneYet : `${firm.name}'s urgent list: ${firm.urgentList.join(', ')}.`}</dd>
</dl>`,
  );
}

/** When the firm's visits can be booked, in a line for staff. */
function diaryInWords(firm: Firm): string {
  const rules = firm.diaryRules;
  if (rules === null) return CONTROL_WORDS.noneYet;
  const days = rules.days.map((day) => CONTROL_WORDS.weekdays[day] ?? '').join(', ');
  const lengths = VISIT_KINDS.filter((kind) => rules.lengths[kind] !== undefined)
    .map((kind) => `${CONTROL_WORDS.visitKinds[kind]} ${String(rules.lengths[kind])} min`)
    .join(', ');
  return `${days} · ${minutesToTime(rules.opens)} to ${minutesToTime(rules.closes)} · ${CONTROL_WORDS.every} ${String(rules.every)} · ${CONTROL_WORDS.daysAhead} ${String(rules.daysAhead)}${lengths === '' ? '' : ` · ${lengths}`}`;
}

/** Minutes after midnight as a time field shows them, such as 08:00. */
export function minutesToTime(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function back(firm: Firm): Html {
  return html`<a class="link" href="/control/firms/${firm.id}">${firm.name}</a>`;
}

function problemList(problems: readonly string[]): Html | null {
  return problems.length === 0 ? null : html`<div role="alert">${problems.map((problem) => html`<p class="problem">${problem}</p>`)}</div>`;
}

/** The words for what is wrong with a name. */
export function nameProblemWords(problems: readonly NameProblem[]): string[] {
  return problems.map((problem) =>
    problem.kind === 'too_long'
      ? words(CONTROL_WORDS.nameProblems.too_long, { longest: problem.longest })
      : problem.kind === 'not_gsm7'
        ? words(CONTROL_WORDS.nameProblems.not_gsm7, { characters: problem.characters.join(' ') })
        : CONTROL_WORDS.nameProblems.empty,
  );
}

export function addFirmScreen(typed: string, problems: readonly string[]): Html {
  return html`<a class="link" href="/control">${CONTROL_WORDS.allFirms}</a>
<div class="block"><h1>${CONTROL_WORDS.addFirm}</h1><p class="meta">${CONTROL_WORDS.addFirmHint}</p></div>
<form method="post" action="/control/add-firm" class="stack">
${problemList(problems)}
<div class="field cr-field"><label for="cr-firm-name">${CONTROL_WORDS.firmName}</label><input id="cr-firm-name" name="name" type="text" autocomplete="off" maxlength="120" value="${typed}" required></div>
<button class="btn btn-ink" type="submit">${CONTROL_WORDS.add}</button>
</form>`;
}

export function ownerScreen(firm: Firm, typed: { name: string; mobile: string }, problems: readonly string[]): Html {
  return html`${back(firm)}
<h1>${CONTROL_WORDS.addOwner}</h1>
<form method="post" action="/control/firms/${firm.id}/owner" class="stack">
${problemList(problems)}
<div class="field cr-field"><label for="cr-owner-name">${CONTROL_WORDS.ownerName}</label><input id="cr-owner-name" name="name" type="text" autocomplete="off" maxlength="60" value="${typed.name}" required></div>
<div class="field cr-field"><label for="cr-owner-mobile">${CONTROL_WORDS.ownerMobile}</label><input id="cr-owner-mobile" name="mobile" type="tel" autocomplete="off" maxlength="20" value="${typed.mobile}" required></div>
<button class="btn btn-ink" type="submit">${CONTROL_WORDS.add}</button>
</form>`;
}

export function ownerMobileScreen(firm: Firm, owner: Owner, typed: string, problems: readonly string[]): Html {
  return html`${back(firm)}
<div class="block"><h1>${CONTROL_WORDS.changeMobile}</h1><p class="meta">${owner.name} · ${owner.mobile === null ? CONTROL_WORDS.noMobile : nationalNumber(owner.mobile)}</p><p class="problem">${CONTROL_WORDS.mobileWarning}</p></div>
<form method="post" action="/control/firms/${firm.id}/owners/${owner.id}/mobile" class="stack">
${problemList(problems)}
<div class="field cr-field"><label for="cr-new-mobile">${CONTROL_WORDS.newMobile}</label><input id="cr-new-mobile" name="mobile" type="tel" autocomplete="off" maxlength="20" value="${typed}" required></div>
<button class="btn btn-ink" type="submit">${CONTROL_WORDS.save}</button>
</form>`;
}

export function numberScreen(firm: Firm, typed: string, problems: readonly string[]): Html {
  return html`${back(firm)}
<div class="block"><h1>${CONTROL_WORDS.number}</h1><p class="meta">${CONTROL_WORDS.numberHint}</p></div>
<form method="post" action="/control/firms/${firm.id}/number" class="stack">
${problemList(problems)}
<div class="field cr-field"><label for="cr-number">${CONTROL_WORDS.number}</label><input id="cr-number" name="number" type="tel" autocomplete="off" maxlength="20" value="${typed}" required></div>
<button class="btn btn-ink" type="submit">${CONTROL_WORDS.save}</button>
</form>`;
}

/** The words for what is wrong with an urgent list. */
export function urgentProblemWords(problems: readonly UrgentListProblem[]): string[] {
  return problems.map((problem) => (problem.kind === 'too_many' ? CONTROL_WORDS.urgentProblems.too_many : words(CONTROL_WORDS.urgentProblems[problem.kind], { item: problem.item })));
}

export function urgentScreen(firm: Firm, typed: string, problems: readonly string[]): Html {
  return html`${back(firm)}
<div class="block"><h1>${CONTROL_WORDS.urgent}</h1><p class="meta">${CONTROL_WORDS.urgentHint}</p></div>
<form method="post" action="/control/firms/${firm.id}/urgent" class="stack">
${problemList(problems)}
<div class="field cr-field"><label for="cr-urgent">${CONTROL_WORDS.urgent}</label><textarea id="cr-urgent" name="items" maxlength="1300">${typed}</textarea></div>
<button class="btn btn-ink" type="submit">${CONTROL_WORDS.save}</button>
</form>`;
}

/** The diary form as staff filled it in, or as the firm's rules fill it. */
export interface DiaryForm {
  days: readonly number[];
  opens: string;
  closes: string;
  every: string;
  daysAhead: string;
  lengths: Readonly<Record<VisitKind, string>>;
}

/** The words for what is wrong with diary rules, each once. */
export function diaryProblemWords(problems: readonly DiaryProblem[]): string[] {
  return [...new Set(problems.map((problem) => CONTROL_WORDS.diaryProblems[problem.kind]))];
}

export function diaryScreen(firm: Firm, form: DiaryForm, problems: readonly string[]): Html {
  return html`${back(firm)}
<h1>${CONTROL_WORDS.diary}</h1>
<form method="post" action="/control/firms/${firm.id}/diary" class="stack">
${problemList(problems)}
<fieldset class="cr-days"><legend>${CONTROL_WORDS.days}</legend>
${[1, 2, 3, 4, 5, 6, 0].map(
  (day) =>
    html`<label class="cr-tick"><input type="checkbox" name="day" value="${String(day)}"${form.days.includes(day) ? trusted(' checked') : null}>${CONTROL_WORDS.weekdays[day] ?? ''}</label>`,
)}
</fieldset>
<div class="field cr-field"><label for="cr-opens">${CONTROL_WORDS.opens}</label><input id="cr-opens" name="opens" type="time" value="${form.opens}" required></div>
<div class="field cr-field"><label for="cr-closes">${CONTROL_WORDS.closes}</label><input id="cr-closes" name="closes" type="time" value="${form.closes}" required></div>
<div class="field cr-field"><label for="cr-every">${CONTROL_WORDS.every}</label><input id="cr-every" name="every" type="number" min="5" max="720" value="${form.every}" required></div>
<div class="field cr-field"><label for="cr-ahead">${CONTROL_WORDS.daysAhead}</label><input id="cr-ahead" name="daysAhead" type="number" min="1" max="90" value="${form.daysAhead}" required></div>
<p class="meta">${CONTROL_WORDS.lengths}</p>
${VISIT_KINDS.map(
  (kind) =>
    html`<div class="field cr-field"><label for="cr-length-${kind}">${CONTROL_WORDS.visitKinds[kind]}</label><input id="cr-length-${kind}" name="length_${kind}" type="number" min="5" max="720" value="${form.lengths[kind]}"></div>`,
)}
<button class="btn btn-ink" type="submit">${CONTROL_WORDS.save}</button>
</form>`;
}

export function wordingListScreen(firm: Firm, current: Readonly<Partial<Record<MessageKind, WordingVersion>>>): Html {
  const base = `/control/firms/${firm.id}/wording`;
  return html`${back(firm)}
<div class="block"><h1>${CONTROL_WORDS.wording}</h1><p class="meta">${CONTROL_WORDS.wordingHint}</p></div>
<div class="card">${(Object.keys(MESSAGE_KINDS) as MessageKind[]).map((kind) => {
    const version = current[kind];
    return html`<a class="row" href="${base}/${kind}"><span class="txt"><span class="t1">${CONTROL_WORDS.textKinds[kind]}</span><span class="t2${version === undefined ? ' problem' : ''}">${version === undefined ? CONTROL_WORDS.notAgreed : versionLine(version)}</span></span></a>`;
  })}</div>`;
}

/** Who agreed a version of the words, and who recorded it, in a line for staff. */
function versionLine(version: WordingVersion): string {
  const who = version.staffEmail ?? (version.by.kind === 'frontline' ? CONTROL_WORDS.frontline : CONTROL_WORDS.owner);
  return version.agreed === null
    ? words(CONTROL_WORDS.versionSet, { when: when(version.at), who })
    : words(CONTROL_WORDS.versionAgreed, { owner: version.agreed.owner.name, how: CONTROL_WORDS.hows[version.agreed.how], when: when(version.agreed.at), who });
}

/** The words for what is wrong with some wording. */
export function wordingProblemWords(problems: readonly WordingProblem[]): string[] {
  return problems.map((problem) => {
    switch (problem.kind) {
      case 'too_long':
        return words(CONTROL_WORDS.wordingProblems.too_long, { longest: problem.longest });
      case 'not_gsm7':
        return words(CONTROL_WORDS.wordingProblems.not_gsm7, { characters: problem.characters.join(' ') });
      case 'unknown_gap':
        return words(CONTROL_WORDS.wordingProblems.unknown_gap, { gap: `{${problem.gap}}` });
      default:
        return CONTROL_WORDS.wordingProblems[problem.kind];
    }
  });
}

function segmentWords(count: number): string {
  return count === 1 ? CONTROL_WORDS.segment : words(CONTROL_WORDS.segments, { n: count });
}

/** One kind of text's wording page. */
export interface WordingView {
  firm: Firm;
  kind: MessageKind;
  owners: readonly Owner[];
  /** The words in the box: as staff typed them, or the firm's current ones, or the draft. */
  words: string;
  /** Whether the firm has no agreed words for this kind yet, so the box holds the draft. */
  fromDraft: boolean;
  /** What a check found: nothing when the words can be saved. Null before any check. */
  problems: readonly string[] | null;
  /** The text with example details, and its segments, when the words can go in a text. */
  preview: { text: string; segments: number; characters: number; longest: number } | null;
  /** Every version, newest first. */
  versions: readonly WordingVersion[];
  /** The owner and how, as staff chose them. */
  chosen: { owner: string; how: string };
}

export function wordingScreen(view: WordingView): Html {
  const { firm, kind } = view;
  const [inUse, ...earlier] = view.versions;
  return html`<a class="link" href="/control/firms/${firm.id}/wording">${CONTROL_WORDS.wording}</a>
<div class="block"><h1>${CONTROL_WORDS.textKinds[kind]}</h1><p class="meta">${firm.name}</p>${view.fromDraft ? html`<p class="problem">${CONTROL_WORDS.startsFromDraft}</p>` : null}</div>
${section(
  CONTROL_WORDS.gapsItCanUse,
  list(
    MESSAGE_KINDS[kind].gaps.map((gap) => html`<span class="cr-mono">{${gap}}</span>: ${CONTROL_WORDS.gapMeanings[gap] ?? ''}`),
    CONTROL_WORDS.noneYet,
  ),
)}
<form method="post" action="/control/firms/${firm.id}/wording/${kind}" class="stack">
${view.problems === null ? null : view.problems.length === 0 ? html`<p class="meta" role="status">${CONTROL_WORDS.checked}. ${CONTROL_WORDS.fits}</p>` : problemList(view.problems)}
<div class="field cr-field"><label for="cr-words">${CONTROL_WORDS.wordsLabel}</label><textarea id="cr-words" name="words" maxlength="1000">${view.words}</textarea></div>
${
  view.preview === null
    ? null
    : html`<div class="card cr-preview">${view.preview.text}</div>
<p class="meta">${words(CONTROL_WORDS.preview, { segments: segmentWords(view.preview.segments), characters: view.preview.characters })}<br>${words(CONTROL_WORDS.previewLongest, { segments: segmentWords(view.preview.longest) })}</p>`
}
<button class="btn btn-line" type="submit" name="intent" value="check">${CONTROL_WORDS.check}</button>
${
  view.owners.length === 0
    ? html`<p class="problem">${CONTROL_WORDS.needOwner}</p>`
    : html`<div class="field cr-field"><label for="cr-agreed-owner">${CONTROL_WORDS.whoAgreed}</label><select id="cr-agreed-owner" name="owner">${view.owners.map(
        (owner) => html`<option value="${owner.id}"${view.chosen.owner === owner.id ? trusted(' selected') : null}>${owner.name}</option>`,
      )}</select></div>
<div class="field cr-field"><label for="cr-agreed-how">${CONTROL_WORDS.how}</label><select id="cr-agreed-how" name="how">${AGREED_HOW.map(
        (how) => html`<option value="${how}"${view.chosen.how === how ? trusted(' selected') : null}>${CONTROL_WORDS.hows[how]}</option>`,
      )}</select></div>
<label class="cr-tick"><input type="checkbox" name="agreed" value="1">${CONTROL_WORDS.agreedTick}</label>
<button class="btn btn-ink" type="submit" name="intent" value="save">${CONTROL_WORDS.saveAgreed}</button>`
}
</form>
${
  inUse === undefined
    ? null
    : section(
        CONTROL_WORDS.versions,
        list(
          [inUse, ...earlier].map(
            (version, index) =>
              html`${index === 0 ? html`<span class="chip chip-ok">${CONTROL_WORDS.inUse}</span> ` : null}<span class="t2">${versionLine(version)}</span><br><span class="cr-words">${version.words}</span>`,
          ),
          '',
        ),
      )
}`;
}
