// What scripts/last-call.js reports about one practice call, worked out from
// what Vapi holds about the call and the control room's report on it
// (src/call-report.ts). Kept apart from the script, with nothing here that
// reaches the network, so test/last-call.test.ts can try it.
//
// Nothing personal is printed unless asked for: a caller's number is shown
// only as the kind it is, and from the call's details only which fields came
// through, apart from the caller type and the urgent item, which are from
// lists, not from the caller. The conversation is shown only with
// --transcript.

/** A text's states while it is going or has gone (MESSAGE_STATES in src/record/types.ts). */
const GOING = ['sending', 'sent', 'delivered'];

/** The only method the script may use with Vapi: it reads, and changes nothing. */
export function readOnly(method) {
  if (method !== 'GET') {
    throw new Error(`Only GET is allowed: this script changes nothing in Vapi (asked for ${String(method)}).`);
  }
  return method;
}

/** The firm whose recordings the agent writes, from its settings file: its `recordingPath`, /firms/<id>. */
export function firmFromSettings(settings) {
  const path = settings?.artifactPlan?.recordingPath;
  const found = typeof path === 'string' ? /^\/firms\/([0-9a-z]{26})$/.exec(path) : null;
  return found === null ? null : found[1];
}

/** A caller's number as the kind it is, never the number. */
export function numberKind(number) {
  if (typeof number !== 'string') return 'withheld';
  const digits = number.replace(/[\s()-]/g, '').replace(/^\+44/, '0');
  if (/^07\d{9}$/.test(digits)) return 'mobile';
  if (/^0[123]\d{8,9}$/.test(digits)) return 'landline';
  return 'withheld';
}

/** What Vapi holds about one call, as the report needs it. */
export function summariseVapiCall(call) {
  const messages = call?.artifact?.messages ?? call?.messages ?? [];
  const system = messages.find((message) => message.role === 'system');
  const instructions = typeof system?.message === 'string' ? system.message : typeof system?.content === 'string' ? system.content : '';
  const answers = new Map(
    messages.filter((message) => message.role === 'tool_call_result').map((message) => [message.toolCallId, message.result ?? message.content]),
  );
  const tools = [];
  for (const message of messages) {
    if (message.role !== 'tool_calls') continue;
    for (const toolCall of message.toolCalls ?? []) {
      const given = toolCall.function?.arguments;
      tools.push({
        name: toolCall.function?.name ?? '?',
        secondsIn: typeof message.secondsFromStart === 'number' ? message.secondsFromStart : null,
        argumentsAs: typeof given === 'string' ? 'text' : typeof given === 'object' && given !== null ? 'object' : 'none',
        arguments: typeof given === 'string' ? parsed(given) : given ?? null,
        answer: parsed(answers.get(toolCall.id) ?? null),
      });
    }
  }
  const data = call?.analysis?.structuredData ?? null;
  return {
    id: call?.id ?? null,
    startedAt: call?.startedAt ?? null,
    endedAt: call?.endedAt ?? null,
    endedReason: call?.endedReason ?? null,
    caller: numberKind(call?.customer?.number),
    dateLine: instructions.split('\n').find((line) => line.startsWith('Today is')) ?? null,
    tools,
    detailsGiven: data === null || typeof data !== 'object' ? [] : Object.keys(data).sort(),
    callerType: typeof data?.callerType === 'string' ? data.callerType : null,
    urgentMatch: typeof data?.urgentMatch === 'string' ? data.urgentMatch : null,
  };
}

/**
 * The booking on a call, from what Vapi holds: each time the agent asked for
 * free times, with the day it gave (null for none) and the times it was
 * given (null when the answer could not be read, such as when Front-line did
 * not answer in time), and each time it booked, with the start it gave and
 * what it was told: booked, or why not (taken, not_offered, unreadable, or
 * no_answer), and whether a text was promised (null when not told).
 */
export function bookingSummary(vapi) {
  const freeTimes = vapi.tools
    .filter((tool) => tool.name === 'free_times')
    .map((tool) => ({
      secondsIn: tool.secondsIn,
      day: typeof tool.arguments?.day === 'string' ? tool.arguments.day : null,
      times: Array.isArray(tool.answer?.times) ? tool.answer.times.map((time) => ({ start: String(time?.start), say: String(time?.say) })) : null,
    }));
  const bookVisit = vapi.tools
    .filter((tool) => tool.name === 'book_visit')
    .map((tool) => ({
      secondsIn: tool.secondsIn,
      start: typeof tool.arguments?.start === 'string' ? tool.arguments.start : null,
      result: tool.answer?.booked === true ? 'booked' : typeof tool.answer?.why === 'string' ? tool.answer.why : 'no_answer',
      say: typeof tool.answer?.say === 'string' ? tool.answer.say : null,
      text: typeof tool.answer?.text === 'boolean' ? tool.answer.text : null,
    }));
  return { freeTimes, bookVisit };
}

