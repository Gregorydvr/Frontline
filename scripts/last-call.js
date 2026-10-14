// Reports on one practice call in one go: what Vapi holds about it, what
// Front-line kept (the control room's report on it, src/call-report.ts), and
// whether the two agree. Read only: it asks Vapi and the control room with GET
// and nothing else, and does not reach Twilio at all, whose delivery reports
// are already in Front-line's record. Opening the report is a view in the
// control room, so the staff log records it, as rule 15 asks; nothing else
// changes.
//
//   npm run practice:last-call                         the newest call to the practice agent
//   npm run practice:last-call -- --call <Vapi id>     that call
//   npm run practice:last-call -- --transcript         and the conversation, on screen only
//
// Run on Greg's own machine (CLAUDE.md). It needs the Vapi private key in
// VAPI_API_KEY, and cloudflared, which asks Cloudflare Access for a token as
// you: the first time, your browser opens for you to log in. Neither the key
// nor the token is ever printed. It ends with a failure when a check does not
// agree, so it can be run after each test call.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { conversation, crossCheck, firmFromSettings, readOnly, reportLines, summariseVapiCall } from './call-report-text.js';

const API = 'https://api.vapi.ai';
const VAPI_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const run = promisify(execFile);

const [assistant, file, control, ...rest] = process.argv.slice(2);
const usage = 'Usage: node scripts/last-call.js <assistant id> <settings file> <control room address> [--call <Vapi call id>] [--transcript]';
if (!assistant || !file || !control) fail(usage);
if (!VAPI_ID.test(assistant)) fail('The assistant id is not one of Vapi\'s ids.');
let asked = null;
let withTranscript = false;
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--transcript') withTranscript = true;
  else if (rest[i] === '--call' && rest[i + 1] !== undefined) asked = rest[(i += 1)];
  else fail(usage);
}
if (asked !== null && !VAPI_ID.test(asked)) fail('The call id is not one of Vapi\'s ids.');
const key = process.env.VAPI_API_KEY;
if (!key) fail('VAPI_API_KEY is not set.');
const firm = firmFromSettings(JSON.parse(readFileSync(file, 'utf8')));
if (firm === null) fail('The settings file has no recordingPath of the form /firms/<firm id>.');

const callId = asked ?? (await newestCall());
const call = await vapi(`/call/${callId}`);
const frontline = await controlReport(await accessToken());
const summary = summariseVapiCall(call);
const problems = crossCheck(summary, frontline);
console.log(reportLines(summary, frontline, problems).join('\n'));
if (withTranscript) {
  console.log(`\nThe conversation, on screen only:\n${conversation(call).join('\n')}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;

/** Vapi's id for the newest call to the agent. */
async function newestCall() {
  const calls = await vapi(`/call?assistantId=${assistant}&limit=10`);
  if (!Array.isArray(calls) || calls.length === 0) fail('Vapi has no calls for this agent.');
  const [newest] = [...calls].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return newest.id;
}

async function vapi(path) {
  const method = readOnly('GET');
  let response;
  try {
    response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}` } });
  } catch (error) {
    fail(`Could not reach Vapi (${String(error)}). If it says "fetch failed", set NODE_OPTIONS=--dns-result-order=ipv4first and run again.`);
  }
  if (!response.ok) fail(`Vapi refused ${method} ${path.split('?')[0]}: HTTP ${String(response.status)}`);
  return response.json();
}

/** A Cloudflare Access token for the control room, as you. Logs in first if there is none. Never printed. */
async function accessToken() {
  const token = await storedToken();
  if (token !== null) return token;
  console.log('Logging in to Cloudflare Access for the control room: your browser will open.');
  try {
    await run('cloudflared', ['access', 'login', control]);
  } catch {
    fail('cloudflared could not log in to the control room. Is cloudflared installed, and is the address right?');
  }
  return (await storedToken()) ?? fail('cloudflared logged in, but gave no token for the control room.');
}

async function storedToken() {
  try {
    const { stdout } = await run('cloudflared', ['access', 'token', `-app=${control}`]);
    const token = stdout.trim();
    return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** The control room's report on the call, or null when Front-line has no such call. */
async function controlReport(token) {
  const method = readOnly('GET');
  const address = `${control}/control/firms/${firm}/calls/vapi/${callId}`;
  let response;
  try {
    response = await fetch(address, { method, headers: { 'cf-access-token': token }, redirect: 'manual' });
  } catch (error) {
    fail(`Could not reach the control room (${String(error)}).`);
  }
  if (response.status === 404) return null;
  if (response.status >= 300 && response.status < 400) fail('Cloudflare Access did not let the token through. Run `cloudflared access login` for the control room and try again.');
  if (!response.ok) fail(`The control room answered HTTP ${String(response.status)}.`);
  return response.json();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