/** The booking's lines in the report: what the agent asked and was told, and where the two texts stand in Front-line. */
export function bookingLines(vapi, frontline) {
  const { freeTimes, bookVisit } = bookingSummary(vapi);
  const lines = ['Booking'];
  if (freeTimes.length === 0) lines.push('  free_times: not called.');
  for (const asked of freeTimes) {
    const day = asked.day === null ? 'no day' : `day ${asked.day}`;
    const times =
      asked.times === null
        ? 'no answer it could read'
        : asked.times.length === 0
          ? 'no times'
          : asked.times.map((time) => `${time.say} (${time.start})`).join('; ');
    lines.push(`  free_times ${at(asked.secondsIn)}with ${day}: ${times}.`);
  }
  if (bookVisit.length === 0) lines.push('  book_visit: not called.');
  for (const booking of bookVisit) {
    const start = booking.start === null ? 'no start' : booking.start;
    const told =
      booking.result === 'booked'
        ? `booked${booking.say === null ? '' : ` for ${booking.say}`}, ${booking.text === true ? 'text promised' : booking.text === false ? 'no text promised' : 'not told about a text'}`
        : `not booked: ${BOOK_REFUSALS[booking.result] ?? String(booking.result)}`;
    lines.push(`  book_visit ${at(booking.secondsIn)}with ${start}: ${told}.`);
  }
  if (frontline !== null) {
    lines.push(`  Customer's confirmation: ${bookingTextWords(frontline.booking.customerText)}.`);
    lines.push(`  Owner's text: ${bookingTextWords(frontline.booking.ownerText)}.`);
  }
  return lines;
}

/** What book_visit says when it does not book, in words for staff. */
const BOOK_REFUSALS = {
  taken: 'the time was taken',
  not_offered: 'the time is not one the firm offers',
  unreadable: 'the start could not be read',
  no_answer: 'no answer it could read',
};

/** Where one of a booking's texts stands (BookingText in src/call-report.ts), in words for staff. */
function bookingTextWords(text) {
  if (text === null) return 'none due';
  const why = text.reasons.length === 0 ? '' : ` (${text.reasons.join(', ')})`;
  switch (text.state) {
    case 'sent':
      return 'sent';
    case 'quiet_hours':
      return `held for quiet hours, goes ${uk(text.until)}`;
    case 'waiting':
      return 'waiting to go';
    case 'not_sent':
      return `not sent${why}`;
    case 'failed':
      return `failed${why}`;
    case 'too_late':
      return 'not sent: too late';
    case 'cancelled':
      return 'cancelled';
    case 'visit_changed':
      return 'not sent: the visit changed';
    case 'nobody_to_tell':
      return 'not sent: no owner to tell';
    default:
      return String(text.state);
  }
}

function at(secondsIn) {
  return secondsIn === null ? '' : `at ${secondsIn.toFixed(1)}s `;
}

/**
 * The safety lines the agent may say, word for word, from its settings file:
 * the quoted line on each "- …: " row under the rule that begins "If the
 * caller mentions anything dangerous". Empty when there is no such list.
 */
export function safetyLines(settings) {
  const system = settings?.model?.messages?.find((message) => message.role === 'system');
  const instructions = typeof system?.content === 'string' ? system.content : '';
  const start = instructions.indexOf('If the caller mentions anything dangerous');
  if (start < 0) return [];
  const rule = instructions.slice(start).split('\n\n')[0] ?? '';
  return [...rule.matchAll(/^- [^:\n]+: "([^"\n]+)"$/gm)].map((found) => found[1]);
}

/** What marks one of the agent's lines as safety advice (Greg, 15 Oct 2026). */
const SAFETY_WORDS = ['999', 'leave the property', 'emergency'];

/**
 * Where the agent gave safety advice that is not one of its safety lines:
 * a line of its own with 999, "leave the property" or "emergency" in it once
 * every listed line said in it is taken out. One problem for each, giving
 * only how far into the call it was, never what was said. Read from Vapi's
 * record of the call, so it is checked with or without --transcript.
 */
export function safetyCheck(call, lines) {
  if (lines.length === 0) {
    return ["The agent's settings file has no list of safety lines, so its safety advice could not be checked."];
  }
  const allowed = lines.map(plain);
  const problems = [];
  for (const message of call?.artifact?.messages ?? []) {
    if (message.role !== 'bot' || typeof message.message !== 'string') continue;
    let said = plain(message.message);
    for (const line of allowed) said = said.split(line).join(' | ');
    if (SAFETY_WORDS.some((word) => said.includes(plain(word)))) {
      const at = typeof message.secondsFromStart === 'number' ? ` at ${message.secondsFromStart.toFixed(1)}s` : '';
      problems.push(`The agent gave safety advice that is not one of its safety lines${at}. Look at it with --transcript.`);
    }
  }
  return problems;
}

/** Words as spoken, for comparing: lower case, plain apostrophes, no punctuation, and numbers written without gaps. */
function plain(words) {
  return words
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/(\d) (?=\d)/g, '$1')
    .trim();
}

/** The conversation, with each tool call in its place. Shown only with --transcript. */
export function conversation(call) {
  const lines = [];
  for (const message of call?.artifact?.messages ?? []) {
    const at = typeof message.secondsFromStart === 'number' ? `[${message.secondsFromStart.toFixed(1).padStart(6)}s] ` : '';
    if (message.role === 'bot') lines.push(`${at}AI: ${String(message.message)}`);
    if (message.role === 'user') lines.push(`${at}Caller: ${String(message.message)}`);
    if (message.role === 'tool_calls') {
      for (const toolCall of message.toolCalls ?? []) lines.push(`${at}-> ${String(toolCall.function?.name)} ${shown(toolCall.function?.arguments)}`);
    }
    if (message.role === 'tool_call_result') lines.push(`${at}<- ${String(message.name)} ${shown(message.result)}`);
  }
  return lines;
}

/**
 * Where what Vapi holds and what Front-line holds do not agree, or something
 * did not happen that should have. Each is one line for staff.
 */
export function crossCheck(vapi, frontline) {
  const problems = [];
  // From Vapi alone, so it is checked even when Front-line has no report.
  if (vapi.urgentMatch !== null) {
    for (const name of ['free_times', 'book_visit']) {
      if (vapi.tools.some((tool) => tool.name === name)) {
        problems.push(`The agent used ${name} on a call it marked urgent ("${vapi.urgentMatch}"), though its instructions say never to on a dangerous call.`);
      }
    }
  }
  if (frontline === null) {
    problems.push('Front-line has no call with this id: the report did not arrive, or was for another number.');
    return problems;
  }
  const booked = vapi.tools.filter((tool) => tool.name === 'book_visit' && tool.answer?.booked === true).at(-1);
  if (booked !== undefined) {
    if (frontline.visit === null) {
      const hold = frontline.holds.at(-1);
      problems.push(`The agent was told the time was booked, but no visit was filed (hold: ${hold === undefined ? 'none' : hold.state}).`);
    } else if (frontline.visit.startsAt !== londonStartToIso(booked.answer.start, frontline.visit.startsAt)) {
      problems.push(`The visit filed starts ${frontline.visit.startsAt}, not at ${String(booked.answer.start)}, the time the agent booked.`);
    }
    const confirmationRow = frontline.due.find((row) => row.action === 'send_confirmation');
    const confirmationText = frontline.texts.find((text) => text.kind === 'visit_confirmation' || text.kind === 'visit_confirmation_first');
    if (booked.answer.text === true) {
      if (confirmationRow === undefined) problems.push('The agent promised a text, but no confirmation is due.');
      else if (confirmationRow.state === 'skipped' || confirmationRow.state === 'cancelled') problems.push(`The agent promised a text, but the confirmation was ${confirmationRow.state}.`);
      if (confirmationText !== undefined && !GOING.includes(confirmationText.state)) {
        problems.push(`The agent promised a text, but the confirmation is ${confirmationText.state}${confirmationText.reason === null ? '' : ` (${confirmationText.reason})`}.`);
      }
    }
    if (booked.answer.text === false && confirmationText !== undefined && (confirmationText.state === 'sent' || confirmationText.state === 'delivered')) {
      problems.push('The agent was told no text would go, but a confirmation went. This is the safe side, but worth a look.');
    }
  }
  if (vapi.urgentMatch !== null) {
    if (frontline.call.urgentItem === null) {
      problems.push(`The agent marked the call urgent ("${vapi.urgentMatch}"), but it is not on the firm's urgent list, so no alert went.`);
    } else {
      const alert = frontline.texts.find((text) => text.kind === 'urgent_alert' || text.kind === 'urgent_alert_details_missing');
      if (alert === undefined) problems.push('The call is urgent, but no alert to the owner was made.');
      else if (!GOING.includes(alert.state)) problems.push(`The call is urgent, but the owner's alert is ${alert.state}.`);
    }
  }
  if (vapi.caller !== frontline.call.from) {
    problems.push(`Vapi has the caller as ${vapi.caller}, Front-line as ${frontline.call.from}.`);
  }
  return problems;
}

/** The whole report, as lines for the terminal, with times in UK time. */
export function reportLines(vapi, frontline, problems) {
  const lines = [];
  lines.push(`Call ${String(vapi.id)}: ${uk(vapi.startedAt)} to ${uk(vapi.endedAt)}, ended by ${String(vapi.endedReason)}. Caller: ${vapi.caller}.`);
  lines.push(`Date the agent was given: ${vapi.dateLine ?? '(none found)'}`);
  lines.push('');
  lines.push('Vapi: tools used');
  if (vapi.tools.length === 0) lines.push('  none');
  for (const tool of vapi.tools) {
    const at = tool.secondsIn === null ? '' : `at ${tool.secondsIn.toFixed(1)}s `;
    lines.push(`  ${tool.name} ${at}with ${shown(tool.arguments)} (arguments as ${tool.argumentsAs})`);
    lines.push(`    answered ${shown(tool.answer)}`);
  }
  lines.push(`Vapi: details taken: ${vapi.detailsGiven.length === 0 ? 'none' : vapi.detailsGiven.join(', ')}. Caller type ${String(vapi.callerType)}, urgent match ${vapi.urgentMatch === null ? 'none' : `"${vapi.urgentMatch}"`}.`);
  lines.push('');
  if (frontline === null) {
    lines.push('Front-line: no call with this id.');
  } else {
    const { call, customer, job, visit } = frontline;
    lines.push(`Front-line: call ${call.id}, ${call.outcome}${call.urgentItem === null ? '' : `, urgent: "${call.urgentItem}"`}, recording ${call.recording}.`);
    lines.push(`  Customer: ${customer === null ? 'none' : `${customer.id}, ${customer.newOnThisCall ? 'new on this call' : 'already known'}, ${customer.hasMobile ? 'has a mobile' : 'no mobile'}`}.`);
    lines.push(`  Job: ${job === null ? 'none' : `${job.id}${job.urgent ? ', urgent' : ''}`}.`);
    lines.push(`  Visit: ${visit === null ? 'none' : `${visit.id}, ${visit.kind}, ${visit.state}, ${uk(visit.startsAt)} to ${uk(visit.endsAt)}`}.`);
    for (const hold of frontline.holds) lines.push(`  Hold: ${hold.id}, ${hold.state}, for ${uk(hold.startsAt)}, held ${uk(hold.heldAt)}.`);
    lines.push('  Due:');
    if (frontline.due.length === 0) lines.push('    none');
    for (const row of frontline.due) {
      lines.push(`    ${row.action}: ${row.state}${row.outcome === null ? '' : ` (${row.outcome})`}, runs ${uk(row.runAt)}, latest ${uk(row.latestAt)}${row.finishedAt === null ? '' : `, finished ${uk(row.finishedAt)}`}.`);
    }
    lines.push('  Texts:');
    if (frontline.texts.length === 0) lines.push('    none yet');
    for (const text of frontline.texts) {
      lines.push(`    ${text.kind} to the ${text.to}: ${text.state}${text.reason === null ? '' : ` (${text.reason})`}${text.segments === null ? '' : `, ${String(text.segments)} segment(s)`}${text.sentAt === null ? '' : `, sent ${uk(text.sentAt)}`}.`);
    }
  }
  lines.push('');
  lines.push(...bookingLines(vapi, frontline));
  lines.push('');
  if (problems.length === 0) {
    lines.push('Checks: Vapi and Front-line agree.');
  } else {
    lines.push('Checks: look at these.');
    for (const problem of problems) lines.push(`  - ${problem}`);
  }
  return lines;
}

/** An instant as UK time, such as "Thu 15 Oct, 09:00:00". */
export function uk(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '(none)';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '(none)';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/**
 * A start as the agent books it, "2026-10-15T09:00" in UK time, as the
 * instant Front-line stores, for comparing with the visit. The visit's own
 * start gives the UK offset that day.
 */
function londonStartToIso(start, visitStartsAt) {
  if (typeof start !== 'string') return null;
  const visit = new Date(visitStartsAt);
  const asUtc = new Date(`${start}:00Z`);
  if (Number.isNaN(asUtc.getTime()) || Number.isNaN(visit.getTime())) return null;
  const offsetMinutes = londonOffsetMinutes(visit);
  return new Date(asUtc.getTime() - offsetMinutes * 60_000).toISOString();
}

/** How far UK time is ahead of UTC at this instant, in minutes: 0 or 60. */
function londonOffsetMinutes(at) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return ((hour - at.getUTCHours() + 24) % 24) * 60;
}

function parsed(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function shown(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
